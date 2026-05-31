import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { Text } from '@earendil-works/pi-tui'
import type { SubagentDetails } from '../../subagents/types.js'
import { getFinalOutput } from '../../subagents/utilities.js'
import type { ThemeLike } from '../subagent-render.js'

function renderCallPreview(context: string, limit: number): string {
  if (context.length > limit) {
    return `${context.slice(0, limit)}...`
  }
  return context
}

export function buildAdvisorRenderCall(
  args: {
    context: string
    code?: string
    error?: string
    attempted?: string
    files?: string[]
  },
  theme: ThemeLike,
): Text {
  const preview = renderCallPreview(args.context, 60)
  let text = theme.fg('toolTitle', theme.bold('advisor '))
  text += theme.fg('accent', 'consulting')
  text += '\n  '
  text += theme.fg('dim', preview)

  if (args.files !== undefined && args.files.length > 0) {
    text += '\n  '
    text += theme.fg(
      'muted',
      `+${String(args.files.length)} file${args.files.length > 1 ? 's' : ''}`,
    )
  }

  return new Text(text, 0, 0)
}

function renderResultFallback(result: AgentToolResult<unknown>): Text {
  const item = result.content[0]
  if (item === undefined) {
    return new Text('(no output)', 0, 0)
  }
  return new Text(item.type === 'text' ? item.text : '(no output)', 0, 0)
}

function isSubagentDetails(value: unknown): value is SubagentDetails {
  return (
    typeof value === 'object' &&
    value !== null &&
    'mode' in value &&
    'results' in value
  )
}

export function buildAdvisorRenderResult(
  result: AgentToolResult<unknown>,
  expanded: boolean,
  theme: ThemeLike,
): Text {
  const details = result.details
  if (!isSubagentDetails(details) || details.results.length === 0) {
    return renderResultFallback(result)
  }

  const firstResult = details.results[0]
  if (firstResult === undefined) {
    return renderResultFallback(result)
  }

  const output = getFinalOutput(firstResult.messages)
  if (output.length === 0) {
    return new Text('(no output)', 0, 0)
  }

  if (expanded) {
    const header = theme.fg('accent', theme.bold('Advisor'))
    const separator = theme.fg('dim', '─'.repeat(40))
    return new Text(`${header}\n${separator}\n${output}`, 0, 0)
  }

  const lines = output.split('\n')
  const preview = lines.slice(0, 3).join('\n')
  const remainingText =
    lines.length > 3 ? `... +${String(lines.length - 3)} lines` : ''
  const truncated = remainingText ? `\n${theme.fg('dim', remainingText)}` : ''
  return new Text(`${preview}${truncated}`, 0, 0)
}
