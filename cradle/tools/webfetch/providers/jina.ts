import { handleJinaError } from '../../../utils/jina.js'
import type { FetchResult, WebFetchProvider } from '../types.js'

const JINA_READER_URL = 'https://r.jina.ai'

export function createJinaProvider(apiKey?: string): WebFetchProvider {
  return {
    name: 'jina',

    async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
      const headers: Record<string, string> = {}
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`
      }

      const response = await fetch(`${JINA_READER_URL}/${url}`, {
        headers,
        ...(signal !== undefined && { signal }),
      })

      if (!response.ok) {
        await handleJinaError(response)
      }

      const content = await response.text()

      return {
        content,
        contentType: 'text/markdown',
        status: 200,
      }
    },
  }
}
