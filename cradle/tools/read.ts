import { Type } from '@earendil-works/pi-ai'
import {
  createReadToolDefinition,
  defineTool,
} from '@earendil-works/pi-coding-agent'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { assertPermission } from '../config/settings.js'
import { formatHashline, splitLines } from '../utils/hashlines.js'
import { normalizePath } from '../utils/helpers.js'
import {
  renderToolCallWithMode,
  renderToolResultWithMode,
} from '../utils/tool-render.js'
import { optionalNumber } from '../utils/typebox.js'

const MAX_TEXT_LINES = 2000
const MAX_TEXT_BYTES = 50 * 1024
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])

function isImagePath(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`read: ${name} must be a positive integer`)
  }
  return value
}

function formatTextReadOutput(
  content: string,
  offset: number | undefined,
  limit: number | undefined,
): string {
  const split = splitLines(content)
  const startLine = normalizePositiveInteger(offset, 1, 'offset')
  const requestedLimit = normalizePositiveInteger(
    limit,
    MAX_TEXT_LINES,
    'limit',
  )
  const maxLines = Math.min(requestedLimit, MAX_TEXT_LINES)
  const selectedLines = split.lines.slice(
    startLine - 1,
    startLine - 1 + maxLines,
  )

  const outputLines: string[] = []
  let byteCount = 0
  for (const [index, line] of selectedLines.entries()) {
    const hashline = formatHashline(startLine + index, line)
    const separatorBytes = outputLines.length === 0 ? 0 : 1
    const nextBytes = Buffer.byteLength(hashline, 'utf8') + separatorBytes
    if (byteCount + nextBytes > MAX_TEXT_BYTES) break
    outputLines.push(hashline)
    byteCount += nextBytes
  }

  return outputLines.join('\n')
}

/** @public */
export const readTool = defineTool({
  name: 'read',
  label: 'Read',
  description:
    'Read file contents. Supports text files and images (jpg, png, gif, webp). Text files are returned as hashlines (`line:hash| content`) and truncated to 2000 lines or 50KB (whichever hits first). Use offset and limit for large files. When you need the full file, continue with offset until complete.',
  parameters: Type.Object({
    path: Type.String({
      description: 'Path to the file to read (relative or absolute)',
    }),
    offset: optionalNumber('Line number to start reading from (1-indexed)'),
    limit: optionalNumber('Maximum number of lines to read'),
  }),
  async execute(toolCallId, parameters, signal, onUpdate, context) {
    const normalizedPath = normalizePath(parameters.path)
    const filePath = path.resolve(context.cwd, normalizedPath)
    await assertPermission(filePath, context.cwd, 'read')

    if (isImagePath(filePath)) {
      const piRead = createReadToolDefinition(context.cwd)
      return piRead.execute(
        toolCallId,
        { ...parameters, path: normalizedPath },
        signal,
        onUpdate,
        context,
      )
    }

    const content = await readFile(filePath, 'utf8')
    if (content.includes('\0')) {
      throw new Error('read: file appears to be binary (contains NUL bytes)')
    }

    return {
      content: [
        {
          type: 'text',
          text: formatTextReadOutput(
            content,
            parameters.offset,
            parameters.limit,
          ),
        },
      ],
      details: undefined,
    }
  },

  renderCall(args, theme, context) {
    return renderToolCallWithMode('read', args.path, theme, context)
  },

  renderResult: renderToolResultWithMode,
})
