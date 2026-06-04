import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'

import { discoverAgents } from '../subagents/agents.js'
import type { AgentConfig, AgentSource } from '../subagents/types.js'

interface DiscoverAgentsDetails {
  agents: AgentConfig[]
  projectAgentsDir: string | undefined
}

const DiscoverAgentsParameters = Type.Object(
  {},
  { additionalProperties: false },
)

function formatSourceLabel(source: AgentSource): string {
  switch (source) {
    case 'extension': {
      return 'extension (bundled with pi)'
    }
    case 'project': {
      return 'project'
    }
    case 'user': {
      return 'user'
    }
  }
}

function formatAgentEntry(agent: AgentConfig): string {
  const parts = [
    `- ${agent.name} (${formatSourceLabel(agent.source)}): ${agent.description}`,
  ]
  if (agent.tools !== undefined && agent.tools.length > 0) {
    parts.push(`  tools: ${agent.tools.join(', ')}`)
  }
  return parts.join('\n')
}

function formatAgentCatalog(agents: AgentConfig[]): string {
  if (agents.length === 0) {
    return 'No subagents available. Create .md files in .pi/agents/ (project) or ~/.config/pi/agents/ (user) to define subagents.'
  }

  const lines = [
    `Available subagents (${String(agents.length)}):`,
    '',
    ...agents.map((agent) => formatAgentEntry(agent)),
    '',
    'Use the "subagent" tool to delegate tasks to these agents.',
  ]
  return lines.join('\n')
}

/** @public */
export const discoverAgentsTool = defineTool({
  name: 'discover-agents',
  label: 'Discover Agents',
  description:
    'List available subagents that can be used with the subagent tool. ' +
    'Use this before invoking subagent to know which agents are available ' +
    'and what they do.',
  parameters: DiscoverAgentsParameters,

  execute(_toolCallId, _parameters, _signal, _onUpdate, context) {
    const discovery = discoverAgents(context.cwd)

    return Promise.resolve({
      content: [
        {
          type: 'text' as const,
          text: formatAgentCatalog(discovery.agents),
        },
      ],
      details: {
        agents: discovery.agents,
        projectAgentsDir: discovery.projectAgentsDir,
      } satisfies DiscoverAgentsDetails,
    })
  },
})
