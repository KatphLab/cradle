import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { Text } from '@earendil-works/pi-tui'
import {
  buildChainResultCollapsed,
  buildChainResultExpanded,
  buildParallelResultCollapsed,
  buildParallelResultExpanded,
  buildSingleResultCollapsed,
  buildSingleResultExpanded,
} from '../../subagents/render.js'
import type { SubagentDetails } from '../../subagents/types.js'
import type { ThemeLike } from '../../utils/helpers.js'
import type {
  ChainModeParameters,
  ParallelModeParameters,
  SingleModeParameters,
  SubagentParametersType,
} from './subagent-modes.js'

function renderAgentPreview(task: string, limit: number): string {
  if (task.length > limit) {
    return `${task.slice(0, limit)}...`
  }
  return task
}

function renderCallChainText(
  args: ChainModeParameters,
  theme: ThemeLike,
): string {
  const chain = args.chain
  if (chain.length === 0) return ''

  let text =
    theme.fg('toolTitle', theme.bold('subagent ')) +
    theme.fg('accent', `chain (${chain.length} steps)`)

  for (const [index, step] of chain.entries()) {
    if (index >= 3) break
    const cleanTask = step.task.replaceAll('{previous}', '').trim()
    const preview = renderAgentPreview(cleanTask, 40)
    text += '\n  '
    text += theme.fg('muted', `${index + 1}.`)
    text += theme.fg('accent', step.agent)
    text += theme.fg('dim', ` ${preview}`)
  }

  if (chain.length > 3) {
    text += '\n  '
    text += theme.fg('muted', `... +${chain.length - 3} more`)
  }
  return text
}

function renderCallParallelText(
  args: ParallelModeParameters,
  theme: ThemeLike,
): string {
  const tasks = args.tasks
  if (tasks.length === 0) return ''

  let text =
    theme.fg('toolTitle', theme.bold('subagent ')) +
    theme.fg('accent', `parallel (${tasks.length} tasks)`)

  for (const [index, t] of tasks.entries()) {
    if (index >= 3) break
    const preview = renderAgentPreview(t.task, 40)
    text += '\n  '
    text += theme.fg('accent', t.agent)
    text += theme.fg('dim', ` ${preview}`)
  }

  if (tasks.length > 3) {
    text += '\n  '
    text += theme.fg('muted', `... +${tasks.length - 3} more`)
  }
  return text
}

function renderCallSingleText(
  args: SingleModeParameters,
  theme: ThemeLike,
): string {
  const agentName = args.agent
  const preview = renderAgentPreview(args.task, 60)
  let text = theme.fg('toolTitle', theme.bold('subagent '))
  text += theme.fg('accent', agentName)
  text += '\n  '
  text += theme.fg('dim', preview)
  return text
}

export function buildRenderCall(
  args: SubagentParametersType,
  theme: ThemeLike,
) {
  if ('chain' in args && args.chain.length > 0) {
    return new Text(renderCallChainText(args, theme), 0, 0)
  }

  if ('tasks' in args && args.tasks.length > 0) {
    return new Text(renderCallParallelText(args, theme), 0, 0)
  }

  if ('agent' in args) {
    return new Text(renderCallSingleText(args, theme), 0, 0)
  }

  return new Text('subagent ...', 0, 0)
}

export function renderResultFallback(result: AgentToolResult<unknown>) {
  const item = result.content[0]
  if (item === undefined) {
    return new Text('(no output)', 0, 0)
  }
  return new Text(item.type === 'text' ? item.text : '(no output)', 0, 0)
}

export function isSubagentDetails(value: unknown): value is SubagentDetails {
  return (
    typeof value === 'object' &&
    value !== null &&
    'mode' in value &&
    'results' in value
  )
}

function buildSingleRenderResult(
  result: AgentToolResult<unknown>,
  details: SubagentDetails,
  expanded: boolean,
  theme: ThemeLike,
) {
  const firstResult = details.results[0]
  if (firstResult === undefined) {
    return renderResultFallback(result)
  }
  if (expanded) {
    return buildSingleResultExpanded(firstResult, theme)
  }
  return buildSingleResultCollapsed(firstResult, theme)
}

export function buildRenderResult(
  result: AgentToolResult<unknown>,
  expanded: boolean,
  theme: ThemeLike,
) {
  const details = result.details
  if (!isSubagentDetails(details) || details.results.length === 0) {
    return renderResultFallback(result)
  }

  if (details.mode === 'single' && details.results.length === 1) {
    return buildSingleRenderResult(result, details, expanded, theme)
  }

  if (details.mode === 'chain') {
    if (expanded) {
      return buildChainResultExpanded(details, theme)
    }
    return buildChainResultCollapsed(details, theme)
  }

  if (details.mode === 'parallel') {
    if (expanded) {
      return buildParallelResultExpanded(details, theme)
    }
    return buildParallelResultCollapsed(details, theme)
  }

  return renderResultFallback(result)
}
