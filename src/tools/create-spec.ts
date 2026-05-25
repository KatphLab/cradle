import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { getSpecFilePath } from '../utils/spec-state.js'

export interface CreateSpecParameters {
  title: string
  content: string
  slug?: string
}

/** @public */
export const createSpecTool = defineTool({
  name: 'create_spec',
  label: 'Create Spec',
  description:
    'Create a Markdown spec artifact in .pi/specs. Use this after repository inspection when a concrete implementation plan is ready.',
  promptSnippet:
    'Create a Markdown spec artifact in .pi/specs from a concrete implementation plan.',
  promptGuidelines: [
    'Use create_spec only after inspecting relevant files and producing one concrete implementation plan.',
    'The create_spec content should include Goal, Changes, and Validation sections when applicable.',
  ],
  parameters: Type.Object(
    {
      title: Type.String({
        description: 'Short title for the spec and generated filename',
      }),
      content: Type.String({
        description: 'Markdown content of the spec artifact',
      }),
      slug: Type.Optional(
        Type.String({
          description:
            'Optional filename slug override. Kebab-case is applied automatically.',
        }),
      ),
    },
    { additionalProperties: false },
  ),
  async execute(
    _toolCallId,
    parameters: CreateSpecParameters,
    _signal,
    _onUpdate,
    context,
  ) {
    const filePath = getSpecFilePath(
      context.cwd,
      parameters.title,
      parameters.slug,
    )
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, ensureTrailingNewline(parameters.content), 'utf8')

    return {
      content: [{ type: 'text', text: `Created spec artifact: ${filePath}` }],
      details: { filePath },
    }
  },
})

function ensureTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`
}
