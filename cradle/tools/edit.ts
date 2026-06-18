import type {
  AgentToolResult,
  AgentToolUpdateCallback,
} from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import {
  defineTool,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { assertPermission } from '../config/settings.js'
import { checkFileBlocked } from '../utils/approval-state.js'
import { createDeferredOperationResult } from '../utils/deferred-operations.js'
import {
  hashLineContent,
  joinLines,
  splitLines,
  validateLineRangeEdit,
  type LineInfo,
  type LineRangeEdit,
  type LineRangeValidationError,
} from '../utils/hashlines.js'
import { normalizePath } from '../utils/helpers.js'
import {
  renderToolCallWithMode,
  renderToolResultWithMode,
} from '../utils/tool-render.js'
import { isCradleSubagentProcess } from '../utils/tool.js'

export interface EditToolParameters {
  path: string
  edits: LineRangeEdit[]
}

type ToolErrorResult<T> = AgentToolResult<T> & { isError: true }

function makeErrorResult(text: string): ToolErrorResult<undefined> {
  return {
    content: [{ type: 'text', text }],
    details: undefined,
    isError: true,
  }
}

function formatValidationError(error: LineRangeValidationError): string {
  switch (error.kind) {
    case 'non-integer-line': {
      return `edit: ${error.line} must be an integer, got ${String(error.value)}`
    }
    case 'non-positive-line': {
      return `edit: ${error.line} must be positive, got ${String(error.value)}`
    }
    case 'inverted-range': {
      return `edit: from (${String(error.from)}) must be <= to (${String(error.to)})`
    }
    case 'out-of-bounds': {
      return `edit: range ${String(error.from)}-${String(error.to)} is out of bounds for file with ${String(error.totalLines)} lines`
    }
    case 'empty-hash': {
      return `edit: ${error.endpoint}Hash must not be empty`
    }
    case 'malformed-hash': {
      return `edit: ${error.endpoint}Hash is malformed — expected 6 hex characters, got "${error.value}"`
    }
    case 'hash-mismatch': {
      return `edit: line ${String(error.line)} hash mismatch for ${error.endpoint}Hash — claimed "${error.claimed}", actual "${error.actual}". Current line ${String(error.line)}: "${error.currentLine}". Read the file again and retry with the current hash.`
    }
  }
}

function detectOverlaps(edits: readonly LineRangeEdit[]): string | undefined {
  const sorted = edits.toSorted((left, right) => left.from - right.from)
  for (const [index, current] of sorted.entries()) {
    const previous = sorted[index - 1]
    if (previous !== undefined && current.from <= previous.to) {
      return `edit: overlapping ranges ${String(previous.from)}-${String(previous.to)} and ${String(current.from)}-${String(current.to)}`
    }
  }
  return undefined
}

function buildLineInfos(lines: readonly string[]): LineInfo[] {
  return lines.map((content) => ({ hash: hashLineContent(content), content }))
}

/**
 * Apply validated edits to a line array bottom-to-top so earlier line
 * numbers remain stable.
 */
function applyEdits(
  lines: string[],
  sortedEdits: readonly LineRangeEdit[],
): string[] {
  const result = [...lines]
  for (const edit of sortedEdits.toReversed()) {
    const replacementLines = edit.newText === '' ? [] : edit.newText.split('\n')
    result.splice(edit.from - 1, edit.to - edit.from + 1, ...replacementLines)
  }
  return result
}

async function resolveWritableEditPath(
  filePathInput: string,
  context: ExtensionContext,
): Promise<string> {
  const resolvedPath = path.resolve(context.cwd, normalizePath(filePathInput))
  await assertPermission(resolvedPath, context.cwd, 'write')
  return resolvedPath
}

export async function executeApprovedEdit(
  _toolCallId: string,
  parameters: EditToolParameters,
  _signal: AbortSignal | undefined,
  _onUpdate: AgentToolUpdateCallback<unknown> | undefined,
  context: ExtensionContext,
): Promise<AgentToolResult<unknown> | ToolErrorResult<undefined>> {
  const filePath = await resolveWritableEditPath(parameters.path, context)

  if (parameters.edits.length === 0) {
    return makeErrorResult('edit: at least one edit entry is required')
  }

  const rawContent = await readFile(filePath, 'utf8')
  if (rawContent.includes('\0')) {
    return makeErrorResult(
      'edit: file appears to be binary (contains NUL bytes)',
    )
  }

  const split = splitLines(rawContent)
  if (split.lines.length === 0) {
    return makeErrorResult(
      'edit: cannot edit an empty file — use write instead',
    )
  }

  const lineInfos = buildLineInfos(split.lines)

  const sortedEdits = parameters.edits.toSorted(
    (left, right) => left.from - right.from,
  )

  for (const edit of sortedEdits) {
    const error = validateLineRangeEdit(edit, lineInfos)
    if (error !== undefined) {
      return makeErrorResult(formatValidationError(error))
    }
  }

  const overlapError = detectOverlaps(sortedEdits)
  if (overlapError !== undefined) {
    return makeErrorResult(overlapError)
  }

  const newLines = applyEdits(split.lines, sortedEdits)
  const newContent = joinLines({
    lines: newLines,
    hadFinalNewline: split.hadFinalNewline,
    lineEnding: split.lineEnding,
  })

  await writeFile(filePath, newContent)

  return {
    content: [
      {
        type: 'text',
        text: `Applied ${String(sortedEdits.length)} edit(s) to ${parameters.path}`,
      },
    ],
    details: undefined,
  }
}

/** @public */
export const editTool = defineTool({
  name: 'edit',
  label: 'Edit',
  description:
    'Modify existing text files by replacing inclusive line ranges anchored by current line hashes from the read tool. Re-read the target file before editing if hashes may be stale.',
  promptSnippet:
    'Edit existing files with targeted replacements; prefer this over write for file changes',
  promptGuidelines: [
    'Read the target file before editing.',
    'Use the exact line numbers and hashes shown by read.',
    'Prefer one edit call with multiple non-overlapping ranges for related changes in one file.',
    'If any hash mismatch occurs, read the file again and retry with current hashes.',
    'Do not guess hashes.',
    'Use write only for new files or deliberate whole-file replacement.',
  ],
  renderShell: 'default',
  parameters: Type.Object({
    path: Type.String({
      description: 'Path to the existing file to edit (relative or absolute)',
    }),
    edits: Type.Array(
      Type.Object(
        {
          from: Type.Number({
            description: 'Start line number (1-indexed, inclusive)',
          }),
          fromHash: Type.String({
            description: 'Hash of the start line content from read output',
          }),
          to: Type.Number({
            description: 'End line number (1-indexed, inclusive)',
          }),
          toHash: Type.String({
            description: 'Hash of the end line content from read output',
          }),
          newText: Type.String({
            description:
              'Replacement text for the range (empty string deletes)',
          }),
        },
        { additionalProperties: false },
      ),
      {
        description:
          'One or more line-range replacements anchored by endpoint hashes. Entries must be non-overlapping.',
      },
    ),
  }),
  async execute(toolCallId, parameters, signal, onUpdate, context) {
    const blocked = isCradleSubagentProcess()
      ? false
      : checkFileBlocked(context.sessionManager, parameters.path, 'edit')
    if (blocked) {
      const text = blocked.content[0]?.text ?? 'Blocked edit.'
      return createDeferredOperationResult(toolCallId, 'edit', parameters, text)
    }

    return executeApprovedEdit(
      toolCallId,
      parameters,
      signal,
      onUpdate,
      context,
    )
  },

  renderCall(args, theme, context) {
    return renderToolCallWithMode('edit', args.path, theme, context)
  },

  renderResult: renderToolResultWithMode,
})
