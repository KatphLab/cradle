import { getMarkdownTheme } from '@earendil-works/pi-coding-agent'
import { Container, Markdown, Spacer, Text } from '@earendil-works/pi-tui'

import type { MarkdownTheme } from '@earendil-works/pi-tui'
import type {
  DisplayItem,
  SingleResult,
  SubagentDetails,
  UsageStats,
} from './types.js'
import {
  formatToolCall,
  formatUsageStats,
  getDisplayItems,
  getFinalOutput,
  isFailedResult,
} from './utilities.js'

interface ThemeLike {
  fg(color: string, text: string): string
  bold(text: string): string
}

interface ParallelSummary {
  icon: string
  status: string
  isRunning: boolean
}

interface ParallelCounts {
  running: number
  successCount: number
  failCount: number
}

function getLimitedDisplayItems(
  items: DisplayItem[],
  limit: number | undefined,
): DisplayItem[] {
  return limit ? items.slice(-limit) : items
}

function getSkippedDisplayItemCount(
  items: DisplayItem[],
  limit: number | undefined,
): number {
  return limit && items.length > limit ? items.length - limit : 0
}

function getPreviewText(item: DisplayItem, expanded: boolean): string {
  if (item.type !== 'text') return ''
  if (expanded) return item.text
  return item.text.split('\n').slice(0, 3).join('\n')
}

function formatToolCallText(item: DisplayItem, theme: ThemeLike): string {
  if (item.type !== 'toolCall') return ''
  const prefix = theme.fg('muted', '→ ')
  return prefix + formatToolCall(item.name, item.args, theme.fg.bind(theme))
}

function renderDisplayItemsToText(
  items: DisplayItem[],
  limit: number | undefined,
  expanded: boolean,
  theme: ThemeLike,
): string {
  const toShow = getLimitedDisplayItems(items, limit)
  const skipped = getSkippedDisplayItemCount(items, limit)
  let text = ''
  if (skipped > 0) text += theme.fg('muted', `... ${skipped} earlier items\n`)
  for (const item of toShow) {
    if (item.type === 'text') {
      const preview = getPreviewText(item, expanded)
      text += `${theme.fg('toolOutput', preview)}\n`
    } else {
      text += `${formatToolCallText(item, theme)}\n`
    }
  }
  return text.trimEnd()
}

function buildAggregateUsage(results: SingleResult[]): UsageStats {
  const total = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    turns: 0,
    contextTokens: 0,
  }
  for (const result of results) {
    total.input += result.usage.input
    total.output += result.usage.output
    total.cacheRead += result.usage.cacheRead
    total.cacheWrite += result.usage.cacheWrite
    total.cost += result.usage.cost
    total.turns += result.usage.turns
    total.contextTokens += result.usage.contextTokens
  }
  return total
}

function getSuccessIcon(isError: boolean, theme: ThemeLike): string {
  if (isError) return theme.fg('error', '✗')
  return theme.fg('success', '✓')
}

function getSingleResultHeader(result: SingleResult, theme: ThemeLike): string {
  const isError = isFailedResult(result)
  const icon = getSuccessIcon(isError, theme)
  const agentName = theme.fg('toolTitle', theme.bold(result.agent))
  const agentSource = theme.fg('muted', ` (${result.agentSource})`)
  let header = `${icon} ${agentName}${agentSource}`
  if (isError && result.stopReason) {
    const stopReason = `[${result.stopReason}]`
    header += ` ${theme.fg('error', stopReason)}`
  }
  return header
}

function formatErrorMessage(errorMessage: string, theme: ThemeLike): string {
  const message = `Error: ${errorMessage}`
  return theme.fg('error', message)
}

function addTaskSection(
  container: Container,
  task: string,
  theme: ThemeLike,
): void {
  container.addChild(new Spacer(1))
  container.addChild(new Text(theme.fg('muted', '─── Task ───'), 0, 0))
  container.addChild(new Text(theme.fg('dim', task), 0, 0))
  container.addChild(new Spacer(1))
  container.addChild(new Text(theme.fg('muted', '─── Output ───'), 0, 0))
}

function addToolCallItems(
  container: Container,
  displayItems: DisplayItem[],
  theme: ThemeLike,
): void {
  for (const item of displayItems) {
    if (item.type === 'toolCall') {
      container.addChild(new Text(formatToolCallText(item, theme), 0, 0))
    }
  }
}

function addMarkdownOutput(
  container: Container,
  finalOutput: string,
  mdTheme: MarkdownTheme,
): void {
  container.addChild(new Spacer(1))
  container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme))
}

function addExpandedOutput(
  container: Container,
  displayItems: DisplayItem[],
  finalOutput: string,
  theme: ThemeLike,
  mdTheme: MarkdownTheme,
): void {
  if (displayItems.length === 0 && !finalOutput) {
    container.addChild(new Text(theme.fg('muted', '(no output)'), 0, 0))
    return
  }
  addToolCallItems(container, displayItems, theme)
  if (finalOutput) addMarkdownOutput(container, finalOutput, mdTheme)
}

