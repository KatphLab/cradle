import type { TextContent } from '@earendil-works/pi-ai'
import { Type } from '@earendil-works/pi-ai'

export interface WebSearchOptions {
  query: string
  limit?: number
  sources?: string[]
  includeDomains?: string[]
  excludeDomains?: string[]
  tbs?: string
  country?: string
}

interface WebSearchResultItem {
  title: string
  description: string
  url: string
}

export interface WebSearchResponse {
  items: WebSearchResultItem[]
}

export interface WebSearchProvider {
  name: string
  search(
    parameters: WebSearchOptions,
    signal?: AbortSignal,
  ): Promise<WebSearchResponse>
}

export interface WebSearchDetails {
  items: WebSearchResultItem[]
  query: string
  provider: string
  resultCount: number
}

export function searchToolError(message: string): {
  content: [TextContent]
  details: undefined
} {
  return {
    content: [{ type: 'text', text: message }],
    details: undefined,
  }
}

const QueryParameter = Type.String({ description: 'The search query string' })
const LimitParameter = Type.Optional(
  Type.Number({
    description: 'Maximum number of results to return. Default: 10.',
    default: 10,
  }),
)
const SourcesParameter = Type.Optional(
  Type.Array(Type.String(), {
    description: 'Sources to search: web, images, news. Default: ["web"].',
  }),
)
const IncludeDomainsParameter = Type.Optional(
  Type.Array(Type.String(), {
    description: 'Limit results to these domains.',
  }),
)
const ExcludeDomainsParameter = Type.Optional(
  Type.Array(Type.String(), {
    description: 'Exclude results from these domains.',
  }),
)
const TbsParameter = Type.Optional(
  Type.String({
    description: 'Time-based search filter.',
  }),
)
const CountryParameter = Type.Optional(
  Type.String({
    description: 'Country code for search results. Default: "US".',
    default: 'US',
  }),
)

export const WebSearchInternalParameters = Type.Object({
  query: QueryParameter,
  limit: LimitParameter,
  sources: SourcesParameter,
  includeDomains: IncludeDomainsParameter,
  excludeDomains: ExcludeDomainsParameter,
  tbs: TbsParameter,
  country: CountryParameter,
})

export const WebSearchParameters = Type.Object({
  query: QueryParameter,
  question: Type.Optional(
    Type.String({
      description:
        'Question to answer from the search results, or instructions for summarization. If omitted, a concise summary is returned.',
    }),
  ),
  limit: LimitParameter,
  sources: SourcesParameter,
  includeDomains: IncludeDomainsParameter,
  excludeDomains: ExcludeDomainsParameter,
  tbs: TbsParameter,
  country: CountryParameter,
})
