import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFirecrawlSearchProvider } from '../providers/firecrawl.js'

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

describe('createFirecrawlSearchProvider', () => {
  it('fetches search results through the Firecrawl search API', async () => {
    const fetchMock = stubFetch(
      Response.json({
        success: true,
        data: {
          web: [
            {
              title: 'Example',
              description: 'A site',
              url: 'https://example.com',
            },
          ],
        },
      }),
    )
    const provider = createFirecrawlSearchProvider('secret')

    const result = await provider.search({ query: 'test' })
    const init = getFetchInit(fetchMock)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.firecrawl.dev/v2/search',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(init).toMatchObject({
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json',
      },
    })
    expect(readJsonBody(init)).toEqual({
      query: 'test',
    })
    expect(result).toEqual({
      items: [
        {
          title: 'Example',
          description: 'A site',
          url: 'https://example.com',
        },
      ],
    })
  })

  it('passes optional parameters in request body', async () => {
    const fetchMock = stubFetch(
      Response.json({ success: true, data: { web: [] } }),
    )
    const provider = createFirecrawlSearchProvider('secret')

    await provider.search({
      query: 'test',
      limit: 5,
      sources: ['web', 'news'],
      includeDomains: ['example.com'],
      excludeDomains: ['bad.com'],
      tbs: 'qdr:d',
      country: 'DE',
    })

    const init = getFetchInit(fetchMock)
    expect(readJsonBody(init)).toEqual({
      query: 'test',
      limit: 5,
      sources: ['web', 'news'],
      includeDomains: ['example.com'],
      excludeDomains: ['bad.com'],
      tbs: 'qdr:d',
      country: 'DE',
    })
  })

  it('returns empty items when Firecrawl returns no web results', async () => {
    stubFetch(Response.json({ success: true, data: {} }))
    const provider = createFirecrawlSearchProvider('secret')

    const result = await provider.search({ query: 'test' })

    expect(result).toEqual({ items: [] })
  })

  it('throws API errors with response text', async () => {
    stubFetch(new Response('bad request', { status: 400 }))
    const provider = createFirecrawlSearchProvider('secret')

    await expect(provider.search({ query: 'test' })).rejects.toThrow(
      'Firecrawl API error (400): bad request',
    )
  })

  it('throws when successful HTTP responses contain failed payloads', async () => {
    stubFetch(Response.json({ success: false, data: {} }))
    const provider = createFirecrawlSearchProvider('secret')

    await expect(provider.search({ query: 'test' })).rejects.toThrow(
      'Firecrawl API returned unsuccessful response',
    )
  })

  it('passes AbortSignal', async () => {
    const fetchMock = stubFetch(
      Response.json({ success: true, data: { web: [] } }),
    )
    const provider = createFirecrawlSearchProvider('secret')
    const controller = new AbortController()

    await provider.search({ query: 'test' }, controller.signal)

    const init = getFetchInit(fetchMock)
    expect(init).toMatchObject({ signal: controller.signal })
  })
})
