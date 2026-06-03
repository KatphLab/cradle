import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  FetchResult,
  WebFetchDetails,
  WebFetchProvider,
} from '../types.js'

const mocks = vi.hoisted(() => ({
  createFirecrawlProvider: vi.fn(),
  firecrawlFetch: vi.fn(),
  loadGlobalSettings: vi.fn(),
  nativeFetch: vi.fn(),
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

const { webFetchTool } = await import('../index.js')

interface ExecuteParameters {
  url?: string
  chain?: { url: string }[]
}

const createdDirectories = new Set<string>()

beforeEach(() => {
  vi.clearAllMocks()
  mocks.loadGlobalSettings.mockResolvedValue({})
  mocks.createFirecrawlProvider.mockReturnValue({
    name: 'firecrawl',
    fetch: mocks.firecrawlFetch,
  } satisfies WebFetchProvider)
})

afterEach(async () => {
  for (const directory of createdDirectories) {
    await rm(directory, { force: true, recursive: true })
  }
  createdDirectories.clear()
})

function fetchResult(content: string): FetchResult {
  return {
    content,
    contentType: 'text/plain',
    status: 200,
  }
}

async function executeWebFetch(parameters: ExecuteParameters) {
  const result = await webFetchTool.execute(
    'test-call',
    parameters,
    undefined,
    undefined,
    // @ts-expect-error web_fetch does not read extension context
    {},
  )
  trackTemporaryDirectories(result.details)
  return result
}

function trackTemporaryDirectories(details: WebFetchDetails | undefined): void {
  if (details === undefined) return
  for (const item of details.items) {
    createdDirectories.add(path.dirname(item.filePath))
  }
}

function firstText(result: { content: { type: string; text?: string }[] }) {
  return result.content[0]?.text ?? ''
}

describe('webFetchTool', () => {
  it('fetches a single URL with the native provider and writes the result', async () => {
    mocks.nativeFetch.mockResolvedValue(fetchResult('hello'))

    const result = await executeWebFetch({ url: 'https://example.com' })

    expect(mocks.loadGlobalSettings).toHaveBeenCalledOnce()
    expect(mocks.nativeFetch).toHaveBeenCalledWith(
      'https://example.com',
      undefined,
    )
    expect(firstText(result)).toContain(
      'Fetched https://example.com via native',
    )
    expect(result.details).toMatchObject({
      mode: 'single',
      items: [
        {
          url: 'https://example.com',
          provider: 'native',
          status: 200,
          contentType: 'text/plain',
          size: 5,
        },
      ],
    })
    const filePath = result.details?.items[0]?.filePath
    if (filePath === undefined) throw new Error('Expected output file')
    await expect(readFile(filePath, 'utf8')).resolves.toBe('hello')
  })

  it('validates single URL input before fetching', async () => {
    const result = await executeWebFetch({ url: 'file:///etc/passwd' })

    expect(firstText(result)).toBe(
      'Invalid URL: must start with http:// or https://',
    )
    expect(result.details).toBeUndefined()
    expect(mocks.nativeFetch).not.toHaveBeenCalled()
  })

  it('fetches chains sequentially and substitutes the previous file path', async () => {
    mocks.nativeFetch.mockImplementation((url: string) =>
      Promise.resolve(fetchResult(`content from ${url}`)),
    )

    const result = await executeWebFetch({
      chain: [
        { url: 'https://example.com/start' },
        { url: 'https://example.com/next?previous={previous}' },
      ],
    })

    expect(result.details?.mode).toBe('chain')
    expect(result.details?.items).toHaveLength(2)
    const firstFilePath = result.details?.items[0]?.filePath
    const secondUrl = result.details?.items[1]?.url
    if (firstFilePath === undefined || secondUrl === undefined) {
      throw new Error('Expected chain items')
    }
    expect(secondUrl).toBe(`https://example.com/next?previous=${firstFilePath}`)
    expect(mocks.nativeFetch.mock.calls[1]?.[0]).toBe(secondUrl)
    expect(firstText(result)).toContain('Fetched 2 URLs')
  })

  it('rejects chain inputs that exceed the maximum length', async () => {
    const chain = Array.from({ length: 11 }, (_value, index) => ({
      url: `https://example.com/${String(index)}`,
    }))

    const result = await executeWebFetch({ chain })

    expect(firstText(result)).toContain(
      'Chain too long: 11 items exceeds max of 10',
    )
    expect(mocks.nativeFetch).not.toHaveBeenCalled()
  })

  it('validates each chain URL before fetching that step', async () => {
    mocks.nativeFetch.mockResolvedValue(fetchResult('first'))

    const result = await executeWebFetch({
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
    mocks.nativeFetch.mockResolvedValue(fetchResult('native content'))

    const result = await executeWebFetch({ url: 'https://example.com' })

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

    await expect(
      executeWebFetch({ url: 'https://example.com' }),
    ).rejects.toThrow('Failed to fetch https://example.com: native down')
  })

  it('returns an error when no mode is provided', async () => {
    const result = await executeWebFetch({})

    expect(firstText(result)).toBe('Provide either url or chain parameters.')
    expect(result.details).toBeUndefined()
  })
})
