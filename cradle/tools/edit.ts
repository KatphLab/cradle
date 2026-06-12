import { Type } from '@earendil-works/pi-ai'
import {
  createEditToolDefinition,
  defineTool,
} from '@earendil-works/pi-coding-agent'
import path from 'node:path'

import { assertPermission } from '../config/settings.js'
import { normalizePath } from '../utils/helpers.js'
import {
  renderToolCallWithMode,
  renderToolResultWithMode,
} from '../utils/tool-render.js'

/** @public */
export const editTool = defineTool({
  name: 'edit',
  label: 'Edit',
  description:
    'Preferred tool for modifying existing files. Replace one or more small, unique text blocks without rewriting the whole file. Matching tolerates common whitespace and Unicode quote/dash/space differences; oldText must still identify a unique, non-overlapping region.',
  promptSnippet:
    'Edit existing files with targeted replacements; prefer this over write for file changes',
  promptGuidelines: [
    'Use edit, not write, when changing an existing file unless you truly need to replace the entire file.',
    'Keep each oldText block as small as possible while still unique; include nearby context only to disambiguate duplicate matches.',
    'Use multiple edits[] entries for separate changes in one file, and merge nearby or touching changes into one entry.',
    'The edit matcher tolerates trailing whitespace and common Unicode quote, dash, and space differences, so do not fall back to write just because exact formatting is uncertain.',
  ],
  renderShell: 'default',
  parameters: Type.Object({
    path: Type.String({
      description: 'Path to the existing file to edit (relative or absolute)',
    }),
    edits: Type.Array(
      Type.Object(
        {
          oldText: Type.String({
            description:
              'Small unique text block to replace. Include enough context to avoid duplicate matches, but do not include large unchanged regions.',
          }),
          newText: Type.String({
            description: 'Replacement text for this block',
          }),
        },
        { additionalProperties: false },
      ),
      {
        description:
          'One or more targeted replacements matched against the original file. Entries must be unique and non-overlapping.',
      },
    ),
  }),
  async execute(toolCallId, parameters, signal, onUpdate, context) {
    const filePath = path.resolve(context.cwd, normalizePath(parameters.path))
    await assertPermission(filePath, context.cwd, 'write')

    const piEdit = createEditToolDefinition(context.cwd)
    return piEdit.execute(toolCallId, parameters, signal, onUpdate, context)
  },

  renderCall(args, theme, context) {
    return renderToolCallWithMode('edit', args.path, theme, context)
  },

  renderResult: renderToolResultWithMode,
})
