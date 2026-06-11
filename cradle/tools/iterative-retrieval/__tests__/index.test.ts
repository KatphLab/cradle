import type { Message } from '@earendil-works/pi-ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RunSingleAgentOptions } from '../../../lib/subagents/runner.js'
import type { SingleResult } from '../../../lib/subagents/types.js'
import type * as SubagentUtilities from '../../../lib/subagents/utilities.js'
import type { IterativeRetrievalDetails } from '../types.js'

const mocks = vi.hoisted(() => ({
  loadGlobalSettings: vi.fn(),
  runSingleAgent: vi.fn(),
}))

vi.mock('../../../config/settings.js', () => ({
  loadGlobalSettings: mocks.loadGlobalSettings,
}))

vi.mock('../../../lib/subagents/runner.js', () => ({
  runSingleAgent: mocks.runSingleAgent,
}))

vi.mock('../../../lib/subagents/agents.js', () => ({
  discoverAgents: vi.fn(() => ({
    agents: [
      {
        name: 'iterative-retriever',
        description:
          'Performs bounded iterative retrieval across local files and the web.',
        tools: [
          'web_search_internal',
          'web_fetch_internal',
          'read',
          'grep',
          'glob',
          'ls',
        ],
        systemPrompt: '',
        source: 'extension',
        filePath: '',
      },
    ],
    projectAgentsDir: undefined,
  })),
}))

vi.mock('../../../lib/subagents/utilities.js', async (importOriginal) => {
  const actual = await importOriginal<typeof SubagentUtilities>()
  return {
    ...actual,
    getFinalOutput: vi.fn(
      (messages: { role?: string; content?: { text?: string }[] }[]) => {
        const assistant = messages.find((m) => m.role === 'assistant')
        if (!assistant) return ''
        const content = assistant.content?.[0]
        if (content && 'text' in content) return content.text ?? ''
        return ''
      },
    ),
  }
})

const { iterativeRetrievalTool } = await import('../index.js')

beforeEach(() => {
  vi.resetAllMocks()
  mocks.loadGlobalSettings.mockResolvedValue({})
})

function firstText(result: { content: { type: string; text?: string }[] }) {
  return result.content[0]?.text ?? ''
}

function makeResult(output: string, exitCode = 0): SingleResult {
  return {
    agent: 'iterative-retriever',
    agentSource: 'extension',
    task: 'test task',
    exitCode,
    messages: [
      { role: 'assistant', content: [{ type: 'text', text: output }] },
    ] as unknown as Message[],
    stderr: '',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: 0,
      turns: 0,
    },
  }
}

async function executeRetrieval(parameters: {
  task: string
  paths?: string[]
  keywords?: string[]
  excludes?: string[]
  maxCycles?: number
  minRelevance?: number
  limit?: number
}) {
  return iterativeRetrievalTool.execute(
    'test-call',
    parameters,
    undefined,
    undefined,
    // @ts-expect-error minimal context mock
    { cwd: '/test' },
  )
}

function getRunSingleAgentOptions(): RunSingleAgentOptions {
  const calls = mocks.runSingleAgent.mock.calls as unknown as [
    RunSingleAgentOptions,
  ][]
  const call = calls[0]
  if (call === undefined) throw new Error('Expected runSingleAgent call')
  return call[0]
}

