import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { Text } from '@earendil-works/pi-tui'

import type { ThemeLike } from './helpers.js'

const CRADLE_SUBAGENT_ENV = 'CRADLE_SUBAGENT'
const HIDDEN_TOOLS = new Set<string>([
  'web_fetch_internal',
  'web_search_internal',
])

/** Check if the current process is running as a cradle subagent. */
export function isCradleSubagentProcess(): boolean {
  return process.env[CRADLE_SUBAGENT_ENV] === '1'
}

/** Filter out tools that should be hidden from the main agent. */
export function filterMainAgentTools(toolNames: readonly string[]): string[] {
  if (isCradleSubagentProcess()) {
    return [...toolNames]
  }
  const result: string[] = []
  for (const name of toolNames) {
    if (!HIDDEN_TOOLS.has(name)) {
      result.push(name)
    }
  }
  return result
}

const ITEM_LIMIT = 3
const CHAR_LIMIT = 80

export function renderCollapsedLines(
  header: string,
  lines: string[],
  theme: ThemeLike,
): Text {
  const shown = lines.slice(0, ITEM_LIMIT)
  const truncated = shown.map((line) => {
    const text =
      line.length > CHAR_LIMIT ? `${line.slice(0, CHAR_LIMIT)}...` : line
    return `  ${text}`
  })
  const remaining = lines.length - ITEM_LIMIT
  if (remaining > 0) {
    truncated.push(theme.fg('dim', `  ... +${String(remaining)} more`))
  }
  return new Text(`${header}\n${truncated.join('\n')}`, 0, 0)
}

export function renderExpandedLines(
  header: string,
  lines: string[],
  theme: ThemeLike,
): Text {
  const separator = theme.fg('dim', '─'.repeat(40))
  const formatted = lines.map((line) => `  ${separator}\n  ${line}`)
  return new Text(`${header}${formatted.join('\n')}`, 0, 0)
}

export function renderToolError(result: AgentToolResult<unknown>): Text {
  const textContent = result.content.find(
    (c: { type: string }) => c.type === 'text',
  )
  const text =
    textContent !== undefined && 'text' in textContent ? textContent.text : ''
  return new Text(text, 0, 0)
}
