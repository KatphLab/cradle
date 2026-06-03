import {
  handleFirecrawlError,
  validateFirecrawlSuccess,
} from '../../../utils/firecrawl.js'
import { isRecord } from '../../../utils/helpers.js'
import type { WebSearchProvider, WebSearchResponse } from '../types.js'

const FIRECRAWL_SEARCH_URL = 'https://api.firecrawl.dev/v2/search'

function extractWebResults(body: unknown): Record<string, unknown>[] {
  const data = validateFirecrawlSuccess(body)
  const web = data['web']
  if (!Array.isArray(web)) return []
  return web.filter(isRecord)
}

export function createFirecrawlSearchProvider(
  apiKey: string,
): WebSearchProvider {
  return {
    name: 'firecrawl',

    async search(parameters, signal): Promise<WebSearchResponse> {
      const body: Record<string, unknown> = {
        query: parameters.query,
      }

      if (parameters.limit !== undefined) body['limit'] = parameters.limit
      if (parameters.sources !== undefined) body['sources'] = parameters.sources
      if (parameters.includeDomains !== undefined)
        body['includeDomains'] = parameters.includeDomains
      if (parameters.excludeDomains !== undefined)
        body['excludeDomains'] = parameters.excludeDomains
      if (parameters.tbs !== undefined) body['tbs'] = parameters.tbs
      if (parameters.country !== undefined) body['country'] = parameters.country

      const response = await fetch(FIRECRAWL_SEARCH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        ...(signal !== undefined && { signal }),
      })

      if (!response.ok) {
        await handleFirecrawlError(response)
      }

      const json = await response.json()
      const webResults = extractWebResults(json)

      return {
        items: webResults.map((item) => ({
          title: typeof item['title'] === 'string' ? item['title'] : '',
          description:
            typeof item['description'] === 'string' ? item['description'] : '',
          url: typeof item['url'] === 'string' ? item['url'] : '',
        })),
      }
    },
  }
}
