import {
  handleTavilyError,
  validateTavilyExtract,
} from '../../../utils/tavily.js'
import type { FetchResult, WebFetchProvider } from '../types.js'

const TAVILY_EXTRACT_URL = 'https://api.tavily.com/extract'

function extractMarkdown(results: Record<string, unknown>[]): string {
  const [first] = results
  if (first === undefined) return ''
  const raw = first['raw_content']
  return typeof raw === 'string' ? raw : ''
}

export function createTavilyProvider(apiKey: string): WebFetchProvider {
  return {
    name: 'tavily',

    async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
      const response = await fetch(TAVILY_EXTRACT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          urls: url,
          format: 'markdown',
          extract_depth: 'basic',
        }),
        ...(signal !== undefined && { signal }),
      })

      if (!response.ok) {
        await handleTavilyError(response)
      }

      const body = await response.json()
      const results = validateTavilyExtract(body)
      const markdown = extractMarkdown(results)

      return {
        content: markdown,
        contentType: 'text/markdown',
        status: 200,
      }
    },
  }
}
