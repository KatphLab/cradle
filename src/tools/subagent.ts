import { defineTool } from '@earendil-works/pi-coding-agent'
import { discoverAgents } from '../subagents/agents.js'
import type { AgentConfig } from '../subagents/types.js'
import {
  handleChainMode,
  handleParallelMode,
  handleSingleMode,
  makeDetailsFactory,
  SubagentParameters,
  type MakeDetails,
  type SubagentParametersType,
  type ToolContext,
  type ToolResult,
  type UpdateCallback,
} from './subagent/subagent-modes.js'
import {
  buildRenderCall,
  buildRenderResult,
} from './subagent/subagent-render.js'

async function dispatchByMode(
  parameters: SubagentParametersType,
  context: ToolContext,
  agents: AgentConfig[],
  signal: AbortSignal | undefined,
  onUpdate: UpdateCallback | undefined,
  makeDetails: MakeDetails,
): Promise<ToolResult> {
  if ('chain' in parameters) {
    return handleChainMode(
      parameters,
      context,
      agents,
      signal,
      onUpdate,
      makeDetails,
    )
  }
  if ('tasks' in parameters) {
    return handleParallelMode(
      parameters,
      context,
      agents,
      signal,
      onUpdate,
      makeDetails,
    )
  }
  return handleSingleMode(
    parameters,
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

  async execute(_toolCallId, parameters, signal, onUpdate, context) {
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

  renderCall(args, theme, _context) {
    return buildRenderCall(args, theme)
  },

  renderResult(result, { expanded }, theme, _context) {
    return buildRenderResult(result, expanded, theme)
  },
})
