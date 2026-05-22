import { Type } from '@earendil-works/pi-ai'
import {
  createReadToolDefinition,
  defineTool,
} from '@earendil-works/pi-coding-agent'
import path from 'node:path'

import { assertReadAllowed } from '../config/settings.js'

function normalizePath(inputPath: string): string {
  return inputPath.replace(/^@/, '')
}

/** @public */
export const readTool = defineTool({
  name: 'read',
  label: 'Read',
  description:
    'Read file contents. Supports text files and images (jpg, png, gif, webp). For text files, output is truncated to 2000 lines or 50KB (whichever hits first). Use offset and limit for large files. When you need the full file, continue with offset until complete.',
  parameters: Type.Object({
    path: Type.String({
      description: 'Path to the file to read (relative or absolute)',
    }),
    offset: Type.Optional(
      Type.Number({
        description: 'Line number to start reading from (1-indexed)',
      }),
    ),
    limit: Type.Optional(
      Type.Number({ description: 'Maximum number of lines to read' }),
    ),
  }),
  async execute(toolCallId, parameters, signal, onUpdate, context) {
    const filePath = path.resolve(context.cwd, normalizePath(parameters.path))
    await assertReadAllowed(filePath, context.cwd)

    const piRead = createReadToolDefinition(context.cwd)
    return piRead.execute(toolCallId, parameters, signal, onUpdate, context)
  },
})
