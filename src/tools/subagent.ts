import { defineTool } from '@earendil-works/pi-coding-agent'
import { discoverAgents } from '../subagents/agents.js'
import type { AgentConfig, AgentScope } from '../subagents/types.js'
import {
  buildCanceledResponse,
  buildNoModeResponse,
  buildValidationErrorResponse,
  handleChainMode,
  handleParallelMode,
  handleSingleMode,
  makeDetailsFactory,
  requestProjectAgentApproval,
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
    'Default agent scope is "user" (from ~/.pi/agent/agents).',
    'To enable project-local agents in .pi/agents, set agentScope: "both" (or "project").',
  ].join(' '),
  parameters: SubagentParameters,

  async execute(_toolCallId, parameters, signal, onUpdate, context) {
    const agentScope: AgentScope = parameters.agentScope ?? 'user'
    const discovery = discoverAgents(context.cwd, agentScope)
    const agents = discovery.agents
    const shouldConfirmProjectAgents = parameters.confirmProjectAgents ?? true

    const makeDetails = makeDetailsFactory(
      agentScope,
      discovery.projectAgentsDir,
    )

    const validationError = validateModeCount(parameters)
    if (validationError) {
      return buildValidationErrorResponse(validationError, agents, makeDetails)
    }

    if (
      (agentScope === 'project' || agentScope === 'both') &&
      shouldConfirmProjectAgents &&
      context.hasUI
    ) {
      const approved = await requestProjectAgentApproval(
        parameters,
        agents,
        context,
        discovery,
      )
      if (!approved) {
        return buildCanceledResponse(makeDetails)
      }
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