function addUsageLine(
  container: Container,
  usage: UsageStats,
  theme: ThemeLike,
  model: string | undefined,
): void {
  const usageString = formatUsageStats(usage, model)
  if (!usageString) return
  container.addChild(new Spacer(1))
  container.addChild(new Text(theme.fg('dim', usageString), 0, 0))
}

function addAggregateUsage(
  container: Container,
  results: SingleResult[],
  theme: ThemeLike,
): void {
  const usageString = formatUsageStats(buildAggregateUsage(results))
  if (!usageString) return
  const totalLine = `Total: ${usageString}`
  container.addChild(new Spacer(1))
  container.addChild(new Text(theme.fg('dim', totalLine), 0, 0))
}

function getAggregateUsageText(
  results: SingleResult[],
  theme: ThemeLike,
): string {
  const usageString = formatUsageStats(buildAggregateUsage(results))
  if (!usageString) return ''
  const totalLine = `Total: ${usageString}`
  return theme.fg('dim', totalLine)
}

function getChainSuccessCount(results: SingleResult[]): number {
  return results.filter((result) => result.exitCode === 0).length
}

function getChainHeader(details: SubagentDetails, theme: ThemeLike): string {
  const successCount = getChainSuccessCount(details.results)
  const isSuccess = successCount === details.results.length
  const icon = getSuccessIcon(!isSuccess, theme)
  const title = theme.fg('toolTitle', theme.bold('chain '))
  const status = `${successCount}/${details.results.length} steps`
  return `${icon} ${title}${theme.fg('accent', status)}`
}

function getChainStepIcon(result: SingleResult, theme: ThemeLike): string {
  const isError = result.exitCode !== 0
  return getSuccessIcon(isError, theme)
}

function getChainStepHeading(result: SingleResult, theme: ThemeLike): string {
  const step = String(result.step)
  const prefix = theme.fg('muted', `─── Step ${step}: `)
  const agent = theme.fg('accent', result.agent)
  return `${prefix}${agent} ${getChainStepIcon(result, theme)}`
}

function getParallelCounts(results: SingleResult[]): ParallelCounts {
  let running = 0
  let successCount = 0
  let failCount = 0
  for (const result of results) {
    if (result.exitCode === -1) {
      running += 1
    } else if (isFailedResult(result)) {
      failCount += 1
    } else {
      successCount += 1
    }
  }
  return { running, successCount, failCount }
}

function getParallelIcon(counts: ParallelCounts, theme: ThemeLike): string {
  if (counts.running > 0) return theme.fg('warning', '⏳')
  if (counts.failCount > 0) return theme.fg('warning', '◐')
  return theme.fg('success', '✓')
}

function getParallelStatus(counts: ParallelCounts, taskCount: number): string {
  if (counts.running > 0) {
    const completedCount = counts.successCount + counts.failCount
    return `${completedCount}/${taskCount} done, ${counts.running} running`
  }
  return `${counts.successCount}/${taskCount} tasks`
}

function getParallelSummary(
  details: SubagentDetails,
  theme: ThemeLike,
): ParallelSummary {
  const counts = getParallelCounts(details.results)
  return {
    icon: getParallelIcon(counts, theme),
    status: getParallelStatus(counts, details.results.length),
    isRunning: counts.running > 0,
  }
}

function getParallelHeader(details: SubagentDetails, theme: ThemeLike): string {
  const summary = getParallelSummary(details, theme)
  const title = theme.fg('toolTitle', theme.bold('parallel '))
  const status = theme.fg('accent', summary.status)
  return `${summary.icon} ${title}${status}`
}

function getParallelExpandedIcon(
  result: SingleResult,
  theme: ThemeLike,
): string {
  return getSuccessIcon(isFailedResult(result), theme)
}

function getParallelCollapsedIcon(
  result: SingleResult,
  theme: ThemeLike,
): string {
  if (result.exitCode === -1) return theme.fg('warning', '⏳')
  return getSuccessIcon(isFailedResult(result), theme)
}

function getParallelHeading(result: SingleResult, theme: ThemeLike): string {
  const prefix = theme.fg('muted', '─── ')
  const agent = theme.fg('accent', result.agent)
  return `${prefix}${agent} ${getParallelExpandedIcon(result, theme)}`
}

function addExpandedResultBlock(
  container: Container,
  result: SingleResult,
  heading: string,
  theme: ThemeLike,
  mdTheme: MarkdownTheme,
): void {
  const displayItems = getDisplayItems(result.messages)
  const finalOutput = getFinalOutput(result.messages)
  container.addChild(new Spacer(1))
  container.addChild(new Text(heading, 0, 0))
  container.addChild(
    new Text(theme.fg('muted', 'Task: ') + theme.fg('dim', result.task), 0, 0),
  )
  addToolCallItems(container, displayItems, theme)
  if (finalOutput) addMarkdownOutput(container, finalOutput, mdTheme)
  const taskUsage = formatUsageStats(result.usage, result.model)
  if (taskUsage) container.addChild(new Text(theme.fg('dim', taskUsage), 0, 0))
}

