import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import type { Text } from '@earendil-works/pi-tui'

import type { ThemeLike } from '../../utils/theme.js'
import {
  renderCollapsedLines,
  renderExpandedLines,
  renderToolError,
} from '../../utils/tool-render.js'
import type { WebFetchDetails } from './types.js'
import { formatSize } from './utilities.js'

function buildItemLine(item: WebFetchDetails['items'][number]): string {
  const cacheLabel = item.cacheStatus === 'hit' ? ' (cached)' : ''
  if (item.cacheStatus === 'error') {
    return `${item.url} → fetch failed`
  }
  return `${item.url} → ${item.artifactPath} (${String(item.status)} ${item.contentType}, ${formatSize(item.size)})${cacheLabel}`
}

function buildHeader(itemCount: number, theme: ThemeLike): string {
  const urlCount = String(itemCount)
  const plural = itemCount === 1 ? '' : 's'
  const headerTitle = theme.fg('toolTitle', theme.bold('web_fetch '))
  const headerCount = theme.fg('accent', `${urlCount} URL${plural} fetched`)
  return `${headerTitle}${headerCount}`
}

/** @public */
export function renderWebFetchResult(
  result: AgentToolResult<WebFetchDetails | undefined>,
  expanded: boolean,
  theme: ThemeLike,
): Text {
  const details = result.details
  if (details === undefined) {
    return renderToolError(result)
  }
  const header = buildHeader(details.items.length, theme)
  const lines = details.items.map((item) => buildItemLine(item))
  if (expanded) {
    return renderExpandedLines(header, lines, theme)
  }
  return renderCollapsedLines(header, lines, theme)
}
