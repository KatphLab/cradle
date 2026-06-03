import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTavilySearchProvider } from '../providers/tavily.js'

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

describe('createTavilySearchProvider', () => {
  it('fetches search results through the Tavily search API', async () => {
    const fetchMock = stubFetch(
      Response.json({
        results: [
          {
            title: 'Example',
            content: 'A site about examples',
            url: 'https://example.com',
          },
        ],
      }),
    )
    const provider = createTavilySearchProvider('tvly-secret')

    const result = await provider.search({ query: 'test' })
    const init = getFetchInit(fetchMock)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.tavily.com/search',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(init).toMatchObject({
      headers: {
        Authorization: 'Bearer tvly-secret',
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
          description: 'A site about examples',
          url: 'https://example.com',
        },
      ],
    })
  })

  it('passes optional parameters in request body', async () => {
    const fetchMock = stubFetch(Response.json({ results: [] }))
    const provider = createTavilySearchProvider('tvly-secret')

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
      max_results: 5,
      topic: 'news',
      include_domains: ['example.com'],
      exclude_domains: ['bad.com'],
      time_range: 'day',
      country: 'DE',
    })
  })

  it('maps web sources to general topic', async () => {
    const fetchMock = stubFetch(Response.json({ results: [] }))
    const provider = createTavilySearchProvider('tvly-secret')

    await provider.search({
      query: 'test',
      sources: ['web'],
    })

    const init = getFetchInit(fetchMock)
    expect(readJsonBody(init)).toEqual({
      query: 'test',
      topic: 'general',
    })
  })

  it('maps finance sources to finance topic', async () => {
    const fetchMock = stubFetch(Response.json({ results: [] }))
    const provider = createTavilySearchProvider('tvly-secret')

    await provider.search({
      query: 'test',
      sources: ['finance'],
    })

    const init = getFetchInit(fetchMock)
    expect(readJsonBody(init)).toEqual({
      query: 'test',
      topic: 'finance',
    })
  })

  it('omits topic and time_range for empty sources and unsupported tbs', async () => {
    const fetchMock = stubFetch(Response.json({ results: [] }))
    const provider = createTavilySearchProvider('tvly-secret')

    await provider.search({
      query: 'test',
      sources: [],
      tbs: 'unsupported',
    })

    const init = getFetchInit(fetchMock)
    expect(readJsonBody(init)).toEqual({ query: 'test' })
  })

  it.each([
    ['qdr:w', 'week'],
    ['qdr:m', 'month'],
    ['qdr:y', 'year'],
  ])('maps %s tbs to %s time_range', async (tbs, timeRange) => {
    const fetchMock = stubFetch(Response.json({ results: [] }))
    const provider = createTavilySearchProvider('tvly-secret')

    await provider.search({ query: 'test', tbs })

    const init = getFetchInit(fetchMock)
    expect(readJsonBody(init)).toEqual({
      query: 'test',
      time_range: timeRange,
    })
  })

  it('returns empty items when Tavily returns no results', async () => {
    stubFetch(Response.json({ results: [] }))
    const provider = createTavilySearchProvider('tvly-secret')

    const result = await provider.search({ query: 'test' })

    expect(result).toEqual({ items: [] })
  })

  it('returns empty items when Tavily response omits results field', async () => {
    stubFetch(Response.json({ query: 'test' }))
    const provider = createTavilySearchProvider('tvly-secret')

    const result = await provider.search({ query: 'test' })

    expect(result).toEqual({ items: [] })
  })

  it('throws API errors with response text', async () => {
    stubFetch(new Response('bad request', { status: 400 }))
    const provider = createTavilySearchProvider('tvly-secret')

    await expect(provider.search({ query: 'test' })).rejects.toThrow(
      'Tavily API error (400): bad request',
    )
  })

  it('passes AbortSignal', async () => {
    const fetchMock = stubFetch(Response.json({ results: [] }))
    const provider = createTavilySearchProvider('tvly-secret')
    const controller = new AbortController()

    await provider.search({ query: 'test' }, controller.signal)

    const init = getFetchInit(fetchMock)
    expect(init).toMatchObject({ signal: controller.signal })
  })
})
