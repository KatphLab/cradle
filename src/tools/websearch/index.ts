import type { TextContent } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'

import { loadGlobalSettings } from '../../config/settings.js'
import { discoverAgents } from '../../subagents/agents.js'
import {
  buildSubagentResult,
  executeToolSubagent,
} from '../../utils/subagent-tool-helpers.js'
import { createFirecrawlSearchProvider } from './providers/firecrawl.js'
import { renderWebSearchResult } from './render.js'
import {
  searchToolError,
  WebSearchInternalParameters,
  WebSearchParameters,
  type WebSearchDetails,
  type WebSearchOptions,
  type WebSearchProvider,
  type WebSearchResponse,
} from './types.js'

async function getProviders(): Promise<WebSearchProvider[]> {
  const globalSettings = await loadGlobalSettings()
  const providers: WebSearchProvider[] = []

  if (globalSettings.firecrawlApiKey) {
    providers.push(
      createFirecrawlSearchProvider(globalSettings.firecrawlApiKey),
    )
  }

  return providers
}

async function searchWithFallback(
  parameters: WebSearchOptions,
  providers: WebSearchProvider[],
  signal?: AbortSignal,
): Promise<{ response: WebSearchResponse; provider: string }> {
  let lastError: Error | undefined

  for (const provider of providers) {
    try {
      const response = await provider.search(parameters, signal)
      return { response, provider: provider.name }
    } catch (error: unknown) {
      lastError =
        error instanceof Error ? error : new Error('Unknown search error')
    }
  }

  throw new Error(`Search failed: ${lastError?.message ?? 'Unknown error'}`)
}

function buildResultText(details: WebSearchDetails): string {
  const lines = [
    `Query: ${details.query}`,
    `Provider: ${details.provider}`,
    `Results: ${String(details.resultCount)}`,
    '',
  ]

  for (const [index, item] of details.items.entries()) {
    lines.push(
      `${String(index + 1)}. ${item.title} — ${item.url}`,
      `   ${item.description}`,
    )
  }

  return lines.join('\n')
}

async function executeSearch(
  parameters: WebSearchOptions,
  providers: WebSearchProvider[],
  signal: AbortSignal | undefined,
): Promise<{ content: [TextContent]; details: WebSearchDetails }> {
  const { response, provider } = await searchWithFallback(
    parameters,
    providers,
    signal,
  )

  const details: WebSearchDetails = {
    items: response.items,
    query: parameters.query,
    provider,
    resultCount: response.items.length,
  }

  return {
    content: [{ type: 'text', text: buildResultText(details) }],
    details,
  }
}

/** @internal Raw search — only available inside subagents. */
export const webSearchInternalTool = defineTool({
  name: 'web_search_internal',
  label: 'Web Search (Internal)',
  description: [
    'Internal raw web search. Searches the web via configured providers.',
    'Returns search results with titles, descriptions, and URLs.',
  ].join(' '),
  parameters: WebSearchInternalParameters,

  async execute(_toolCallId, parameters, signal) {
    const providers = await getProviders()
    if (providers.length === 0) {
      return searchToolError(
        'No web search provider configured. Set firecrawlApiKey in global settings.',
      )
    }

    const parameters_: WebSearchOptions = {
      query: parameters.query,
      limit: parameters.limit ?? 10,
      country: parameters.country ?? 'US',
    }

    if (parameters.sources !== undefined) {
      parameters_.sources = parameters.sources
    }
    if (parameters.includeDomains !== undefined) {
      parameters_.includeDomains = parameters.includeDomains
    }
    if (parameters.excludeDomains !== undefined) {
      parameters_.excludeDomains = parameters.excludeDomains
    }
    if (parameters.tbs !== undefined) {
      parameters_.tbs = parameters.tbs
    }

    try {
      return await executeSearch(parameters_, providers, signal)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Search failed'
      return searchToolError(message)
    }
  },

  renderResult(result, { expanded }, theme) {
    return renderWebSearchResult(result, expanded, theme)
  },
})

function buildSubagentTask(parameters: {
  query: string
  limit?: number
  sources?: string[]
  includeDomains?: string[]
  excludeDomains?: string[]
  tbs?: string
  country?: string
  question?: string
}): string {
  const taskParts = [
    `Query: ${parameters.query}`,
    `limit: ${String(parameters.limit ?? 10)}`,
    `sources: ${JSON.stringify(parameters.sources ?? ['web'])}`,
  ]
  if (parameters.includeDomains) {
    taskParts.push(
      `includeDomains: ${JSON.stringify(parameters.includeDomains)}`,
    )
  }
  if (parameters.excludeDomains) {
    taskParts.push(
      `excludeDomains: ${JSON.stringify(parameters.excludeDomains)}`,
    )
  }
  if (parameters.tbs) {
    taskParts.push(`tbs: ${parameters.tbs}`)
  }
  taskParts.push(`country: ${parameters.country ?? 'US'}`)
  if (parameters.question) {
    taskParts.push(`Question: ${parameters.question}`)
  } else {
    taskParts.push('Question: Provide a concise summary of the search results.')
  }
  return taskParts.join('\n')
}

/** @public Public facade — delegates to the web-searcher subagent. */
export const webSearchTool = defineTool({
  name: 'web_search',
  label: 'Web Search',
  description: [
    'Search the web and get a concise answer or summary from the results.',
    'Returns only the answer or summary — no raw search results enter the main context.',
  ].join(' '),
  parameters: WebSearchParameters,

  async execute(_toolCallId, parameters, signal, _onUpdate, context) {
    if (!parameters.query || parameters.query.trim().length === 0) {
      return searchToolError('Query must be non-empty.')
    }

    const discovery = discoverAgents(context.cwd)
    const agent = discovery.agents.find((a) => a.name === 'web-searcher')
    if (!agent) {
      return searchToolError('web-searcher agent not found.')
    }

    const task = buildSubagentTask(parameters)

    const settings = await loadGlobalSettings()
    const result = await executeToolSubagent(
      context,
      discovery,
      'web-searcher',
      task,
      settings,
      signal,
    )

    return buildSubagentResult(result, 'Web search')
  },
})
