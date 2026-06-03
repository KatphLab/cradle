import { afterEach, describe, expect, it, vi } from 'vitest'

import { createExaSearchProvider } from '../providers/exa.js'

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

describe('createExaSearchProvider', () => {
  it('fetches search results through the Exa search API', async () => {
    const fetchMock = stubFetch(
      Response.json({
        results: [
          {
            title: 'Example',
            url: 'https://example.com',
            text: 'A site about examples',
          },
        ],
      }),
    )
    const provider = createExaSearchProvider('exa-secret')

    const result = await provider.search({ query: 'test' })
    const init = getFetchInit(fetchMock)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.exa.ai/search',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(init).toMatchObject({
      headers: {
        'x-api-key': 'exa-secret',
        'Content-Type': 'application/json',
      },
    })
    expect(readJsonBody(init)).toEqual({
      query: 'test',
      contents: { text: true },
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
    const provider = createExaSearchProvider('exa-secret')

    await provider.search({
      query: 'test',
      limit: 5,
      includeDomains: ['example.com'],
      excludeDomains: ['bad.com'],
      country: 'DE',
    })

    const init = getFetchInit(fetchMock)
    expect(readJsonBody(init)).toEqual({
      query: 'test',
      contents: { text: true },
      numResults: 5,
      includeDomains: ['example.com'],
      excludeDomains: ['bad.com'],
      userLocation: 'DE',
    })
  })

  it('maps news sources to news category', async () => {
    const fetchMock = stubFetch(Response.json({ results: [] }))
    const provider = createExaSearchProvider('exa-secret')

    await provider.search({
      query: 'test',
      sources: ['news'],
    })

    const init = getFetchInit(fetchMock)
    expect(readJsonBody(init)).toEqual({
      query: 'test',
      contents: { text: true },
      category: 'news',
    })
  })

  it('omits category for unsupported sources', async () => {
    const fetchMock = stubFetch(Response.json({ results: [] }))
    const provider = createExaSearchProvider('exa-secret')

    await provider.search({
      query: 'test',
      sources: ['web', 'images'],
    })

    const init = getFetchInit(fetchMock)
    expect(readJsonBody(init)).toEqual({
      query: 'test',
      contents: { text: true },
    })
  })

  it('returns empty items when Exa returns no results', async () => {
    stubFetch(Response.json({ results: [] }))
    const provider = createExaSearchProvider('exa-secret')

    const result = await provider.search({ query: 'test' })

    expect(result).toEqual({ items: [] })
  })

  it('returns empty items when Exa response omits results field', async () => {
    stubFetch(Response.json({ query: 'test' }))
    const provider = createExaSearchProvider('exa-secret')

    const result = await provider.search({ query: 'test' })

    expect(result).toEqual({ items: [] })
  })

  it('throws API errors with response text', async () => {
    stubFetch(new Response('bad request', { status: 400 }))
    const provider = createExaSearchProvider('exa-secret')

    await expect(provider.search({ query: 'test' })).rejects.toThrow(
      'Exa API error (400): bad request',
    )
  })

  it('passes AbortSignal', async () => {
    const fetchMock = stubFetch(Response.json({ results: [] }))
    const provider = createExaSearchProvider('exa-secret')
    const controller = new AbortController()

    await provider.search({ query: 'test' }, controller.signal)

    const init = getFetchInit(fetchMock)
    expect(init).toMatchObject({ signal: controller.signal })
  })
})