function getCollapsedDisplayText(
  displayItems: DisplayItem[],
  limit: number,
  theme: ThemeLike,
): string {
  if (displayItems.length === 0) return theme.fg('muted', '(no output)')
  return renderDisplayItemsToText(displayItems, limit, false, theme)
}

function getChainCollapsedBlock(
  result: SingleResult,
  theme: ThemeLike,
): string {
  const displayItems = getDisplayItems(result.messages)
  const heading = getChainStepHeading(result, theme)
  const output = getCollapsedDisplayText(displayItems, 5, theme)
  return `\n\n${heading}\n${output}`
}

function getParallelCollapsedOutput(
  result: SingleResult,
  displayItems: DisplayItem[],
  theme: ThemeLike,
): string {
  if (displayItems.length > 0) {
    return renderDisplayItemsToText(displayItems, 5, false, theme)
  }
  if (result.exitCode === -1) return theme.fg('muted', '(running...)')
  return theme.fg('muted', '(no output)')
}

function getParallelCollapsedBlock(
  result: SingleResult,
  theme: ThemeLike,
): string {
  const displayItems = getDisplayItems(result.messages)
  const prefix = theme.fg('muted', '─── ')
  const agent = theme.fg('accent', result.agent)
  const icon = getParallelCollapsedIcon(result, theme)
  const output = getParallelCollapsedOutput(result, displayItems, theme)
  return `\n\n${prefix}${agent} ${icon}\n${output}`
}

export function buildSingleResultExpanded(
  result: SingleResult,
  theme: ThemeLike,
): Container {
  const mdTheme = getMarkdownTheme()
  const isError = isFailedResult(result)
  const displayItems = getDisplayItems(result.messages)
  const finalOutput = getFinalOutput(result.messages)

  const container = new Container()
  container.addChild(new Text(getSingleResultHeader(result, theme), 0, 0))
  if (isError && result.errorMessage) {
    container.addChild(
      new Text(formatErrorMessage(result.errorMessage, theme), 0, 0),
    )
  }
  addTaskSection(container, result.task, theme)
  addExpandedOutput(container, displayItems, finalOutput, theme, mdTheme)
  addUsageLine(container, result.usage, theme, result.model)
  return container
}

export function buildSingleResultCollapsed(
  result: SingleResult,
  theme: ThemeLike,
): Text {
  const isError = isFailedResult(result)
  const displayItems = getDisplayItems(result.messages)

  let text = getSingleResultHeader(result, theme)
  if (isError && result.errorMessage) {
    text += `\n${formatErrorMessage(result.errorMessage, theme)}`
  } else if (displayItems.length === 0) {
    text += `\n${theme.fg('muted', '(no output)')}`
  } else {
    text += `\n${renderDisplayItemsToText(displayItems, 10, false, theme)}`
    if (displayItems.length > 10) {
      text += `\n${theme.fg('muted', '(Ctrl+O to expand)')}`
    }
  }
  const usageString = formatUsageStats(result.usage, result.model)
  if (usageString) text += `\n${theme.fg('dim', usageString)}`
  return new Text(text, 0, 0)
}

export function buildChainResultExpanded(
  details: SubagentDetails,
  theme: ThemeLike,
): Container {
  const mdTheme = getMarkdownTheme()
  const container = new Container()
  container.addChild(new Text(getChainHeader(details, theme), 0, 0))
  for (const result of details.results) {
    addExpandedResultBlock(
      container,
      result,
      getChainStepHeading(result, theme),
      theme,
      mdTheme,
    )
  }
  addAggregateUsage(container, details.results, theme)
  return container
}

export function buildChainResultCollapsed(
  details: SubagentDetails,
  theme: ThemeLike,
): Text {
  let text = getChainHeader(details, theme)
  for (const result of details.results) {
    text += getChainCollapsedBlock(result, theme)
  }
  const usageText = getAggregateUsageText(details.results, theme)
  if (usageText) text += `\n\n${usageText}`
  text += `\n${theme.fg('muted', '(Ctrl+O to expand)')}`
  return new Text(text, 0, 0)
}

export function buildParallelResultExpanded(
  details: SubagentDetails,
  theme: ThemeLike,
): Container {
  const mdTheme = getMarkdownTheme()
  const container = new Container()
  container.addChild(new Text(getParallelHeader(details, theme), 0, 0))
  for (const result of details.results) {
    addExpandedResultBlock(
      container,
      result,
      getParallelHeading(result, theme),
      theme,
      mdTheme,
    )
  }
  addAggregateUsage(container, details.results, theme)
  return container
}

export function buildParallelResultCollapsed(
  details: SubagentDetails,
  theme: ThemeLike,
): Text {
  const summary = getParallelSummary(details, theme)
  const title = theme.fg('toolTitle', theme.bold('parallel '))
  const status = theme.fg('accent', summary.status)
  let text = `${summary.icon} ${title}${status}`
  for (const result of details.results) {
    text += getParallelCollapsedBlock(result, theme)
  }
  if (!summary.isRunning) {
    const usageText = getAggregateUsageText(details.results, theme)
    if (usageText) text += `\n\n${usageText}`
  }
  text += `\n${theme.fg('muted', '(Ctrl+O to expand)')}`
  return new Text(text, 0, 0)
}
