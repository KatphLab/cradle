import { Type } from '@earendil-works/pi-ai'
import {
  createLsToolDefinition,
  defineTool,
} from '@earendil-works/pi-coding-agent'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import { assertPermission } from '../config/settings.js'
import { normalizePath } from '../utils/helpers.js'
import { optionalNumber } from '../utils/typebox.js'

function shouldIgnore(entry: string, patterns: string[]): boolean {
  const normalized = entry.endsWith('/') ? entry.slice(0, -1) : entry
  return patterns.some((pattern) => {
    const p = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern
    return normalized === p
  })
}

/** @public */
export const lsTool = defineTool({
  name: 'ls',
  label: 'LS',
  description:
    'List directory contents. Returns entries sorted alphabetically, with "/" suffix for directories. Output is truncated to 500 entries.',
  parameters: Type.Object({
    path: Type.String({
      description: 'Directory path to list (relative or absolute)',
    }),
    limit: optionalNumber('Maximum number of entries to return'),
    ignore: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Entry names to ignore (exact match)',
      }),
    ),
  }),
  async execute(toolCallId, parameters, signal, onUpdate, context) {
    const directoryPath = path.resolve(
      context.cwd,
      normalizePath(parameters.path),
    )
    await assertPermission(directoryPath, context.cwd, 'read')

    const piLs = createLsToolDefinition(context.cwd, {
      operations: {
        exists: async (absolutePath) => {
          try {
            await stat(absolutePath)
            return true
          } catch {
            return false
          }
        },
        stat: async (absolutePath) => {
          const s = await stat(absolutePath)
          return { isDirectory: () => s.isDirectory() }
        },
        readdir: async (absolutePath) => {
          const entries = await readdir(absolutePath)
          const ignore = parameters.ignore
          if (!ignore || ignore.length === 0) {
            return entries
          }
          return entries.filter((entry) => !shouldIgnore(entry, ignore))
        },
      },
    })

    return piLs.execute(
      toolCallId,
      {
        path: parameters.path,
        ...(parameters.limit !== undefined && { limit: parameters.limit }),
      },
      signal,
      onUpdate,
      context,
    )
  },
})
