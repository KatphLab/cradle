import { isRecord } from '../../../utils/helpers.js'
import { handleTavilyError } from '../../../utils/tavily.js'
import type { WebSearchProvider, WebSearchResponse } from '../types.js'
import { fetchPostJson } from './helpers.js'

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search'

function extractResults(body: unknown): Record<string, unknown>[] {
  if (
    !isRecord(body) ||
    !('results' in body) ||
    !Array.isArray(body['results'])
  ) {
    return []
  }
  return body['results'].filter(isRecord)
}

function mapSourcesToTopic(sources?: string[]): string | undefined {
  if (!sources || sources.length === 0) return undefined
  if (sources.includes('news')) return 'news'
  if (sources.includes('finance')) return 'finance'
  return 'general'
}

function mapTbsToTimeRange(tbs?: string): string | undefined {
  if (!tbs) return undefined
  if (tbs === 'qdr:d' || tbs === 'day') return 'day'
  if (tbs === 'qdr:w' || tbs === 'week') return 'week'
  if (tbs === 'qdr:m' || tbs === 'month') return 'month'
  if (tbs === 'qdr:y' || tbs === 'year') return 'year'
  return undefined
}

function buildSearchBody(
  parameters: Parameters<WebSearchProvider['search']>[0],
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    query: parameters.query,
  }

  if (parameters.limit !== undefined) body['max_results'] = parameters.limit
  if (parameters.sources !== undefined) {
    const topic = mapSourcesToTopic(parameters.sources)
    if (topic !== undefined) body['topic'] = topic
  }
  if (parameters.includeDomains !== undefined) {
    body['include_domains'] = parameters.includeDomains
  }
  if (parameters.excludeDomains !== undefined) {
    body['exclude_domains'] = parameters.excludeDomains
  }
  if (parameters.tbs !== undefined) {
    const timeRange = mapTbsToTimeRange(parameters.tbs)
    if (timeRange !== undefined) body['time_range'] = timeRange
  }
  if (parameters.country !== undefined) body['country'] = parameters.country

  return body
}

export function createTavilySearchProvider(apiKey: string): WebSearchProvider {
  return {
    name: 'tavily',

    async search(parameters, signal): Promise<WebSearchResponse> {
      const body = buildSearchBody(parameters)

      const json = await fetchPostJson(
        TAVILY_SEARCH_URL,
        apiKey,
        body,
        handleTavilyError,
        signal,
      )
      const results = extractResults(json)

      return {
        items: results.map((item) => ({
          title: typeof item['title'] === 'string' ? item['title'] : '',
          description:
            typeof item['content'] === 'string' ? item['content'] : '',
          url: typeof item['url'] === 'string' ? item['url'] : '',
        })),
      }
    },
  }
}
