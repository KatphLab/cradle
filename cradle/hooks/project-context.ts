import { spawnSync } from 'node:child_process'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { isCradleSubagentProcess } from '../utils/tool.js'

interface GitInfo {
  readonly branch: string
  readonly shortHash: string
  readonly message: string
  readonly dirty: boolean
}

function runGit(args: readonly string[], cwd: string): string | undefined {
  const result = spawnSync('git', args, {
    cwd,
    timeout: 5000,
    encoding: 'utf8',
  })
  if (result.status !== 0 || result.error !== undefined) return undefined
  const output = result.stdout.trim()
  return output.length > 0 ? output : undefined
}

function detectGitInfo(cwd: string): GitInfo | undefined {
  const branch = runGit(['branch', '--show-current'], cwd)
  if (branch === undefined) return undefined

  const shortHash = runGit(['rev-parse', '--short', 'HEAD'], cwd) ?? 'unknown'
  const message = runGit(['log', '-1', '--format=%s'], cwd) ?? 'no commits'
  const status = runGit(['status', '--porcelain'], cwd)
  const dirty = status !== undefined && status.length > 0

  return { branch, shortHash, message, dirty }
}

function formatGitContext(info: GitInfo): string {
  const dirtySuffix = info.dirty ? ' (dirty)' : ' (clean)'
  return `Git: ${info.branch} @ ${info.shortHash} — "${info.message}"${dirtySuffix}`
}

type ProjectContextPi = Pick<ExtensionAPI, 'on'>

interface ProjectContextState {
  cachedContext: string | undefined
}

function createProjectContextState(): ProjectContextState {
  return { cachedContext: undefined }
}

/** @public */
export function registerProjectContextHook(pi: ProjectContextPi): void {
  const state = createProjectContextState()

  pi.on('session_start', (_event, context) => {
    state.cachedContext = undefined

    const gitInfo = detectGitInfo(context.cwd)
    if (gitInfo !== undefined) {
      state.cachedContext = formatGitContext(gitInfo)
    }
  })

  pi.on('before_agent_start', (event) => {
    if (isCradleSubagentProcess()) return

    const contextBlock = state.cachedContext
    if (contextBlock === undefined) return

    return {
      systemPrompt: `<project_context>\n${contextBlock}\n</project_context>\n\n${event.systemPrompt}`,
    }
  })
}
