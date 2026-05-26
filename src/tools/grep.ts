import { Type } from '@earendil-works/pi-ai'
import {
  createGrepToolDefinition,
  defineTool,
} from '@earendil-works/pi-coding-agent'
import { resolveSearchPath } from '../utils/search-path.js'
import {
  optionalBoolean,
  optionalNumber,
  optionalString,
} from '../utils/typebox.js'

/** @public */
export const grepTool = defineTool({
  name: 'grep',
  label: 'Grep',
  description:
    'Search file contents using ripgrep-like semantics. Supports regex or literal patterns, glob filtering, case-insensitive search, and context lines.',
  parameters: Type.Object({
    pattern: Type.String({
      description: 'Search pattern (regex or literal string)',
    }),
    path: optionalString(
      'Directory or file to search (default: current directory)',
    ),
    glob: optionalString('Filter files by glob pattern, e.g. "*.ts"'),
    ignoreCase: optionalBoolean('Case-insensitive search'),
    literal: optionalBoolean(
      'Treat pattern as literal string instead of regex',
    ),
    context: optionalNumber(
      'Number of context lines before and after each match',
    ),
    limit: optionalNumber('Maximum number of matches to return'),
  }),
  async execute(toolCallId, parameters, signal, onUpdate, context) {
    await resolveSearchPath(parameters, context)

    const piGrep = createGrepToolDefinition(context.cwd)
    return piGrep.execute(toolCallId, parameters, signal, onUpdate, context)
  },
})
