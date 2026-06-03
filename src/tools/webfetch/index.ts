import type { TextContent } from '@earendil-works/pi-ai'
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'

import { loadGlobalSettings } from '../../config/settings.js'
import { discoverAgents } from '../../subagents/agents.js'
import {
  buildSubagentResult,
  executeToolSubagent,
} from '../../utils/subagent-tool-helpers.js'
import { createFirecrawlProvider } from './providers/firecrawl.js'
import { nativeProvider } from './providers/native.js'
import { renderWebFetchResult } from './render.js'
import {
  ChainItem,
  toolError,
  type CacheMetadata,
  type FetchResult,
  type WebFetchDetails,
  type WebFetchProvider,
} from './types.js'
import { readFromCache, validateUrl, writeToCache } from './utilities.js'

const MAX_CHAIN_LENGTH = 10
const DEFAULT_MAX_AGE_SECONDS = 86_400

const UrlParameter = Type.String({
  description: 'The URL to fetch (http:// or https://)',
})
const RefreshParameter = Type.Optional(
  Type.Boolean({
    description:
      'Force refetch even if a cached artifact exists. Default: false.',
    default: false,
  }),
)
const MaxAgeSecondsParameter = Type.Optional(
  Type.Number({
    description:
      'Maximum age in seconds for a cached artifact to be reused. Default: 86400 (24 hours).',
    default: DEFAULT_MAX_AGE_SECONDS,
  }),
)

async function getProviders(): Promise<WebFetchProvider[]> {
  const globalSettings = await loadGlobalSettings()
  const providers: WebFetchProvider[] = []

  if (globalSettings.firecrawlApiKey) {
    providers.push(createFirecrawlProvider(globalSettings.firecrawlApiKey))
  }

  providers.push(nativeProvider)
  return providers
}

async function fetchWithFallback(
  url: string,
  providers: WebFetchProvider[],
  signal?: AbortSignal,
): Promise<{ result: FetchResult; provider: string }> {
  let lastError: Error | undefined

  for (const provider of providers) {
    try {
      const result = await provider.fetch(url, signal)
      return { result, provider: provider.name }
    } catch (error: unknown) {
      lastError =
        error instanceof Error ? error : new Error('Unknown fetch error')
    }
  }

  throw new Error(
    `Failed to fetch ${url}: ${lastError?.message ?? 'Unknown error'}`,
  )
}

function buildItem(
  metadata: CacheMetadata,
  provider: string,
  cacheStatus: 'hit' | 'refresh',
): WebFetchDetails['items'][number] {
  return {
    url: metadata.url,
    provider,
    status: metadata.status,
    contentType: metadata.contentType,
    size: metadata.size,
    artifactPath: metadata.artifactPath,
    metadataPath: metadata.metadataPath,
    cacheStatus,
    urlHash: metadata.urlHash,
  }
}

function buildErrorItem(url: string): WebFetchDetails['items'][number] {
  return {
    url,
    provider: 'none',
    status: 0,
    contentType: '',
    size: 0,
    artifactPath: '',
    metadataPath: '',
    cacheStatus: 'error',
    urlHash: '',
  }
}

async function processUrl(
  url: string,
  providers: WebFetchProvider[],
  signal: AbortSignal | undefined,
  refresh: boolean,
  maxAgeSeconds: number,
): Promise<WebFetchDetails['items'][number]> {
  if (!refresh) {
    const cached = await readFromCache(url, maxAgeSeconds)
    if (cached !== undefined) {
      return buildItem(cached.metadata, cached.metadata.provider, 'hit')
    }
  }

  try {
    const { result, provider } = await fetchWithFallback(url, providers, signal)

    const metadata = await writeToCache(
      url,
      provider,
      result.status,
      result.contentType,
      result.content,
    )

    return buildItem(metadata, provider, 'refresh')
  } catch {
    return buildErrorItem(url)
  }
}

function buildResultText(items: WebFetchDetails['items']): string {
  return items
    .map((item) => {
      const cacheLabel = item.cacheStatus === 'hit' ? ' (cached)' : ''
      if (item.cacheStatus === 'error') {
        return `${item.url} → fetch failed`
      }
      return `${item.url} → ${item.artifactPath} [${item.provider}${cacheLabel}]`
    })
    .join('\n')
}

function buildSingleResult(item: WebFetchDetails['items'][number]): {
  content: [TextContent]
  details: WebFetchDetails
} {
  return {
    content: [
      {
        type: 'text',
        text: buildResultText([item]),
      },
    ],
    details: {
      items: [item],
      mode: 'single',
    },
  }
}

function buildChainResults(items: WebFetchDetails['items']): {
  content: [TextContent]
  details: WebFetchDetails
} {
  return {
    content: [
      {
        type: 'text',
        text: buildResultText(items),
      },
    ],
    details: {
      items,
      mode: 'chain',
    },
  }
}

const SingleMode = Type.Object(
  {
    url: UrlParameter,
    refresh: RefreshParameter,
    maxAgeSeconds: MaxAgeSecondsParameter,
  },
  { additionalProperties: false },
)

