import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { getMarkdownTheme } from '@earendil-works/pi-coding-agent'
import { Container, Markdown, Spacer, Text } from '@earendil-works/pi-tui'

import type { MarkdownTheme } from '@earendil-works/pi-tui'
import type { ThemeLike } from '../../utils/helpers.js'
import { renderToolError } from '../../utils/tool.js'
import type {
  IterativeRetrievalDetails,
  IterativeRetrievalResultItem,
} from './types.js'

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

const LABEL = 'Iterative Retrieval'

function renderTaskPreview(task: string, limit: number): string {
  if (task.length > limit) {
    return `${task.slice(0, limit)}...`
  }
  return task
}

// ---- renderCall ----

function getCallText(args: Record<string, unknown>, theme: ThemeLike): string {
  const rawTask = args['task']
  const task = typeof rawTask === 'string' ? rawTask : ''
  const preview = renderTaskPreview(task, 60)
  let text = theme.fg('toolTitle', theme.bold(`${LABEL} `))
  text += '\n  '
  text += theme.fg('dim', preview)
  return text
}

/** @public */
export function buildRenderCall(
  args: Record<string, unknown>,
  theme: ThemeLike,
): Text {
  return new Text(getCallText(args, theme), 0, 0)
}

// ---- renderResult helpers ----

function getSuccessIcon(theme: ThemeLike): string {
  return theme.fg('success', '\u2713')
}

function getCollapsedItemLine(
  item: IterativeRetrievalResultItem,
  index: number,
): string {
  return `${String(index + 1)}. ${item.path} (${String(item.relevance)})`
}

function getCollapsedItems(
  items: IterativeRetrievalResultItem[],
  limit: number,
  theme: ThemeLike,
): string[] {
  const lines: string[] = []
  for (const [index, item] of items.slice(0, limit).entries()) {
    lines.push(`  ${getCollapsedItemLine(item, index)}`)
  }
  if (items.length > limit) {
    lines.push(theme.fg('dim', `  ... +${String(items.length - limit)} more`))
  }
  return lines
}

function getCollapsedGapLines(gaps: string[], theme: ThemeLike): string[] {
  if (gaps.length === 0) return []
  const lines: string[] = ['', theme.fg('dim', 'Gaps:')]
  for (const gap of gaps.slice(0, 2)) {
    lines.push(`  - ${gap}`)
  }
  if (gaps.length > 2) {
    lines.push(theme.fg('dim', `  ... +${String(gaps.length - 2)} more`))
  }
  return lines
}

function getCollapsedText(
  details: IterativeRetrievalDetails,
  theme: ThemeLike,
): string {
  const allItems = [...details.paths, ...details.sources]
  const totalItems = allItems.length
  const countLabel = `${String(totalItems)} result${totalItems === 1 ? '' : 's'} in ${String(details.cycles)} cycle${details.cycles === 1 ? '' : 's'}`

  const icon = getSuccessIcon(theme)
  const title = theme.fg('toolTitle', theme.bold(LABEL))
  const header = `${icon} ${title}`
  const summary = theme.fg('accent', countLabel)

  let text = `${header}\n${summary}`

  const itemLines = getCollapsedItems(allItems, 3, theme)
  if (itemLines.length > 0) {
    text += `\n${itemLines.join('\n')}`
  }

  const gapLines = getCollapsedGapLines(details.gaps, theme)
  if (gapLines.length > 0) {
    text += `\n${gapLines.join('\n')}`
  }

  text += `\n${theme.fg('muted', '(Ctrl+O to expand)')}`

  return text
}

function getFullOutput(result: AgentToolResult<unknown>): string {
  const textContent = result.content.find(
    (c: { type: string }) => c.type === 'text',
  )
  return textContent !== undefined && 'text' in textContent
    ? textContent.text
    : ''
}

function buildExpandedContainer(
  result: AgentToolResult<unknown>,
  details: IterativeRetrievalDetails,
  theme: ThemeLike,
  mdTheme: MarkdownTheme,
): Container {
  const icon = getSuccessIcon(theme)
  const title = theme.fg('toolTitle', theme.bold(LABEL))

  const container = new Container()
  container.addChild(new Text(`${icon} ${title}`, 0, 0))
  container.addChild(new Spacer(1))
  container.addChild(
    new Text(
      theme.fg('muted', '\u2500\u2500\u2500 Task \u2500\u2500\u2500'),
      0,
      0,
    ),
  )
  container.addChild(new Text(theme.fg('dim', details.task), 0, 0))
  container.addChild(new Spacer(1))
  container.addChild(
    new Text(
      theme.fg('muted', '\u2500\u2500\u2500 Output \u2500\u2500\u2500'),
      0,
      0,
    ),
  )
  container.addChild(new Spacer(1))

  const output = getFullOutput(result)
  if (output.length > 0) {
    container.addChild(new Markdown(output.trim(), 0, 0, mdTheme))
  } else {
    container.addChild(new Text(theme.fg('muted', '(no output)'), 0, 0))
  }

  return container
}

// ---- renderResult ----

/** @public */
export function renderIterativeRetrievalResult(
  result: AgentToolResult<unknown>,
  expanded: boolean,
  theme: ThemeLike,
): Text | Container {
  if (!isIterativeRetrievalDetails(result.details)) {
    return renderToolError(result)
  }

  const details = result.details

  if (expanded) {
    const mdTheme = getMarkdownTheme()
    return buildExpandedContainer(result, details, theme, mdTheme)
  }

  return new Text(getCollapsedText(details, theme), 0, 0)
}
