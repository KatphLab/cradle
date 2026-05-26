import { Type } from '@earendil-works/pi-ai'
import {
  createFindToolDefinition,
  defineTool,
} from '@earendil-works/pi-coding-agent'
import { glob, stat } from 'node:fs/promises'
import path from 'node:path'

import { resolveSearchPath } from '../utils/search-path.js'
import { optionalNumber, optionalString } from '../utils/typebox.js'

/** @public */
export const globTool = defineTool({
  name: 'glob',
  label: 'Glob',
  description:
    'Discover paths by glob patterns. Returns matching file paths relative to the search directory.',
  parameters: Type.Object({
    pattern: Type.String({
      description:
        'Glob pattern to match files, e.g. "*.ts" or "src/**/*.spec.ts"',
    }),
    path: optionalString('Directory to search in (default: current directory)'),
    limit: optionalNumber('Maximum number of results'),
    exclude: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Glob patterns to exclude from results',
      }),
    ),
  }),
  async execute(toolCallId, parameters, signal, onUpdate, context) {
    await resolveSearchPath(parameters, context)

    const piFind = createFindToolDefinition(context.cwd, {
      operations: {
        exists: async (absolutePath) => {
          try {
            await stat(absolutePath)
            return true
          } catch {
            return false
          }
        },
        glob: async (pattern, cwd, options) => {
          const results: string[] = []
          const excludePatterns = [
            '**/node_modules/**',
            '**/.git/**',
            ...(parameters.exclude ?? []),
          ]
          for await (const entry of glob(pattern, {
            cwd,
            exclude: excludePatterns,
          })) {
            results.push(path.resolve(cwd, entry))
            if (results.length >= options.limit) break
          }
          return results
        },
      },
    })

    return piFind.execute(
      toolCallId,
      {
        pattern: parameters.pattern,
        ...(parameters.path !== undefined && { path: parameters.path }),
        ...(parameters.limit !== undefined && { limit: parameters.limit }),
      },
      signal,
      onUpdate,
      context,
    )
  },
})