const ChainMode = Type.Object(
  {
    chain: Type.Array(ChainItem, {
      description:
        'Array of {url} for sequential fetching. Use {previous} in the URL to reference the previous result artifact path.',
    }),
    refresh: RefreshParameter,
    maxAgeSeconds: MaxAgeSecondsParameter,
  },
  { additionalProperties: false },
)

const WebFetchInternalParameters = Type.Union([SingleMode, ChainMode])

type ExecuteResult =
  | { content: [TextContent]; details: WebFetchDetails }
  | { content: [TextContent]; details: undefined }

async function executeChain(
  chain: { url: string }[],
  providers: WebFetchProvider[],
  signal: AbortSignal | undefined,
  refresh: boolean,
  maxAgeSeconds: number,
): Promise<ExecuteResult> {
  if (chain.length > MAX_CHAIN_LENGTH) {
    return toolError(
      `Chain too long: ${String(chain.length)} items exceeds max of ${String(MAX_CHAIN_LENGTH)}`,
    )
  }

  const items: WebFetchDetails['items'] = []
  let previousPath = ''

  for (const [index, step] of chain.entries()) {
    const url = step.url.replaceAll('{previous}', previousPath)
    const urlError = validateUrl(url)
    if (urlError) {
      return toolError(`Step ${String(index + 1)}: ${urlError}`)
    }

    const item = await processUrl(
      url,
      providers,
      signal,
      refresh,
      maxAgeSeconds,
    )
    items.push(item)

    if (item.cacheStatus === 'error') {
      return {
        content: [
          {
            type: 'text',
            text: `Step ${String(index + 1)}: Failed to fetch ${url}`,
          },
        ],
        details: { items, mode: 'chain' },
      }
    }

    previousPath = item.artifactPath
  }

  return buildChainResults(items)
}

async function executeSingle(
  url: string,
  providers: WebFetchProvider[],
  signal: AbortSignal | undefined,
  refresh: boolean,
  maxAgeSeconds: number,
): Promise<ExecuteResult> {
  const urlError = validateUrl(url)
  if (urlError) {
    return toolError(urlError)
  }

  const item = await processUrl(url, providers, signal, refresh, maxAgeSeconds)
  return buildSingleResult(item)
}

/** @internal Raw fetcher — only available inside subagents. */
export const webFetchInternalTool = defineTool({
  name: 'web_fetch_internal',
  label: 'Web Fetch (Internal)',
  description: [
    'Internal raw web fetcher. Fetches content from a URL and caches to durable artifacts.',
    'Supports single URL or chain mode for sequential fetching.',
    'Use refresh:true to force a refetch. Use maxAgeSeconds to control cache staleness.',
  ].join(' '),
  parameters: WebFetchInternalParameters,

  async execute(_toolCallId, parameters, signal) {
    const providers = await getProviders()
    const refresh = parameters.refresh ?? false
    const maxAgeSeconds = parameters.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS

    if ('chain' in parameters) {
      return executeChain(
        parameters.chain,
        providers,
        signal,
        refresh,
        maxAgeSeconds,
      )
    }

    // 'url' in parameters — SingleMode guaranteed by Type.Union
    return executeSingle(
      parameters.url,
      providers,
      signal,
      refresh,
      maxAgeSeconds,
    )
  },

  renderResult(result, { expanded }, theme) {
    return renderWebFetchResult(result, expanded, theme)
  },
})

const WebFetchParameters = Type.Object({
  url: UrlParameter,
  question: Type.Optional(
    Type.String({
      description:
        'Question to answer from the page content, or instructions for summarization. If omitted, a brief summary is returned.',
    }),
  ),
  refresh: RefreshParameter,
  maxAgeSeconds: MaxAgeSecondsParameter,
})

/** @public Public facade — delegates to the web-fetcher subagent. */
export const webFetchTool = defineTool({
  name: 'web_fetch',
  label: 'Web Fetch',
  description: [
    'Fetch a web page and get a concise summary or answer a question about it.',
    'Returns only the answer or summary — no raw page content enters the main context.',
    'Use refresh:true to force a refetch. Use maxAgeSeconds to control cache staleness.',
  ].join(' '),
  parameters: WebFetchParameters,

  async execute(_toolCallId, parameters, signal, _onUpdate, context) {
    const urlError = validateUrl(parameters.url)
    if (urlError) return toolError(urlError)

    const discovery = discoverAgents(context.cwd)
    const agent = discovery.agents.find((a) => a.name === 'web-fetcher')
    if (!agent) {
      return toolError('web-fetcher agent not found.')
    }

    const refresh = parameters.refresh ?? false
    const maxAgeSeconds = parameters.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS

    const taskParts = [
      `URL: ${parameters.url}`,
      `refresh: ${String(refresh)}`,
      `maxAgeSeconds: ${String(maxAgeSeconds)}`,
    ]
    if (parameters.question) {
      taskParts.push(`Question: ${parameters.question}`)
    } else {
      taskParts.push('Question: Provide a brief summary of this page.')
    }
    const task = taskParts.join('\n')

    const settings = await loadGlobalSettings()
    const result = await executeToolSubagent(
      context,
      discovery,
      'web-fetcher',
      task,
      settings,
      signal,
    )

    return buildSubagentResult(result, 'Web fetch')
  },
})
