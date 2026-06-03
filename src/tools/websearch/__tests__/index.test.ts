import type { Message } from '@earendil-works/pi-ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RunSingleAgentOptions } from '../../../subagents/runner.js'
import type { SingleResult } from '../../../subagents/types.js'
import type * as SubagentUtilities from '../../../subagents/utilities.js'
import type { WebSearchProvider } from '../types.js'

const mocks = vi.hoisted(() => ({
  createFirecrawlSearchProvider: vi.fn(),
  firecrawlSearch: vi.fn(),
  loadGlobalSettings: vi.fn(),
  runSingleAgent: vi.fn(),
}))

vi.mock('../../config/settings.js', () => ({
  loadGlobalSettings: mocks.loadGlobalSettings,
}))

vi.mock('../providers/firecrawl.js', () => ({
  createFirecrawlSearchProvider: mocks.createFirecrawlSearchProvider,
}))

vi.mock('../../../subagents/runner.js', () => ({
  runSingleAgent: mocks.runSingleAgent,
}))

vi.mock('../../../subagents/agents.js', () => ({
  discoverAgents: vi.fn(() => ({
    agents: [
      {
        name: 'web-searcher',
        description: 'Searches the web',
        tools: ['web_search_internal', 'read'],
        systemPrompt: '',
        source: 'extension',
        filePath: '',
      },
    ],
    projectAgentsDir: undefined,
  })),
}))

vi.mock('../../../subagents/utilities.js', async (importOriginal) => {
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

const { webSearchInternalTool, webSearchTool } = await import('../index.js')

interface InternalExecuteParameters {
  query: string
  limit?: number
  sources?: string[]
  includeDomains?: string[]
  excludeDomains?: string[]
  tbs?: string
  country?: string
}

interface FacadeExecuteParameters {
  query: string
  question?: string
  limit?: number
  sources?: string[]
  includeDomains?: string[]
  excludeDomains?: string[]
  tbs?: string
  country?: string
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.loadGlobalSettings.mockResolvedValue({})
})

async function executeInternalSearch(parameters: InternalExecuteParameters) {
  return webSearchInternalTool.execute(
    'test-call',
    parameters,
    undefined,
    undefined,
    // @ts-expect-error web_search_internal does not read extension context
    {},
  )
}

function firstText(result: { content: { type: string; text?: string }[] }) {
  return result.content[0]?.text ?? ''
}

function makeResult(output: string, exitCode = 0): SingleResult {
  return {
    agent: 'web-searcher',
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

async function executeSearch(parameters: FacadeExecuteParameters) {
  return webSearchTool.execute(
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

describe('webSearchInternalTool', () => {
  it('performs a search and returns results', async () => {
    mocks.loadGlobalSettings.mockResolvedValue({ firecrawlApiKey: 'key' })
    mocks.createFirecrawlSearchProvider.mockReturnValue({
      name: 'firecrawl',
      search: mocks.firecrawlSearch,
    } satisfies WebSearchProvider)
    mocks.firecrawlSearch.mockResolvedValue({
      items: [
        {
          title: 'Example',
          description: 'A site',
          url: 'https://example.com',
        },
      ],
    })

    const result = await executeInternalSearch({ query: 'test' })

    expect(firstText(result)).toContain('Example')
    expect(firstText(result)).toContain('https://example.com')
    expect(firstText(result)).toContain('firecrawl')
    expect(result.details).toMatchObject({
      items: [
        {
          title: 'Example',
          description: 'A site',
          url: 'https://example.com',
        },
      ],
      query: 'test',
      provider: 'firecrawl',
      resultCount: 1,
    })
  })

  it('throws when all providers fail', async () => {
    mocks.loadGlobalSettings.mockResolvedValue({ firecrawlApiKey: 'key' })
    mocks.createFirecrawlSearchProvider.mockReturnValue({
      name: 'firecrawl',
      search: mocks.firecrawlSearch,
    } satisfies WebSearchProvider)
    mocks.firecrawlSearch.mockRejectedValue(new Error('search down'))

    const result = await executeInternalSearch({ query: 'test' })

    expect(firstText(result)).toContain('Search failed')
  })

  it('passes optional parameters to provider', async () => {
    mocks.loadGlobalSettings.mockResolvedValue({ firecrawlApiKey: 'key' })
    mocks.createFirecrawlSearchProvider.mockReturnValue({
      name: 'firecrawl',
      search: mocks.firecrawlSearch,
    } satisfies WebSearchProvider)
    mocks.firecrawlSearch.mockResolvedValue({ items: [] })

    await executeInternalSearch({
      query: 'test',
      limit: 5,
      sources: ['web', 'news'],
      includeDomains: ['example.com'],
      country: 'DE',
    })

    expect(mocks.firecrawlSearch).toHaveBeenCalledWith(
      {
        query: 'test',
        limit: 5,
        sources: ['web', 'news'],
        includeDomains: ['example.com'],
        excludeDomains: undefined,
        tbs: undefined,
        country: 'DE',
      },
      undefined,
    )
  })
})

describe('webSearchTool (facade)', () => {
  it('spawns web-searcher with low complexity and returns answer', async () => {
    mocks.runSingleAgent.mockResolvedValue(
      makeResult('The search found AI safety resources.'),
    )

    const result = await executeSearch({ query: 'AI safety' })

    expect(firstText(result)).toBe('The search found AI safety resources.')
    expect(mocks.runSingleAgent).toHaveBeenCalledOnce()
    const options = getRunSingleAgentOptions()
    expect(options.agentName).toBe('web-searcher')
    expect(options.complexity).toBe('low')
  })

  it('passes question to subagent task', async () => {
    mocks.runSingleAgent.mockResolvedValue(makeResult('AI safety refers to...'))

    const result = await executeSearch({
      query: 'AI safety',
      question: 'What is AI safety?',
    })

    expect(firstText(result)).toBe('AI safety refers to...')
    const options = getRunSingleAgentOptions()
    expect(options.task).toContain('What is AI safety?')
  })

  it('passes limit and other params to subagent task', async () => {
    mocks.runSingleAgent.mockResolvedValue(makeResult('OK'))

    await executeSearch({ query: 'test', limit: 5, country: 'DE' })

    const options = getRunSingleAgentOptions()
    expect(options.task).toContain('limit: 5')
    expect(options.task).toContain('country: DE')
  })

  it('validates empty query', async () => {
    const result = await executeSearch({ query: '' })

    expect(firstText(result)).toBe('Query must be non-empty.')
    expect(mocks.runSingleAgent).not.toHaveBeenCalled()
  })

  it('returns error when subagent fails', async () => {
    mocks.runSingleAgent.mockResolvedValue(makeResult('timeout error', 1))

    const result = await executeSearch({ query: 'test' })

    expect(firstText(result)).toBe('Web search failed: timeout error')
  })

  it('returns error when web-searcher agent not found', async () => {
    const { discoverAgents } = await import('../../../subagents/agents.js')
    vi.mocked(discoverAgents).mockReturnValue({
      agents: [],
      projectAgentsDir: undefined,
    })

    const result = await executeSearch({ query: 'test' })

    expect(firstText(result)).toBe('web-searcher agent not found.')

    vi.mocked(discoverAgents).mockReturnValue({
      agents: [
        {
          name: 'web-searcher',
          description: 'Searches the web',
          tools: ['web_search_internal', 'read'],
          systemPrompt: '',
          source: 'extension',
          filePath: '',
        },
      ],
      projectAgentsDir: undefined,
    })
  })
})
