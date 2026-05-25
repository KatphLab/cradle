import { Type } from '@earendil-works/pi-ai'
import {
  createWriteToolDefinition,
  defineTool,
} from '@earendil-works/pi-coding-agent'
import path from 'node:path'

import { assertWriteAllowed } from '../config/settings.js'
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
    await assertWriteAllowed(filePath, context.cwd)

    const piWrite = createWriteToolDefinition(context.cwd)
    return piWrite.execute(toolCallId, parameters, signal, onUpdate, context)
  },
})
