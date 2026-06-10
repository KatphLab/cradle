import { describe, expect, it, vi } from 'vitest'

import { discoverAgentsTool } from '../discover-agents.js'

vi.mock('../../lib/subagents/agents.js', () => ({
  discoverAgents: vi.fn(),
}))

function isTextContent(item: unknown): item is { type: 'text'; text: string } {
  if (typeof item !== 'object' || item === null) return false
  const record = item as Record<string, unknown>
  return record['type'] === 'text' && typeof record['text'] === 'string'
}

function getTextContent(result: { content: unknown[] }): string {
  const item = result.content[0]
  if (!isTextContent(item)) throw new Error('Expected text content')
  return item.text
}

const agentsModule = await import('../../lib/subagents/agents.js')
const mockDiscoverAgents = vi.mocked(agentsModule.discoverAgents)

function executeDiscoverAgents(cwd = '/test') {
  return discoverAgentsTool.execute(
    'test-call',
    {},
    undefined,
    undefined,
    // @ts-expect-error minimal context mock
    { cwd },
  )
}

describe('discoverAgentsTool', () => {
  it('lists available agents with name, source, and description', async () => {
    mockDiscoverAgents.mockReturnValue({
      agents: [
        {
          name: 'reviewer',
          description: 'Code review agent',
          source: 'extension',
          filePath: '/ext/reviewer.md',
          systemPrompt: 'You review code.',
        },
        {
          name: 'writer',
          description: 'Writing agent',
          source: 'extension',
          filePath: '/ext/writer.md',
          systemPrompt: 'You write docs.',
        },
      ],
      projectAgentsDir: undefined,
    })

    const result = await executeDiscoverAgents()

    const text = getTextContent(result)
    expect(text).toContain('Available subagents (2)')
    expect(text).toContain(
      'reviewer (extension (bundled with pi)): Code review agent',
    )
    expect(text).toContain(
      'writer (extension (bundled with pi)): Writing agent',
    )
    expect(text).toContain('Use the "subagent" tool')
  })

  it('includes tools when agent has them', async () => {
    mockDiscoverAgents.mockReturnValue({
      agents: [
        {
          name: 'tester',
          description: 'Test agent',
          tools: ['read', 'bash'],
          source: 'project',
          filePath: '/proj/tester.md',
          systemPrompt: 'You run tests.',
        },
      ],
      projectAgentsDir: '/proj/.pi/agents',
    })

    const result = await executeDiscoverAgents()

    const text = getTextContent(result)
    expect(text).toContain('tester (project): Test agent')
    expect(text).toContain('tools: read, bash')
  })

  it('shows all three agent sources', async () => {
    mockDiscoverAgents.mockReturnValue({
      agents: [
        {
          name: 'ext-agent',
          description: 'From extension',
          source: 'extension',
          filePath: '/ext/ext-agent.md',
          systemPrompt: 'Extension agent.',
        },
        {
          name: 'user-agent',
          description: 'From user config',
          source: 'user',
          filePath: '/user/user-agent.md',
          systemPrompt: 'User agent.',
        },
        {
          name: 'proj-agent',
          description: 'From project',
          source: 'project',
          filePath: '/proj/proj-agent.md',
          systemPrompt: 'Project agent.',
        },
      ],
      projectAgentsDir: '/proj/.pi/agents',
    })

    const result = await executeDiscoverAgents()

    const text = getTextContent(result)
    expect(text).toContain(
      'ext-agent (extension (bundled with pi)): From extension',
    )
    expect(text).toContain('user-agent (user): From user config')
    expect(text).toContain('proj-agent (project): From project')
  })

  it('returns helpful message when no agents exist', async () => {
    mockDiscoverAgents.mockReturnValue({
      agents: [],
      projectAgentsDir: undefined,
    })

    const result = await executeDiscoverAgents()

    const text = getTextContent(result)
    expect(text).toContain('No subagents available')
    expect(text).toContain('.pi/agents/')
  })

  it('returns details with agents array and projectAgentsDir', async () => {
    const agents = [
      {
        name: 'my-agent',
        description: 'Custom agent',
        source: 'project' as const,
        filePath: '/proj/.pi/agents/my-agent.md',
        systemPrompt: 'Custom.',
      },
    ]
    mockDiscoverAgents.mockReturnValue({
      agents,
      projectAgentsDir: '/proj/.pi/agents',
    })

    const result = await executeDiscoverAgents('/proj')

    expect(result.details).toEqual({
      agents,
      projectAgentsDir: '/proj/.pi/agents',
    })
  })
})
