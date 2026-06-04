import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTavilyProvider } from '../providers/tavily.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function getFetchInit(fetchMock: ReturnType<typeof vi.fn>): object {
  const call = fetchMock.mock.calls[0]
  if (call === undefined) {
    throw new Error('Expected fetch call')
  }
  const init: unknown = call[1]
  if (typeof init !== 'object' || init === null) {
    throw new Error('Expected fetch init')
  }
  return init
}

function readJsonBody(init: object): unknown {
  if (!('body' in init) || typeof init.body !== 'string') {
    throw new Error('Expected JSON body')
  }
  const parsed: unknown = JSON.parse(init.body)
  return parsed
}

describe('createTavilyProvider', () => {
  it('fetches markdown through the Tavily extract API', async () => {
    const fetchMock = stubFetch(
      Response.json({
        results: [{ url: 'https://example.com', raw_content: '# Hello' }],
      }),
    )
    const provider = createTavilyProvider('tvly-secret')
    const controller = new AbortController()

    const result = await provider.fetch(
      'https://example.com',
      controller.signal,
    )
    const init = getFetchInit(fetchMock)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.tavily.com/extract',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(init).toMatchObject({
      headers: {
        Authorization: 'Bearer tvly-secret',
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    })
    expect(readJsonBody(init)).toEqual({
      urls: 'https://example.com',
      format: 'markdown',
      extract_depth: 'basic',
    })
    expect(result).toEqual({
      content: '# Hello',
      contentType: 'text/markdown',
      status: 200,
    })
  })

  it('returns empty markdown when Tavily omits raw_content', async () => {
    stubFetch(Response.json({ results: [{ url: 'https://example.com' }] }))
    const provider = createTavilyProvider('tvly-secret')

    await expect(provider.fetch('https://example.com')).resolves.toMatchObject({
      content: '',
    })
  })

  it('returns empty markdown when Tavily returns empty results', async () => {
    stubFetch(Response.json({ results: [] }))
    const provider = createTavilyProvider('tvly-secret')

    await expect(provider.fetch('https://example.com')).resolves.toMatchObject({
      content: '',
    })
  })

  it('throws API errors with response text', async () => {
    stubFetch(new Response('bad request', { status: 400 }))
    const provider = createTavilyProvider('tvly-secret')

    await expect(provider.fetch('https://example.com')).rejects.toThrow(
      'Tavily API error (400): bad request',
    )
  })

  it('throws when successful HTTP responses contain unexpected payloads', async () => {
    stubFetch(Response.json({ unexpected: true }))
    const provider = createTavilyProvider('tvly-secret')

    await expect(provider.fetch('https://example.com')).rejects.toThrow(
      'Tavily API returned unexpected response',
    )
  })
})
