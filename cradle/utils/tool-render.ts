import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import type { Theme } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import { Text } from '@earendil-works/pi-tui'

import { getToolOutputMode } from '../config/settings.js'

interface CollapsedContext {
  isError: boolean
  isPartial: boolean
}

/**
 * Renders a collapsed (non-expanded) tool result based on the configured mode.
 * Returns `undefined` when the result should be rendered normally (preview mode
 * or expanded), signaling the caller to use its own renderer.
 */
export function renderWithMode(
  toolName: string,
  keyArgs: string,
  options: { expanded: boolean; isPartial: boolean },
  theme: Theme,
  context: CollapsedContext,
): Component | undefined {
  const mode = getToolOutputMode()

  if (options.expanded || mode === 'preview') return undefined

  if (mode === 'header-only') {
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

  // mode === 'hidden'
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

export function renderCollapsedToolSummary(
  toolName: string,
  keyArgs: string,
  options: { expanded: boolean; isPartial: boolean },
  theme: Theme,
  context: CollapsedContext,
): Component | undefined {
  return renderWithMode(toolName, keyArgs, options, theme, context)
}
