import { afterEach, describe, expect, it, vi } from 'vitest'

import { createJinaProvider } from '../providers/jina.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('createJinaProvider', () => {
  it('fetches markdown from the Jina reader without an API key', async () => {
    const fetchMock = stubFetch(
      new Response('# Hello from Jina', { status: 200 }),
    )
    const provider = createJinaProvider()

    const result = await provider.fetch('https://example.com')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://r.jina.ai/https://example.com',
      { headers: {} },
    )
    expect(result).toEqual({
      content: '# Hello from Jina',
      contentType: 'text/markdown',
      status: 200,
    })
  })

  it('includes an Authorization header when an API key is provided', async () => {
    const fetchMock = stubFetch(
      new Response('premium content', { status: 200 }),
    )
    const provider = createJinaProvider('jina-secret')

    await provider.fetch('https://example.com')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://r.jina.ai/https://example.com',
      {
        headers: { Authorization: 'Bearer jina-secret' },
      },
    )
  })

  it('forwards an AbortSignal when provided', async () => {
    const fetchMock = stubFetch(new Response('content', { status: 200 }))
    const provider = createJinaProvider()
    const controller = new AbortController()

    await provider.fetch('https://example.com', controller.signal)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://r.jina.ai/https://example.com',
      {
        headers: {},
        signal: controller.signal,
      },
    )
  })

  it('throws API errors with the response text', async () => {
    stubFetch(new Response('rate limit exceeded', { status: 429 }))
    const provider = createJinaProvider()

    await expect(provider.fetch('https://example.com')).rejects.toThrow(
      'Jina API error (429): rate limit exceeded',
    )
  })
})
