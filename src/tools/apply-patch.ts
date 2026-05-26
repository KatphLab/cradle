import { Type } from '@earendil-works/pi-ai'
import {
  defineTool,
  withFileMutationQueue,
} from '@earendil-works/pi-coding-agent'
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import path from 'node:path'

import { assertPermission } from '../config/settings.js'
import { normalizePath } from '../utils/path.js'

export interface ApplyPatchParameters {
  patch: string
}

interface PatchFile {
  path: string
  created: boolean
}

interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

function stripPatchPathPrefix(filePath: string): string {
  if (filePath.startsWith('a/') || filePath.startsWith('b/')) {
    return filePath.slice(2)
  }
  return filePath
}

function parseHeaderPath(line: string, marker: string): string {
  const value = line.slice(marker.length).trim()
  const [filePath] = value.split(/\s+/u)
  if (filePath === undefined || filePath.length === 0) {
    throw new Error(`Malformed patch header: ${line}`)
  }
  return filePath
}

function assertSafeRelativePath(filePath: string): string {
  const normalized = normalizePath(stripPatchPathPrefix(filePath))
  if (normalized === '/dev/null') return normalized
  if (path.isAbsolute(normalized)) {
    throw new Error(`Unsupported absolute patch path: ${filePath}`)
  }
  const parts = normalized.split(/[\\/]+/u)
  if (parts.includes('..')) {
    throw new Error(`Unsupported patch path traversal: ${filePath}`)
  }
  if (normalized.length === 0 || normalized === '.') {
    throw new Error(`Unsupported empty patch path: ${filePath}`)
  }
  return normalized
}

function rejectUnsupportedPatchOperations(patch: string): void {
  const unsupportedPatterns = [
    /^Binary files /mu,
    /^GIT binary patch$/mu,
    /^rename from /mu,
    /^rename to /mu,
    /^copy from /mu,
    /^copy to /mu,
    /^deleted file mode /mu,
  ]

  for (const pattern of unsupportedPatterns) {
    if (pattern.test(patch)) {
      throw new Error(
        'Unsupported patch operation: binary, rename, copy, and delete patches are not supported.',
      )
    }
  }
}

/** @public */
export function parsePatchFiles(patch: string): PatchFile[] {
  rejectUnsupportedPatchOperations(patch)

  const files = new Map<string, PatchFile>()
  const lines = patch.split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    const oldLine = lines[index]
    if (!oldLine?.startsWith('--- ')) continue

    const newLine = lines[index + 1]
    if (!newLine?.startsWith('+++ ')) {
      throw new Error(
        `Malformed patch: expected +++ header after line ${String(index + 1)}.`,
      )
    }

    const oldPath = assertSafeRelativePath(parseHeaderPath(oldLine, '--- '))
    const newPath = assertSafeRelativePath(parseHeaderPath(newLine, '+++ '))

    if (newPath === '/dev/null') {
      throw new Error(
        'Unsupported patch operation: file deletion is not supported.',
      )
    }

    const created = oldPath === '/dev/null'
    files.set(newPath, { path: newPath, created })
  }

  if (files.size === 0) {
    throw new Error('Malformed patch: no file headers found.')
  }

  return [...files.values()].toSorted((left, right) =>
    left.path.localeCompare(right.path),
  )
}

function runWithMutationQueues<T>(
  filePaths: readonly string[],
  fn: () => Promise<T>,
): Promise<T> {
  const [firstPath, ...remainingPaths] = filePaths
  if (firstPath === undefined) return fn()
  return withFileMutationQueue(firstPath, () =>
    runWithMutationQueues(remainingPaths, fn),
  )
}

interface GitRunOptions {
  patch?: string
  signal?: AbortSignal
}

async function findGitExecutable(): Promise<string> {
  const candidates = ['/usr/bin/git', '/bin/git']

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // Try the next fixed system path.
    }
  }

  throw new Error(
    'apply_patch is unavailable because git is not installed in a supported system path.',
  )
}

function runGit(
  gitExecutable: string,
  cwd: string,
  args: readonly string[],
  options: GitRunOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(gitExecutable, args, {
      cwd,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const abort = (): void => {
      child.kill('SIGTERM')
    }

    const rejectOnce = (error: Error): void => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', abort)
      reject(error)
    }

    options.signal?.addEventListener('abort', abort, { once: true })

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') rejectOnce(error)
    })
    child.on('error', rejectOnce)
    child.on('close', (exitCode) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', abort)
      resolve({ exitCode: exitCode ?? 1, stdout, stderr })
    })

    if (options.patch === undefined) {
      child.stdin.end()
    } else {
      child.stdin.end(options.patch)
    }
  })
}

async function getAvailableGitExecutable(cwd: string): Promise<string> {
  const gitExecutable = await findGitExecutable()
  const result = await runGit(gitExecutable, cwd, ['--version'])
  if (result.exitCode === 0) return gitExecutable
  throw new Error(
    'apply_patch is unavailable because git is not installed in a supported system path.',
  )
}

function buildGitApplyError(
  stage: 'check' | 'apply',
  result: CommandResult,
): Error {
  const output = `${result.stderr}${result.stdout}`.trim()
  const message = output.length > 0 ? output : `git apply ${stage} failed`
  return new Error(`apply_patch ${stage} failed: ${message}`)
}

function createGitRunOptions(
  patch: string,
  signal: AbortSignal | undefined,
): GitRunOptions {
  return {
    patch,
    ...(signal !== undefined && { signal }),
  }
}

/** @public */
export const applyPatchTool = defineTool({
  name: 'apply_patch',
  label: 'Apply Patch',
  description:
    'Apply a unified diff patch using git apply. The patch must include ---/+++ file headers and @@ hunks. Supports modifications and new files. Rejects binary patches, deletes, renames, copies, absolute paths, and path traversal. Requires git to be available.',
  parameters: Type.Object(
    {
      patch: Type.String({
        description: 'Unified diff patch text to apply',
      }),
    },
    { additionalProperties: false },
  ),
  async execute(
    _toolCallId,
    parameters: ApplyPatchParameters,
    signal,
    _onUpdate,
    context,
  ) {
    const gitExecutable = await getAvailableGitExecutable(context.cwd)
    const files = parsePatchFiles(parameters.patch)
    const absolutePaths = files.map((file) =>
      path.resolve(context.cwd, file.path),
    )

    for (const absolutePath of absolutePaths) {
      await assertPermission(absolutePath, context.cwd, 'write')
    }

    return runWithMutationQueues(absolutePaths, async () => {
      const check = await runGit(
        gitExecutable,
        context.cwd,
        ['apply', '--check', '--whitespace=nowarn', '-'],
        createGitRunOptions(parameters.patch, signal),
      )
      if (check.exitCode !== 0) throw buildGitApplyError('check', check)

      const apply = await runGit(
        gitExecutable,
        context.cwd,
        ['apply', '--whitespace=nowarn', '-'],
        createGitRunOptions(parameters.patch, signal),
      )
      if (apply.exitCode !== 0) throw buildGitApplyError('apply', apply)

      const createdFiles = files
        .filter((file) => file.created)
        .map((file) => file.path)
      const changedFiles = files.map((file) => file.path)
      const fileCount = String(changedFiles.length)
      const createdCount = String(createdFiles.length)

      return {
        content: [
          {
            type: 'text' as const,
            text: `Applied patch to ${fileCount} file(s); created ${createdCount} file(s).`,
          },
        ],
        details: {
          changedFiles,
          createdFiles,
        },
      }
    })
  },
})
