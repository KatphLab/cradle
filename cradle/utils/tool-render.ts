import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import type { Theme } from '@earendil-works/pi-coding-agent'
import { Container, Text, type Component } from '@earendil-works/pi-tui'

import { getToolOutputMode } from '../config/settings.js'

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

function shouldRenderCollapsedResult(options: { expanded: boolean }): boolean {
  return !options.expanded && getToolOutputMode() !== 'preview'
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

  if (context.expanded || mode === 'preview' || mode === 'header-only') {
    return renderToolHeader(toolName, keyArgs, theme, context)
  }

  return renderHiddenToolHeader(toolName, theme, context)
}

export function renderPlainTextFallback(
  result: AgentToolResult<unknown>,
  theme: Theme,
): Component {
  const text = result.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
  return new Text(theme.fg('toolOutput', text), 0, 0)
}

export function renderToolResultWithMode(
  result: AgentToolResult<unknown>,
  options: { expanded: boolean },
  theme: Theme,
): Component {
  return shouldRenderCollapsedResult(options)
    ? renderEmptyToolResult()
    : renderPlainTextFallback(result, theme)
}

export function renderCollapsedToolSummary(
  _toolName: string,
  _keyArgs: string,
  options: { expanded: boolean },
  _theme: Theme,
  _context: CollapsedContext,
): Component | undefined {
  return shouldRenderCollapsedResult(options)
    ? renderEmptyToolResult()
    : undefined
}
