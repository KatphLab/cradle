import { afterEach, describe, expect, it, vi } from 'vitest'

import { nativeProvider } from '../providers/native.js'

const maxResponseBytes = 5 * 1024 * 1024

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function getFetchInit(
  fetchMock: ReturnType<typeof vi.fn>,
  index: number,
): object {
  const call = fetchMock.mock.calls[index]
  if (call === undefined) {
    throw new Error(`Expected fetch call ${String(index)}`)
  }
  const init: unknown = call[1]
  if (typeof init !== 'object' || init === null) {
    throw new Error('Expected fetch init')
  }
  return init
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null) return false
  return Object.values(value).every((item) => typeof item === 'string')
}

function getHeaders(init: object): Record<string, string> {
  if (!('headers' in init) || !isStringRecord(init.headers)) {
    throw new Error('Expected fetch headers')
  }
  return init.headers
}

describe('nativeProvider', () => {
  it('fetches HTML and converts it to markdown', async () => {
    const fetchMock = stubFetch(
      new Response('<h1>Hello</h1><p>world</p>', {
        status: 201,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    )

    const result = await nativeProvider.fetch('https://example.com')
    const init = getFetchInit(fetchMock, 0)
    const headers = getHeaders(init)

    expect(headers['User-Agent']).toContain('Mozilla/5.0')
    expect(headers['Accept']).toContain('text/html')
    expect(result).toEqual({
      content: 'Hello\n=====\n\nworld',
      contentType: 'text/html',
      status: 201,
    })
  })

  it('retries Cloudflare challenges with the honest user agent', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('challenge', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge' },
        }),
      )
      .mockResolvedValueOnce(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await nativeProvider.fetch('https://example.com')
    const retryInit = getFetchInit(fetchMock, 1)
    const retryHeaders = getHeaders(retryInit)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(retryHeaders['User-Agent']).toBe('opencode')
    expect(result.content).toBe('ok')
    expect(result.contentType).toBe('text/plain')
  })

  it('forwards an abort signal to fetch', async () => {
    const fetchMock = stubFetch(new Response('ok'))
    const controller = new AbortController()

    await nativeProvider.fetch('https://example.com', controller.signal)
    const init = getFetchInit(fetchMock, 0)

    expect(init).toMatchObject({ signal: controller.signal })
  })

  it('rejects responses that declare an oversized content length', async () => {
    stubFetch(
      new Response('', {
        headers: { 'content-length': String(maxResponseBytes + 1) },
      }),
    )

    await expect(nativeProvider.fetch('https://example.com')).rejects.toThrow(
      'Response too large',
    )
  })

  it('rejects bodies that exceed the response size limit', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(new Uint8Array(maxResponseBytes + 1)))
      .mockResolvedValueOnce(new Response(new Uint8Array(maxResponseBytes + 1)))
    vi.stubGlobal('fetch', fetchMock)

    await expect(nativeProvider.fetch('https://example.com')).rejects.toThrow(
      'Response too large',
    )
  })

  it('normalizes unknown fetch failures on the final attempt', async () => {
    const fetchMock = vi.fn().mockRejectedValue('nope')
    vi.stubGlobal('fetch', fetchMock)

    await expect(nativeProvider.fetch('https://example.com')).rejects.toThrow(
      'Unknown error',
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
