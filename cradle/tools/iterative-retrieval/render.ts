import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import type { Text } from '@earendil-works/pi-tui'

import type { ThemeLike } from '../../utils/helpers.js'
import {
  renderCollapsedLines,
  renderExpandedLines,
  renderToolError,
} from '../../utils/tool.js'
import type { IterativeRetrievalDetails } from './types.js'

function isIterativeRetrievalDetails(
  value: unknown,
): value is IterativeRetrievalDetails {
  if (typeof value !== 'object' || value === null) return false
  return (
    'task' in value &&
    typeof value.task === 'string' &&
    'cycles' in value &&
    typeof value.cycles === 'number' &&
    'paths' in value &&
    Array.isArray(value.paths) &&
    'sources' in value &&
    Array.isArray(value.sources)
  )
}

function buildCollapsedLine(
  item: { path: string; relevance: number },
  index: number,
): string {
  return `${String(index + 1)}. ${item.path} (${String(item.relevance)})`
}

function buildExpandedLine(
  item: { path: string; relevance: number; reason: string },
  index: number,
  theme: ThemeLike,
): string {
  const score = theme.fg('accent', String(item.relevance))
  return `${String(index + 1)}. ${item.path}\n     relevance: ${score} — ${item.reason}`
}

function buildHeader(
  details: IterativeRetrievalDetails,
  theme: ThemeLike,
): string {
  const headerTitle = theme.fg('toolTitle', theme.bold('iterative_retrieval '))
  const totalItems = details.paths.length + details.sources.length
  const countLabel = `${String(totalItems)} result${totalItems === 1 ? '' : 's'} in ${String(details.cycles)} cycle${details.cycles === 1 ? '' : 's'}`
  const headerCount = theme.fg('accent', countLabel)
  return `${headerTitle}${headerCount}`
}

/** @public */
export function renderIterativeRetrievalResult(
  result: AgentToolResult<unknown>,
  expanded: boolean,
  theme: ThemeLike,
): Text {
  if (!isIterativeRetrievalDetails(result.details)) {
    return renderToolError(result)
  }

  const details = result.details
  const header = buildHeader(details, theme)
  const allItems = [...details.paths, ...details.sources]

  if (expanded) {
    const lines = allItems.map((item, index) =>
      buildExpandedLine(item, index, theme),
    )
    if (details.gaps.length > 0) {
      lines.push('', theme.fg('dim', 'Gaps:'))
      for (const gap of details.gaps) {
        lines.push(`  - ${gap}`)
      }
    }
    return renderExpandedLines(header, lines, theme)
  }

  const lines = allItems.map((item, index) => buildCollapsedLine(item, index))
  return renderCollapsedLines(header, lines, theme)
}
