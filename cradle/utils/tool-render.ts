import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import type { Theme } from '@earendil-works/pi-coding-agent'
import { Container, Text, type Component } from '@earendil-works/pi-tui'

import { getToolOutputMode } from '../config/settings.js'

const PREVIEW_LINE_COUNT = 5

interface CollapsedContext {
  isError: boolean
  isPartial: boolean
}

interface RenderCallContext extends CollapsedContext {
  expanded: boolean
}

function renderToolHeader(
  toolName: string,
  keyArgs: string,
  theme: Theme,
  context: CollapsedContext,
): Component {
  const header = theme.fg('toolTitle', theme.bold(toolName))
  const args = keyArgs.length > 0 ? ` ${theme.fg('accent', keyArgs)}` : ''
  let status = ''
  if (context.isError) {
    status = ` ${theme.fg('error', '\u2717')}`
  } else if (context.isPartial) {
    status = ` ${theme.fg('warning', '\u2026')}`
  }
  return new Text(`${header}${args}${status}`, 0, 0)
}

function renderHiddenToolHeader(
  toolName: string,
  theme: Theme,
  context: CollapsedContext,
): Component {
  let statusIcon: string
  if (context.isError) {
    statusIcon = theme.fg('error', '\u2717')
  } else if (context.isPartial) {
    statusIcon = theme.fg('warning', '\u2026')
  } else {
    statusIcon = theme.fg('success', '\u2713')
  }
  return new Text(`${statusIcon} ${theme.fg('toolTitle', toolName)}`, 0, 0)
}

function shouldHideCollapsedResult(options: { expanded: boolean }): boolean {
  const mode = getToolOutputMode()
  return !options.expanded && (mode === 'header-only' || mode === 'hidden')
}

export function shouldRenderFullToolResult(options: {
  expanded: boolean
}): boolean {
  return options.expanded || getToolOutputMode() === 'full'
}

function renderEmptyToolResult(): Component {
  return new Container()
}

export function renderToolCallWithMode(
  toolName: string,
  keyArgs: string,
  theme: Theme,
  context: RenderCallContext,
): Component {
  const mode = getToolOutputMode()

  if (context.expanded || mode !== 'hidden') {
    return renderToolHeader(toolName, keyArgs, theme, context)
  }

  return renderHiddenToolHeader(toolName, theme, context)
}

function getTextOutput(result: AgentToolResult<unknown>): string {
  return result.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
}

export function renderPlainTextFallback(
  result: AgentToolResult<unknown>,
  theme: Theme,
): Component {
  return new Text(theme.fg('toolOutput', getTextOutput(result)), 0, 0)
}

export function renderPreviewTextFallback(
  result: AgentToolResult<unknown>,
  theme: Theme,
): Component {
  const lines = getTextOutput(result).split('\n')
  const preview = lines.slice(0, PREVIEW_LINE_COUNT).join('\n')
  if (lines.length <= PREVIEW_LINE_COUNT) {
    return new Text(theme.fg('toolOutput', preview), 0, 0)
  }

  const remaining = lines.length - PREVIEW_LINE_COUNT
  const message = theme.fg('dim', `... +${String(remaining)} lines`)
  return new Text(`${theme.fg('toolOutput', preview)}\n${message}`, 0, 0)
}

export function renderToolResultWithMode(
  result: AgentToolResult<unknown>,
  options: { expanded: boolean },
  theme: Theme,
): Component {
  if (shouldRenderFullToolResult(options)) {
    return renderPlainTextFallback(result, theme)
  }

  return shouldHideCollapsedResult(options)
    ? renderEmptyToolResult()
    : renderPreviewTextFallback(result, theme)
}

export function renderCollapsedToolSummary(
  _toolName: string,
  _keyArgs: string,
  options: { expanded: boolean },
  _theme: Theme,
  _context: CollapsedContext,
): Component | undefined {
  return shouldHideCollapsedResult(options)
    ? renderEmptyToolResult()
    : undefined
}
