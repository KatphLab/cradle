import TurndownService from 'turndown'
import type { FetchResult, WebFetchProvider } from '../types.js'

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024 // 5 MB

const CHROME_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const HONEST_UA = 'opencode'

const HTML_ACCEPT = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'

function isHtmlContentType(contentType: string): boolean {
  return (
    contentType.includes('text/html') ||
    contentType.includes('application/xhtml')
  )
}

async function attemptFetch(
  url: string,
  signal: AbortSignal | undefined,
  isRetry: boolean,
): Promise<Response> {
  const headers: Record<string, string> = {
    'User-Agent': isRetry ? HONEST_UA : CHROME_UA,
    Accept: HTML_ACCEPT,
  }

  return fetch(url, {
    headers,
    ...(signal !== undefined && { signal }),
    redirect: 'follow',
  })
}

async function readResponseBody(response: Response): Promise<string> {
  const contentLength = response.headers.get('content-length')
  if (
    contentLength &&
    Number.parseInt(contentLength, 10) > MAX_RESPONSE_BYTES
  ) {
    throw new Error(
      `Response too large: ${contentLength} bytes exceeds 5MB limit`,
    )
  }

  const arrayBuffer = await response.arrayBuffer()
  if (arrayBuffer.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error(
      `Response too large: ${arrayBuffer.byteLength} bytes exceeds 5MB limit`,
    )
  }

  return Buffer.from(arrayBuffer).toString('binary')
}

function convertToMarkdown(body: string, contentType: string): string {
  if (isHtmlContentType(contentType)) {
    const turndown = new TurndownService()
    return turndown.turndown(body)
  }
  return body
}

function isCloudflareChallenge(response: Response): boolean {
  return (
    response.status === 403 &&
    response.headers.get('cf-mitigated') === 'challenge'
  )
}

export const nativeProvider: WebFetchProvider = {
  name: 'native',

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    const maxAttempts = 2

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await attemptFetch(url, signal, attempt > 0)

        if (isCloudflareChallenge(response)) {
          continue
        }

        const rawContentType =
          (response.headers.get('content-type') ?? 'text/plain')
            .split(';')[0]
            ?.trim() ?? 'text/plain'

        const body = await readResponseBody(response)
        const converted = convertToMarkdown(body, rawContentType)

        return {
          content: converted,
          contentType: rawContentType,
          status: response.status,
        }
      } catch (error: unknown) {
        const isLastAttempt = attempt === maxAttempts - 1
        if (isLastAttempt) {
          const message =
            error instanceof Error ? error.message : 'Unknown error'
          throw new Error(`Failed to fetch ${url}: ${message}`)
        }
      }
    }

    throw new Error('No response received')
  },
}
