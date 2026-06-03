import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { Text } from '@earendil-works/pi-tui'

import type { ThemeLike } from '../../utils/theme.js'
import type { WebFetchDetails } from './types.js'
import { formatSize } from './utilities.js'

const COLLAPSED_ITEM_LIMIT = 3
const COLLAPSED_LINE_LIMIT = 80

function buildItemLine(item: WebFetchDetails['items'][number]): string {
  return `${item.url} → ${item.filePath} (${String(item.status)} ${item.contentType}, ${formatSize(item.size)})`
}

function renderCollapsedResult(
  details: WebFetchDetails,
  theme: ThemeLike,
): Text {
  const urlCount = String(details.items.length)
  const plural = details.items.length === 1 ? '' : 's'
  const headerTitle = theme.fg('toolTitle', theme.bold('web_fetch '))
  const headerCount = theme.fg('accent', `${urlCount} URL${plural} fetched`)
  const header = `${headerTitle}${headerCount}`

  const shown = details.items.slice(0, COLLAPSED_ITEM_LIMIT)
  const lines = shown.map((item) => {
    const text = buildItemLine(item)
    const truncated =
      text.length > COLLAPSED_LINE_LIMIT
        ? `${text.slice(0, COLLAPSED_LINE_LIMIT)}...`
        : text
    return `  ${truncated}`
  })
  const remaining = details.items.length - COLLAPSED_ITEM_LIMIT
  if (remaining > 0) {
    lines.push(theme.fg('dim', `  ... +${String(remaining)} more`))
  }
  return new Text(`${header}\n${lines.join('\n')}`, 0, 0)
}

function renderExpandedResult(
  details: WebFetchDetails,
  theme: ThemeLike,
): Text {
  const urlCount = String(details.items.length)
  const plural = details.items.length === 1 ? '' : 's'
  const headerTitle = theme.fg('toolTitle', theme.bold('web_fetch '))
  const headerCount = theme.fg('accent', `${urlCount} URL${plural} fetched`)
  const header = `${headerTitle}${headerCount}`
  const separator = theme.fg('dim', '─'.repeat(40))
  const lines = details.items.map((item) => {
    return `  ${separator}\n  ${buildItemLine(item)}`
  })
  return new Text(`${header}${lines.join('\n')}`, 0, 0)
}

function renderErrorResult(
  result: AgentToolResult<WebFetchDetails | undefined>,
): Text {
  const textContent = result.content.find(
    (c: { type: string }) => c.type === 'text',
  )
  const text =
    textContent !== undefined && 'text' in textContent ? textContent.text : ''
  return new Text(text, 0, 0)
}

/** @public */
export function renderWebFetchResult(
  result: AgentToolResult<WebFetchDetails | undefined>,
  expanded: boolean,
  theme: ThemeLike,
): Text {
  const details = result.details
  if (details === undefined) {
    return renderErrorResult(result)
  }
  if (expanded) {
    return renderExpandedResult(details, theme)
  }
  return renderCollapsedResult(details, theme)
}
