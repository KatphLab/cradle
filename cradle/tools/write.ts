import type {
  AgentToolResult,
  AgentToolUpdateCallback,
} from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import {
  createWriteToolDefinition,
  defineTool,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import path from 'node:path'

import { assertPermission } from '../config/settings.js'
import { validateAgent } from '../lib/subagents/validate.js'
import { checkFileBlocked } from '../utils/approval-state.js'
import { createDeferredOperationResult } from '../utils/deferred-operations.js'
import { normalizePath } from '../utils/helpers.js'
import {
  renderToolCallWithMode,
  renderToolResultWithMode,
} from '../utils/tool-render.js'
import { isCradleSubagentProcess } from '../utils/tool.js'

export interface WriteToolParameters {
  path: string
  content: string
}

type ToolErrorResult<T> = AgentToolResult<T> & { isError: true }

export async function executeApprovedWrite(
  toolCallId: string,
  parameters: WriteToolParameters,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<unknown> | undefined,
  context: ExtensionContext,
): Promise<AgentToolResult<unknown> | ToolErrorResult<undefined>> {
  const filePath = path.resolve(context.cwd, normalizePath(parameters.path))
  await assertPermission(filePath, context.cwd, 'write')

  const isAgentFile =
    filePath.endsWith('.md') &&
    path.basename(path.dirname(filePath)) === 'agents'

  if (isAgentFile) {
    const agentSource = filePath.includes(path.join('.pi', 'agents'))
      ? 'project'
      : 'user'
    const validation = validateAgent(parameters.content, agentSource)
    if (!validation.valid) {
      const errors = validation.errors.join('\n')
      return {
        content: [
          {
            type: 'text',
            text: `Invalid agent definition:\n${errors}`,
          },
        ],
        details: undefined,
        isError: true,
      }
    }
  }

  const piWrite = createWriteToolDefinition(context.cwd)
  return piWrite.execute(toolCallId, parameters, signal, onUpdate, context)
}

/** @public */
export const writeTool = defineTool({
  name: 'write',
  label: 'Write',
  description:
    'Create a new file or intentionally replace an entire file. Do not use this for ordinary edits to existing files; use edit for targeted changes. Parent directories are created automatically.',
  promptSnippet:
    'Create new files or deliberate full-file replacements; prefer edit for modifying existing files',
  promptGuidelines: [
    'Use write for new files or when the user explicitly wants a complete file replacement.',
    'Do not use write just to modify part of an existing file; use edit with targeted replacements instead.',
    'Before overwriting an existing file, read it first unless the task clearly specifies full replacement content.',
  ],
  parameters: Type.Object({
    path: Type.String({
      description:
        'Path to the file to create or fully replace (relative or absolute)',
    }),
    content: Type.String({
      description: 'Complete content for the new or fully replaced file',
    }),
  }),
  async execute(toolCallId, parameters, signal, onUpdate, context) {
    const blocked = isCradleSubagentProcess()
      ? false
      : checkFileBlocked(context.sessionManager, parameters.path, 'write')
    if (blocked) {
      const text = blocked.content[0]?.text ?? 'Blocked write.'
      return createDeferredOperationResult(
        toolCallId,
        'write',
        parameters,
        text,
      )
    }

    return executeApprovedWrite(
      toolCallId,
      parameters,
      signal,
      onUpdate,
      context,
    )
  },

  renderCall(args, theme, context) {
    return renderToolCallWithMode('write', args.path, theme, context)
  },

  renderResult: renderToolResultWithMode,
})
