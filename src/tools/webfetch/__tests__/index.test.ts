import type { Message } from '@earendil-works/pi-ai'
import { readFile, rm } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RunSingleAgentOptions } from '../../../subagents/runner.js'
import type { SingleResult } from '../../../subagents/types.js'
import type * as SubagentUtilities from '../../../subagents/utilities.js'
import type { WebFetchProvider } from '../types.js'
import { ensureCacheDirectoryPath } from '../utilities.js'

const mocks = vi.hoisted(() => ({
  createFirecrawlProvider: vi.fn(),
  firecrawlFetch: vi.fn(),
  loadGlobalSettings: vi.fn(),
  nativeFetch: vi.fn(),
  runSingleAgent: vi.fn(),
}))

vi.mock('../../../config/settings.js', () => ({
  loadGlobalSettings: mocks.loadGlobalSettings,
}))

vi.mock('../providers/firecrawl.js', () => ({
  createFirecrawlProvider: mocks.createFirecrawlProvider,
}))

vi.mock('../providers/native.js', () => ({
  nativeProvider: {
    name: 'native',
    fetch: mocks.nativeFetch,
  },
}))

vi.mock('../../../subagents/runner.js', () => ({
  runSingleAgent: mocks.runSingleAgent,
}))

vi.mock('../../../subagents/agents.js', () => ({
  discoverAgents: vi.fn(() => ({
    agents: [
      {
        name: 'web-fetcher',
        description: 'Fetches web pages',
        tools: ['web_fetch_internal', 'read'],
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

const { webFetchInternalTool, webFetchTool } = await import('../index.js')

type InternalExecuteParameters =
  | { url: string; refresh?: boolean; maxAgeSeconds?: number }
  | { chain: { url: string }[]; refresh?: boolean; maxAgeSeconds?: number }

interface FacadeExecuteParameters {
  url: string
  question?: string
  refresh?: boolean
  maxAgeSeconds?: number
}

let cacheDirectory: string

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.loadGlobalSettings.mockResolvedValue({})
  mocks.createFirecrawlProvider.mockReturnValue({
    name: 'firecrawl',
    fetch: mocks.firecrawlFetch,
  } satisfies WebFetchProvider)
  cacheDirectory = await ensureCacheDirectoryPath()
})

afterEach(async () => {
  await rm(cacheDirectory, { force: true, recursive: true })
})

async function executeInternalFetch(parameters: InternalExecuteParameters) {
  return webFetchInternalTool.execute(
    'test-call',
    parameters,
    undefined,
    undefined,
    // @ts-expect-error web_fetch_internal does not read extension context
    {},
  )
}

function firstText(result: { content: { type: string; text?: string }[] }) {
  return result.content[0]?.text ?? ''
}

function makeResult(output: string, exitCode = 0): SingleResult {
  return {
    agent: 'web-fetcher',
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

async function executeFacadeFetch(parameters: FacadeExecuteParameters) {
  return webFetchTool.execute(
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

describe('webFetchInternalTool', () => {
  it('uses a root object parameter schema', () => {
    expect(webFetchInternalTool.parameters).toMatchObject({ type: 'object' })
    expect(webFetchInternalTool.parameters).toHaveProperty('anyOf')
  })

  it('fetches a single URL with the native provider and writes to durable cache', async () => {
    mocks.nativeFetch.mockResolvedValue({
      content: 'hello world',
      contentType: 'text/plain',
      status: 200,
    })

    const result = await executeInternalFetch({ url: 'https://example.com' })

    expect(mocks.loadGlobalSettings).toHaveBeenCalledOnce()
    expect(mocks.nativeFetch).toHaveBeenCalledWith(
      'https://example.com',
      undefined,
    )
    expect(firstText(result)).toContain('https://example.com →')
    expect(firstText(result)).toContain('[native]')
    expect(result.details).toMatchObject({
      mode: 'single',
      items: [
        {
          url: 'https://example.com',
          provider: 'native',
          status: 200,
          contentType: 'text/plain',
          size: 11,
          cacheStatus: 'refresh',
        },
      ],
    })
    const artifactPath = result.details?.items[0]?.artifactPath
    if (artifactPath === undefined) throw new Error('Expected artifact path')
    await expect(readFile(artifactPath, 'utf8')).resolves.toBe('hello world')
  })

  it('reuses cache on second fetch', async () => {
    mocks.nativeFetch.mockResolvedValue({
      content: 'cached content',
      contentType: 'text/plain',
      status: 200,
    })

    const first = await executeInternalFetch({
      url: 'https://example.com/cache',
    })
    expect(first.details?.items[0]?.cacheStatus).toBe('refresh')

    const second = await executeInternalFetch({
      url: 'https://example.com/cache',
    })
    expect(second.details?.items[0]?.cacheStatus).toBe('hit')
    expect(firstText(second)).toContain('(cached)')

    expect(mocks.nativeFetch).toHaveBeenCalledTimes(1)
  })

  it('refetches when refresh is true', async () => {
    mocks.nativeFetch.mockResolvedValue({
      content: 'fresh content',
      contentType: 'text/plain',
      status: 200,
    })

    const first = await executeInternalFetch({
      url: 'https://example.com/refresh',
    })
    expect(first.details?.items[0]?.cacheStatus).toBe('refresh')

    const second = await executeInternalFetch({
      url: 'https://example.com/refresh',
      refresh: true,
    })
    expect(second.details?.items[0]?.cacheStatus).toBe('refresh')

    expect(mocks.nativeFetch).toHaveBeenCalledTimes(2)
  })

  it('validates single URL input before fetching', async () => {
    const result = await executeInternalFetch({
      url: 'file:///etc/passwd',
    })

    expect(firstText(result)).toBe(
      'Invalid URL: must start with http:// or https://',
    )
    expect(result.details).toBeUndefined()
    expect(mocks.nativeFetch).not.toHaveBeenCalled()
  })

  it('fetches chains sequentially and substitutes the previous artifact path', async () => {
    mocks.nativeFetch.mockImplementation((url: string) =>
      Promise.resolve({
        content: `content from ${url}`,
        contentType: 'text/plain',
        status: 200,
      }),
    )

    const result = await executeInternalFetch({
      chain: [
        { url: 'https://example.com/start' },
        { url: 'https://example.com/next?previous={previous}' },
      ],
    })

    expect(result.details?.mode).toBe('chain')
    expect(result.details?.items).toHaveLength(2)
    const firstPath = result.details?.items[0]?.artifactPath
    const secondUrl = result.details?.items[1]?.url
    if (firstPath === undefined || secondUrl === undefined) {
      throw new Error('Expected chain items')
    }
    expect(secondUrl).toBe(`https://example.com/next?previous=${firstPath}`)
    expect(mocks.nativeFetch.mock.calls[1]?.[0]).toBe(secondUrl)
    expect(firstText(result)).toContain('[native]')
  })

  it('rejects chain inputs that exceed the maximum length', async () => {
    const chain = Array.from({ length: 11 }, (_value, index) => ({
      url: `https://example.com/${String(index)}`,
    }))

    const result = await executeInternalFetch({ chain })

    expect(firstText(result)).toContain(
      'Chain too long: 11 items exceeds max of 10',
    )
    expect(mocks.nativeFetch).not.toHaveBeenCalled()
  })

  it('validates each chain URL before fetching that step', async () => {
    mocks.nativeFetch.mockResolvedValue({
      content: 'first',
      contentType: 'text/plain',
      status: 200,
    })

    const result = await executeInternalFetch({
      chain: [{ url: 'https://example.com/start' }, { url: '{previous}' }],
    })

    expect(firstText(result)).toContain(
      'Step 2: Invalid URL: must start with http:// or https://',
    )
    expect(result.details).toBeUndefined()
    expect(mocks.nativeFetch).toHaveBeenCalledOnce()
  })

  it('uses Firecrawl first when configured and falls back to native fetch', async () => {
    mocks.loadGlobalSettings.mockResolvedValue({ firecrawlApiKey: 'key' })
    mocks.firecrawlFetch.mockRejectedValue(new Error('firecrawl down'))
    mocks.nativeFetch.mockResolvedValue({
      content: 'native content',
      contentType: 'text/plain',
      status: 200,
    })

    const result = await executeInternalFetch({ url: 'https://example.com' })

    expect(mocks.createFirecrawlProvider).toHaveBeenCalledWith('key')
    expect(mocks.firecrawlFetch).toHaveBeenCalledWith(
      'https://example.com',
      undefined,
    )
    expect(result.details?.items[0]?.provider).toBe('native')
  })

  it('throws when all providers fail', async () => {
    mocks.loadGlobalSettings.mockResolvedValue({ firecrawlApiKey: 'key' })
    mocks.firecrawlFetch.mockRejectedValue(new Error('firecrawl down'))
    mocks.nativeFetch.mockRejectedValue(new Error('native down'))

    const result = await executeInternalFetch({ url: 'https://example.com' })

    expect(firstText(result)).toContain('fetch failed')
    expect(result.details?.items[0]?.cacheStatus).toBe('error')
  })
})

describe('webFetchTool (facade)', () => {
  it('spawns web-fetcher with low complexity and returns its answer', async () => {
    mocks.runSingleAgent.mockResolvedValue(
      makeResult('The page discusses AI safety.'),
    )

    const result = await executeFacadeFetch({
      url: 'https://example.com',
    })

    expect(mocks.runSingleAgent).toHaveBeenCalledOnce()
    const options = getRunSingleAgentOptions()
    expect(options.agentName).toBe('web-fetcher')
    expect(options.complexity).toBe('low')
    expect(firstText(result)).toBe('The page discusses AI safety.')
  })

  it('passes question to the subagent task', async () => {
    mocks.runSingleAgent.mockResolvedValue(
      makeResult('Key takeaway: TypeScript is popular.'),
    )

    const result = await executeFacadeFetch({
      url: 'https://example.com',
      question: 'What are the key takeaways?',
    })

    expect(firstText(result)).toBe('Key takeaway: TypeScript is popular.')
    const options = getRunSingleAgentOptions()
    expect(options.task).toContain('What are the key takeaways?')
  })

  it('passes refresh and maxAgeSeconds to the subagent task', async () => {
    mocks.runSingleAgent.mockResolvedValue(makeResult('OK'))

    await executeFacadeFetch({
      url: 'https://example.com',
      refresh: true,
      maxAgeSeconds: 3600,
    })

    const options = getRunSingleAgentOptions()
    expect(options.task).toContain('refresh: true')
    expect(options.task).toContain('maxAgeSeconds: 3600')
  })

  it('validates URL before spawning subagent', async () => {
    const result = await executeFacadeFetch({
      url: 'file:///etc/passwd',
    })

    expect(firstText(result)).toBe(
      'Invalid URL: must start with http:// or https://',
    )
    expect(mocks.runSingleAgent).not.toHaveBeenCalled()
  })

  it('returns error when subagent fails', async () => {
    mocks.runSingleAgent.mockResolvedValue(makeResult('timeout error', 1))

    const result = await executeFacadeFetch({
      url: 'https://example.com',
    })

    expect(firstText(result)).toBe('Web fetch failed: timeout error')
  })
})
