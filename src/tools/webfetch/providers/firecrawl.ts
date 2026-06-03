import {
  handleFirecrawlError,
  validateFirecrawlSuccess,
} from '../../../utils/firecrawl.js'
import type { FetchResult, WebFetchProvider } from '../types.js'

const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape'

function extractMarkdown(body: unknown): string {
  const data = validateFirecrawlSuccess(body)
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
        await handleFirecrawlError(response)
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
