import { Type } from '@earendil-works/pi-ai'
import {
  createWriteToolDefinition,
  defineTool,
} from '@earendil-works/pi-coding-agent'
import path from 'node:path'

import { assertPermission } from '../config/settings.js'
import { validateAgent } from '../lib/subagents/validate.js'
import { normalizePath } from '../utils/helpers.js'

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
  },
})