describe('iterativeRetrievalTool', () => {
  it('spawns iterative-retriever and returns result', async () => {
    mocks.runSingleAgent.mockResolvedValue(
      makeResult(
        '## Relevant Paths\n- src/auth.ts (relevance: 0.9)\n## Key Findings\n- Auth uses JWT tokens.',
      ),
    )

    const result = await executeRetrieval({
      task: 'Find authentication implementation details',
    })

    expect(firstText(result)).toContain('Relevant Paths')
    expect(firstText(result)).toContain('JWT tokens')
    expect(mocks.runSingleAgent).toHaveBeenCalledOnce()
    const options = getRunSingleAgentOptions()
    expect(options.agentName).toBe('iterative-retriever')
    expect(options.complexity).toBe('low')
  })

  it('passes task to subagent task string', async () => {
    mocks.runSingleAgent.mockResolvedValue(makeResult('OK'))

    await executeRetrieval({ task: 'Find error handling patterns' })

    const options = getRunSingleAgentOptions()
    expect(options.task).toContain('Find error handling patterns')
  })

  it('passes paths constraint to subagent', async () => {
    mocks.runSingleAgent.mockResolvedValue(makeResult('OK'))

    await executeRetrieval({
      task: 'test',
      paths: ['src/auth', 'src/middleware'],
    })

    const options = getRunSingleAgentOptions()
    expect(options.task).toContain('Paths:')
    expect(options.task).toContain('src/auth')
  })

  it('passes keywords to subagent', async () => {
    mocks.runSingleAgent.mockResolvedValue(makeResult('OK'))

    await executeRetrieval({ task: 'test', keywords: ['jwt', 'oauth'] })

    const options = getRunSingleAgentOptions()
    expect(options.task).toContain('Keywords:')
    expect(options.task).toContain('jwt')
  })

  it('passes excludes to subagent', async () => {
    mocks.runSingleAgent.mockResolvedValue(makeResult('OK'))

    await executeRetrieval({ task: 'test', excludes: ['node_modules', 'dist'] })

    const options = getRunSingleAgentOptions()
    expect(options.task).toContain('Excludes:')
    expect(options.task).toContain('node_modules')
  })

  it('passes maxCycles, minRelevance, and limit to subagent', async () => {
    mocks.runSingleAgent.mockResolvedValue(makeResult('OK'))

    await executeRetrieval({
      task: 'test',
      maxCycles: 5,
      minRelevance: 0.7,
      limit: 10,
    })

    const options = getRunSingleAgentOptions()
    expect(options.task).toContain('maxCycles: 5')
    expect(options.task).toContain('minRelevance: 0.7')
    expect(options.task).toContain('limit: 10')
  })

  it('uses default values when optional params omitted', async () => {
    mocks.runSingleAgent.mockResolvedValue(makeResult('OK'))

    await executeRetrieval({ task: 'test' })

    const options = getRunSingleAgentOptions()
    expect(options.task).toContain('maxCycles: 3')
    expect(options.task).toContain('minRelevance: 0.5')
    expect(options.task).toContain('limit: 20')
  })

  it('validates empty task', async () => {
    const result = await executeRetrieval({ task: '' })

    expect(firstText(result)).toBe('Task must be non-empty.')
    expect(mocks.runSingleAgent).not.toHaveBeenCalled()
  })

  it('validates whitespace-only task', async () => {
    const result = await executeRetrieval({ task: '   ' })

    expect(firstText(result)).toBe('Task must be non-empty.')
    expect(mocks.runSingleAgent).not.toHaveBeenCalled()
  })

  it('validates maxCycles >= 1', async () => {
    const result = await executeRetrieval({ task: 'test', maxCycles: 0 })

    expect(firstText(result)).toBe('maxCycles must be at least 1, got 0.')
    expect(mocks.runSingleAgent).not.toHaveBeenCalled()
  })

  it('validates minRelevance in range', async () => {
    const resultLow = await executeRetrieval({
      task: 'test',
      minRelevance: -0.1,
    })
    expect(firstText(resultLow)).toBe(
      'minRelevance must be between 0 and 1, got -0.1.',
    )

    const resultHigh = await executeRetrieval({
      task: 'test',
      minRelevance: 1.5,
    })
    expect(firstText(resultHigh)).toBe(
      'minRelevance must be between 0 and 1, got 1.5.',
    )
    expect(mocks.runSingleAgent).not.toHaveBeenCalled()
  })

  it('validates limit >= 1', async () => {
    const result = await executeRetrieval({ task: 'test', limit: 0 })

    expect(firstText(result)).toBe('limit must be at least 1, got 0.')
    expect(mocks.runSingleAgent).not.toHaveBeenCalled()
  })

  it('parses structured output into details', async () => {
    mocks.runSingleAgent.mockResolvedValue(
      makeResult(
        [
          '## Cycles',
          '- 2',
          '',
          '## Relevant Paths',
          '- src/auth.ts (relevance: 0.9) — reason: jwt verification',
          '- src/login.ts (relevance: 0.7) — reason: login handler',
          '',
          '## Web Sources',
          '- https://jwt.io (relevance: 0.8) — reason: jwt reference',
          '',
          '## Key Findings',
          '- Uses HS256 signing',
          '- Tokens expire after 1 hour',
          '',
          '## Missing Gaps',
          '- Refresh token flow not found',
          '',
          '## Suggested Next Actions',
          '- Search for refresh token implementation',
          '- Check src/middleware/refresh.ts',
        ].join('\n'),
      ),
    )

    const result = await executeRetrieval({ task: 'Find auth patterns' })

    expect(result.details).toBeDefined()
    const details = result.details as IterativeRetrievalDetails

    expect(details.task).toBe('Find auth patterns')
    expect(details.cycles).toBe(2)
    expect(details.paths).toHaveLength(2)
    expect(details.paths[0]).toEqual({
      path: 'src/auth.ts',
      relevance: 0.9,
      reason: 'jwt verification',
    })
    expect(details.sources).toHaveLength(1)
    expect(details.sources[0]).toEqual({
      path: 'https://jwt.io',
      relevance: 0.8,
      reason: 'jwt reference',
    })
    expect(details.findings).toEqual([
      'Uses HS256 signing',
      'Tokens expire after 1 hour',
    ])
    expect(details.gaps).toEqual(['Refresh token flow not found'])
    expect(details.suggestions).toEqual([
      'Search for refresh token implementation',
      'Check src/middleware/refresh.ts',
    ])
  })

  it('returns undefined details for unstructured output', async () => {
    mocks.runSingleAgent.mockResolvedValue(
      makeResult('Here is some plain text without structured headers.'),
    )

    const result = await executeRetrieval({ task: 'Find auth patterns' })

    expect(result.details).toBeUndefined()
    expect(firstText(result)).toContain('plain text')
  })

  it('returns undefined details and error text on subagent failure', async () => {
    mocks.runSingleAgent.mockResolvedValue(makeResult('timeout error', 1))

    const result = await executeRetrieval({ task: 'test' })

    expect(result.details).toBeUndefined()
    expect(firstText(result)).toBe('Iterative retrieval failed: timeout error')
  })

  it('returns error when iterative-retriever agent not found', async () => {
    const { discoverAgents } = await import('../../../lib/subagents/agents.js')
    vi.mocked(discoverAgents).mockReturnValue({
      agents: [],
      projectAgentsDir: undefined,
    })

    const result = await executeRetrieval({ task: 'test' })

    expect(firstText(result)).toBe('iterative-retriever agent not found.')

    vi.mocked(discoverAgents).mockReturnValue({
      agents: [
        {
          name: 'iterative-retriever',
          description: 'Iterative retriever',
          tools: [],
          systemPrompt: '',
          source: 'extension',
          filePath: '',
        },
      ],
      projectAgentsDir: undefined,
    })
  })
})
