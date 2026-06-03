import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFirecrawlProvider } from '../providers/firecrawl.js'

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

describe('createFirecrawlProvider', () => {
  it('fetches markdown through the Firecrawl scrape API', async () => {
    const fetchMock = stubFetch(
      Response.json({ success: true, data: { markdown: '# Hello' } }),
    )
    const provider = createFirecrawlProvider('secret')
    const controller = new AbortController()

    const result = await provider.fetch(
      'https://example.com',
      controller.signal,
    )
    const init = getFetchInit(fetchMock)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.firecrawl.dev/v2/scrape',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(init).toMatchObject({
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    })
    expect(readJsonBody(init)).toEqual({
      url: 'https://example.com',
      formats: ['markdown'],
      onlyMainContent: true,
    })
    expect(result).toEqual({
      content: '# Hello',
      contentType: 'text/markdown',
      status: 200,
    })
  })

  it('returns empty markdown when Firecrawl omits markdown', async () => {
    stubFetch(Response.json({ success: true, data: {} }))
    const provider = createFirecrawlProvider('secret')

    await expect(provider.fetch('https://example.com')).resolves.toMatchObject({
      content: '',
    })
  })

  it('throws API errors with response text', async () => {
    stubFetch(new Response('bad request', { status: 400 }))
    const provider = createFirecrawlProvider('secret')

    await expect(provider.fetch('https://example.com')).rejects.toThrow(
      'Firecrawl API error (400): bad request',
    )
  })

  it('throws when successful HTTP responses contain failed payloads', async () => {
    stubFetch(Response.json({ success: false, data: {} }))
    const provider = createFirecrawlProvider('secret')

    await expect(provider.fetch('https://example.com')).rejects.toThrow(
      'Firecrawl API returned unsuccessful response',
    )
  })
})
