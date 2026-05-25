import { Type } from '@earendil-works/pi-ai'
import {
  createReadToolDefinition,
  defineTool,
} from '@earendil-works/pi-coding-agent'
import path from 'node:path'

import { assertPermission } from '../config/settings.js'
import { normalizePath } from '../utils/path.js'
import { optionalNumber } from '../utils/typebox.js'

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
    offset: optionalNumber('Line number to start reading from (1-indexed)'),
    limit: optionalNumber('Maximum number of lines to read'),
  }),
  async execute(toolCallId, parameters, signal, onUpdate, context) {
    const filePath = path.resolve(context.cwd, normalizePath(parameters.path))
    await assertPermission(filePath, context.cwd, 'read')

    const piRead = createReadToolDefinition(context.cwd)
    return piRead.execute(toolCallId, parameters, signal, onUpdate, context)
  },
})
