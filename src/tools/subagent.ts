import { defineTool } from '@earendil-works/pi-coding-agent'
import { discoverAgents } from '../subagents/agents.js'
import type { AgentConfig } from '../subagents/types.js'
import {
  buildNoModeResponse,
  buildValidationErrorResponse,
  handleChainMode,
  handleParallelMode,
  handleSingleMode,
  makeDetailsFactory,
  SubagentParameters,
  validateModeCount,
  type MakeDetails,
  type SubagentParametersType,
  type ToolContext,
  type ToolResult,
  type UpdateCallback,
} from './subagent-modes.js'
import { buildRenderCall, buildRenderResult } from './subagent-render.js'

async function dispatchByMode(
  parameters: SubagentParametersType,
  context: ToolContext,
  agents: AgentConfig[],
  signal: AbortSignal | undefined,
  onUpdate: UpdateCallback | undefined,
  makeDetails: MakeDetails,
): Promise<ToolResult> {
  if (parameters.chain && parameters.chain.length > 0) {
    return handleChainMode(
      parameters,
      context,
      agents,
      signal,
      onUpdate,
      makeDetails,
    )
  }
  if (parameters.tasks && parameters.tasks.length > 0) {
    return handleParallelMode(
      parameters,
      context,
      agents,
      signal,
      onUpdate,
      makeDetails,
    )
  }
  if (parameters.agent && parameters.task) {
    return handleSingleMode(
      parameters,
      context,
      agents,
      signal,
      onUpdate,
      makeDetails,
    )
  }
  return buildNoModeResponse(agents, makeDetails)
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

    const validationError = validateModeCount(parameters)
    if (validationError) {
      return buildValidationErrorResponse(validationError, agents, makeDetails)
    }

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
