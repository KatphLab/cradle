import { handleExaError } from '../../../utils/exa.js'
import { isRecord } from '../../../utils/type-guards.js'
import type { WebSearchProvider, WebSearchResponse } from '../types.js'

const EXA_SEARCH_URL = 'https://api.exa.ai/search'

function extractExaResults(body: unknown): Record<string, unknown>[] {
  const results =
    isRecord(body) && Array.isArray(body['results']) ? body['results'] : []
  return results.filter(isRecord)
}

function mapSourcesToCategory(sources?: string[]): string | undefined {
  if (!sources || sources.length === 0) return undefined
  if (sources.includes('news')) return 'news'
  return undefined
}

export function createExaSearchProvider(apiKey: string): WebSearchProvider {
  return {
    name: 'exa',

    async search(parameters, signal): Promise<WebSearchResponse> {
      const body: Record<string, unknown> = {
        query: parameters.query,
        contents: { text: true },
      }

      if (parameters.limit !== undefined) body['numResults'] = parameters.limit
      if (parameters.includeDomains !== undefined)
        body['includeDomains'] = parameters.includeDomains
      if (parameters.excludeDomains !== undefined)
        body['excludeDomains'] = parameters.excludeDomains
      if (parameters.country !== undefined)
        body['userLocation'] = parameters.country

      const category = mapSourcesToCategory(parameters.sources)
      if (category !== undefined) body['category'] = category

      const response = await fetch(EXA_SEARCH_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        ...(signal !== undefined && { signal }),
      })

      if (!response.ok) {
        await handleExaError(response)
      }

      const json = await response.json()
      const results = extractExaResults(json)

      return {
        items: results.map((item) => ({
          title: typeof item['title'] === 'string' ? item['title'] : '',
          description: typeof item['text'] === 'string' ? item['text'] : '',
          url: typeof item['url'] === 'string' ? item['url'] : '',
        })),
      }
    },
  }
}
