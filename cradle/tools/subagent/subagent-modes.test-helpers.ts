import type { Message } from '@earendil-works/pi-ai'

import type {
  AgentConfig,
  AgentDiscoveryResult,
  SingleResult,
  UsageStats,
} from '../../subagents/types.js'
import { makeDetailsFactory, type ToolContext } from './subagent-modes.js'

const emptyUsage: UsageStats = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
  contextTokens: 0,
  turns: 0,
}

const emptyMessageUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
}

export function noProjectAgentsDirectory(): string | undefined {
  return [][0]
}

export function assistantText(text: string): Message {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'test',
    provider: 'test',
    model: 'test',
    usage: { ...emptyMessageUsage, cost: { ...emptyMessageUsage.cost } },
    stopReason: 'stop',
    timestamp: 0,
  }
}

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  const name = overrides.name ?? 'writer'
  return {
    name,
    description: `${name} description`,
    filePath: `/${overrides.source ?? 'user'}/${name}.md`,
    source: 'user',
    systemPrompt: `${name} prompt`,
    ...overrides,
  }
}

export function makeResult(
  overrides: Partial<SingleResult> = {},
): SingleResult {
  return {
    agent: 'writer',
    agentSource: 'user',
    task: 'write',
    exitCode: 0,
    messages: [assistantText('done')],
    stderr: '',
    usage: { ...emptyUsage },
    ...overrides,
  }
}

export function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd: '/repo',
    hasUI: true,
    ui: { confirm: () => Promise.resolve(true) },
    ...overrides,
  }
}

export function makeUpdate(result: SingleResult) {
  return {
    content: [{ type: 'text' as const, text: 'partial' }],
    details: makeDetailsFactory(noProjectAgentsDirectory())('single')([result]),
  }
}

const userAgent = makeAgent({ name: 'writer', source: 'user' })
const reviewerAgent = makeAgent({ name: 'reviewer', source: 'user' })
const projectAgent = makeAgent({ name: 'repo-agent', source: 'project' })
export const agents = [userAgent, reviewerAgent, projectAgent]
export const discovery: AgentDiscoveryResult = {
  agents,
  projectAgentsDir: '/repo/.pi/agents',
}
