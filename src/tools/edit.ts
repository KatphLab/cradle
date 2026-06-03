import { Type } from '@earendil-works/pi-ai'
import {
  createEditToolDefinition,
  defineTool,
} from '@earendil-works/pi-coding-agent'
import path from 'node:path'

import { assertPermission } from '../config/settings.js'
import { normalizePath } from '../utils/helpers.js'

/** @public */
export const editTool = defineTool({
  name: 'edit',
  label: 'Edit',
  description:
    'Replace text in existing files. Each edit must match unique, non-overlapping text in the original file.',
  parameters: Type.Object({
    path: Type.String({
      description: 'Path to the file to edit (relative or absolute)',
    }),
    edits: Type.Array(
      Type.Object(
        {
          oldText: Type.String({
            description: 'Exact text to replace',
          }),
          newText: Type.String({
            description: 'Replacement text',
          }),
        },
        { additionalProperties: false },
      ),
      { description: 'One or more targeted replacements' },
    ),
  }),
  async execute(toolCallId, parameters, signal, onUpdate, context) {
    const filePath = path.resolve(context.cwd, normalizePath(parameters.path))
    await assertPermission(filePath, context.cwd, 'write')

    const piEdit = createEditToolDefinition(context.cwd)
    return piEdit.execute(toolCallId, parameters, signal, onUpdate, context)
  },
})
