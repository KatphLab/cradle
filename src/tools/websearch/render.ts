import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import type { Text } from '@earendil-works/pi-tui'

import type { ThemeLike } from '../../utils/helpers.js'
import {
  renderCollapsedLines,
  renderExpandedLines,
  renderToolError,
} from '../../utils/tool.js'
import type { WebSearchDetails } from './types.js'

function buildCollapsedItemLine(
  item: WebSearchDetails['items'][number],
  index: number,
): string {
  const title = item.title || '(no title)'
  return `${String(index + 1)}. ${title}`
}

function buildExpandedItemLine(
  item: WebSearchDetails['items'][number],
  index: number,
  theme: ThemeLike,
): string {
  const title = item.title || '(no title)'
  const url = item.url || '(no url)'
  const desc = item.description || '(no description)'
  return `${String(index + 1)}. ${title}\n     ${theme.fg('dim', url)}\n     ${desc}`
}

function buildHeader(details: WebSearchDetails, theme: ThemeLike): string {
  const headerTitle = theme.fg('toolTitle', theme.bold('web_search '))
  const countLabel = `${String(details.resultCount)} result${details.resultCount === 1 ? '' : 's'}`
  const headerCount = theme.fg('accent', countLabel)
  return `${headerTitle}${headerCount}`
}

/** @public */
export function renderWebSearchResult(
  result: AgentToolResult<WebSearchDetails | undefined>,
  expanded: boolean,
  theme: ThemeLike,
): Text {
  const details = result.details
  if (details === undefined) {
    return renderToolError(result)
  }
  const header = buildHeader(details, theme)
  if (expanded) {
    const lines = details.items.map((item, index) =>
      buildExpandedItemLine(item, index, theme),
    )
    return renderExpandedLines(header, lines, theme)
  }
  const lines = details.items.map((item, index) =>
    buildCollapsedItemLine(item, index),
  )
  return renderCollapsedLines(header, lines, theme)
}
