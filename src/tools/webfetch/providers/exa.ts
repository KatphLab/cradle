import { handleExaError, validateExaResults } from '../../../utils/exa.js'
import type { FetchResult, WebFetchProvider } from '../types.js'

const EXA_CONTENTS_URL = 'https://api.exa.ai/contents'

export function createExaProvider(apiKey: string): WebFetchProvider {
  return {
    name: 'exa',

    async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
      const response = await fetch(EXA_CONTENTS_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          urls: [url],
          text: true,
        }),
        ...(signal !== undefined && { signal }),
      })

      if (!response.ok) {
        await handleExaError(response)
      }

      const body = await response.json()
      const results = validateExaResults(body)
      const [first] = results
      const text = typeof first?.['text'] === 'string' ? first['text'] : ''

      return {
        content: text,
        contentType: 'text/markdown',
        status: 200,
      }
    },
  }
}
