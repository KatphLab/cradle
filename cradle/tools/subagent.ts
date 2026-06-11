import { defineTool } from '@earendil-works/pi-coding-agent'
import { discoverAgents } from '../lib/subagents/agents.js'
import type { AgentConfig } from '../lib/subagents/types.js'
import {
  handleChainMode,
  handleParallelMode,
  handleSingleMode,
  makeDetailsFactory,
  resolveSubagentMode,
  SubagentParameters,
  toChainMode,
  toParallelMode,
  toSingleMode,
  type MakeDetails,
  type SubagentToolParameters,
  type ToolContext,
  type ToolResult,
  type UpdateCallback,
} from './subagent/subagent-modes.js'
import {
  buildRenderCall,
  buildRenderResult,
} from './subagent/subagent-render.js'

async function dispatchByMode(
  parameters: SubagentToolParameters,
  context: ToolContext,
  agents: AgentConfig[],
  signal: AbortSignal | undefined,
  onUpdate: UpdateCallback | undefined,
  makeDetails: MakeDetails,
): Promise<ToolResult> {
  const mode = resolveSubagentMode(parameters)

  if (mode === 'chain') {
    return handleChainMode(
      toChainMode(parameters),
      context,
      agents,
      signal,
      onUpdate,
      makeDetails,
    )
  }
  if (mode === 'parallel') {
    return handleParallelMode(
      toParallelMode(parameters),
      context,
      agents,
      signal,
      onUpdate,
      makeDetails,
    )
  }
  return handleSingleMode(
    toSingleMode(parameters),
    context,
    agents,
    signal,
    onUpdate,
    makeDetails,
  )
}

/** @public */
export const subagentTool = defineTool({
  name: 'subagent',
  label: 'Subagent',
  description: [
    'Delegate tasks to specialized subagents with isolated context.',
    'Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).',
  ].join(' '),
  parameters: SubagentParameters,

  async execute(
    _toolCallId,
    parameters: SubagentToolParameters,
    signal,
    onUpdate,
    context,
  ) {
    const discovery = discoverAgents(context.cwd)
    const agents = discovery.agents

    const makeDetails = makeDetailsFactory(discovery.projectAgentsDir)

    return dispatchByMode(
      parameters,
      context,
      agents,
      signal,
      onUpdate,
      makeDetails,
    )
  },

  renderCall(args, theme) {
    return buildRenderCall(args, theme)
  },

  renderResult(result, { expanded }, theme) {
    return buildRenderResult(result, expanded, theme)
  },
})
