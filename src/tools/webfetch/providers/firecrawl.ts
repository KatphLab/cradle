import type { FetchResult, WebFetchProvider } from '../types.js'

const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function validateSuccess(body: unknown): Record<string, unknown> {
  if (
    !isRecord(body) ||
    !('success' in body) ||
    !body['success'] ||
    !('data' in body) ||
    !isRecord(body['data'])
  ) {
    throw new Error('Firecrawl API returned unsuccessful response')
  }
  return body['data']
}

function extractMarkdown(body: unknown): string {
  const data = validateSuccess(body)
  return typeof data['markdown'] === 'string' ? data['markdown'] : ''
}

export function createFirecrawlProvider(apiKey: string): WebFetchProvider {
  return {
    name: 'firecrawl',

    async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
      const response = await fetch(FIRECRAWL_SCRAPE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          formats: ['markdown'],
          onlyMainContent: true,
        }),
        ...(signal !== undefined && { signal }),
      })

      if (!response.ok) {
        const errorText = await response
          .text()
          .catch(() => 'Failed to read error response')
        throw new Error(
          `Firecrawl API error (${response.status}): ${errorText}`,
        )
      }

      const body = await response.json()
      const markdown = extractMarkdown(body)

      return {
        content: markdown,
        contentType: 'text/markdown',
        status: 200,
      }
    },
  }
}
