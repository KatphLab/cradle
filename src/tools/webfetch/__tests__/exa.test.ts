import { afterEach, describe, expect, it, vi } from 'vitest'

import { createExaProvider } from '../providers/exa.js'

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

describe('createExaProvider', () => {
  it('fetches text through the Exa contents API', async () => {
    const fetchMock = stubFetch(
      Response.json({
        results: [
          {
            title: 'Example',
            url: 'https://example.com',
            text: '# Hello',
          },
        ],
      }),
    )
    const provider = createExaProvider('exa-secret')
    const controller = new AbortController()

    const result = await provider.fetch(
      'https://example.com',
      controller.signal,
    )
    const init = getFetchInit(fetchMock)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.exa.ai/contents',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(init).toMatchObject({
      headers: {
        'x-api-key': 'exa-secret',
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    })
    expect(readJsonBody(init)).toEqual({
      urls: ['https://example.com'],
      text: true,
    })
    expect(result).toEqual({
      content: '# Hello',
      contentType: 'text/markdown',
      status: 200,
    })
  })

  it('returns empty text when Exa omits text', async () => {
    stubFetch(
      Response.json({
        results: [{ url: 'https://example.com', title: 'Example' }],
      }),
    )
    const provider = createExaProvider('exa-secret')

    await expect(provider.fetch('https://example.com')).resolves.toMatchObject({
      content: '',
    })
  })

  it('returns empty text when Exa returns empty results', async () => {
    stubFetch(Response.json({ results: [] }))
    const provider = createExaProvider('exa-secret')

    await expect(provider.fetch('https://example.com')).resolves.toMatchObject({
      content: '',
    })
  })

  it('throws API errors with response text', async () => {
    stubFetch(new Response('bad request', { status: 400 }))
    const provider = createExaProvider('exa-secret')

    await expect(provider.fetch('https://example.com')).rejects.toThrow(
      'Exa API error (400): bad request',
    )
  })

  it('throws when successful HTTP responses contain unexpected payloads', async () => {
    stubFetch(Response.json({ unexpected: true }))
    const provider = createExaProvider('exa-secret')

    await expect(provider.fetch('https://example.com')).rejects.toThrow(
      'Exa API returned unexpected response',
    )
  })
})
