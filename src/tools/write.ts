import { Type } from '@earendil-works/pi-ai'
import {
  createWriteToolDefinition,
  defineTool,
} from '@earendil-works/pi-coding-agent'
import path from 'node:path'

import { assertPermission } from '../config/settings.js'
import { validateAgent } from '../subagents/validate.js'
import { normalizePath } from '../utils/path.js'

/** @public */
export const writeTool = defineTool({
  name: 'write',
  label: 'Write',
  description:
    'Create or overwrite a file with the provided content. Parent directories are created automatically.',
  parameters: Type.Object({
    path: Type.String({
      description: 'Path to the file to write (relative or absolute)',
    }),
    content: Type.String({
      description: 'Content to write to the file',
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
