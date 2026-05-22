import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { assertReadAllowed } from '../config/settings.js'

const MAX_LINES = 2000
const MAX_BYTES = 50 * 1024

const IMAGE_EXTENSIONS = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
])

function normalizePath(inputPath: string): string {
  return inputPath.replace(/^@/, '')
}

function getMimeType(extension: string): string | undefined {
  return IMAGE_EXTENSIONS.get(extension.toLowerCase())
}

interface TruncationInfo {
  text: string
  truncated: boolean
}

function truncateText(
  content: string,
  offset?: number,
  limit?: number,
): TruncationInfo {
  const lines = content.split('\n')
  const startLine = offset && offset > 0 ? offset - 1 : 0
  let selected = lines.slice(startLine)

  if (limit !== undefined && limit > 0) {
    selected = selected.slice(0, limit)
  }

  let result = selected.join('\n')
  let truncated = false

  const encoder = new TextEncoder()
  const bytes = encoder.encode(result)
  if (bytes.length > MAX_BYTES) {
    let byteCount = 0
    let charIndex = 0
    for (; charIndex < result.length; charIndex++) {
      const charBytes = encoder.encode(result[charIndex]).length
      if (byteCount + charBytes > MAX_BYTES) break
      byteCount += charBytes
    }
    result = `${result.slice(0, charIndex)}\n\n[truncated: content exceeds 50KB]`
    truncated = true
  }

  const finalLines = result.split('\n')
  if (finalLines.length > MAX_LINES) {
    result = `${finalLines.slice(0, MAX_LINES).join('\n')}\n\n[truncated: content exceeds 2000 lines]`
    truncated = true
  }

  return { text: result, truncated }
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
  async execute(_toolCallId, parameters, _signal, _onUpdate, context) {
    const filePath = path.resolve(context.cwd, normalizePath(parameters.path))
    await assertReadAllowed(filePath, context.cwd)
    const fileStat = await stat(filePath)

    if (!fileStat.isFile()) {
      throw new Error(`not a file: ${parameters.path}`)
    }

    const extension = path.extname(filePath).toLowerCase()
    const mimeType = getMimeType(extension)

    if (mimeType) {
      const buffer = await readFile(filePath)
      return {
        content: [
          {
            type: 'image',
            data: buffer.toString('base64'),
            mimeType,
          },
        ],
        details: {
          path: parameters.path,
          size: fileStat.size,
          type: 'image',
          truncated: false,
        },
      }
    }

    const content = await readFile(filePath, 'utf8')
    const { text, truncated } = truncateText(
      content,
      parameters.offset,
      parameters.limit,
    )

    return {
      content: [{ type: 'text', text }],
      details: {
        path: parameters.path,
        truncated,
        type: 'text',
      },
    }
  },
})
