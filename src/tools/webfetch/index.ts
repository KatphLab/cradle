import type { TextContent } from '@earendil-works/pi-ai'
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'

import { loadGlobalSettings } from '../../config/settings.js'
import { createFirecrawlProvider } from './providers/firecrawl.js'
import { nativeProvider } from './providers/native.js'
import { renderWebFetchResult } from './render.js'
import {
  ChainItem,
  toolError,
  type FetchResult,
  type WebFetchDetails,
  type WebFetchProvider,
} from './types.js'
import {
  createTemporaryDirectory,
  validateUrl,
  writeFetchResult,
} from './utilities.js'

const MAX_CHAIN_LENGTH = 10

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

async function processUrl(
  url: string,
  tempDirectory: string,
  index: number,
  providers: WebFetchProvider[],
  signal: AbortSignal | undefined,
): Promise<WebFetchDetails['items'][number]> {
  const { result, provider } = await fetchWithFallback(url, providers, signal)

  const filePath = await writeFetchResult(
    tempDirectory,
    index,
    url,
    result.content,
  )

  return {
    url,
    provider,
    filePath,
    status: result.status,
    contentType: result.contentType,
    size: result.content.length,
  }
}

function buildSingleResult(item: WebFetchDetails['items'][number]): {
  content: [TextContent]
  details: WebFetchDetails
} {
  return {
    content: [
      {
        type: 'text',
        text: `Fetched ${item.url} via ${item.provider}. Saved to: ${item.filePath}`,
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
  const lines = items.map(
    (item) => `[${item.provider}] ${item.url} → ${item.filePath}`,
  )
  return {
    content: [
      {
        type: 'text',
        text: `Fetched ${String(items.length)} URLs. Saved to:\n${lines.join('\n')}`,
      },
    ],
    details: {
      items,
      mode: 'chain',
    },
  }
}

const WebFetchParameters = Type.Object({
  url: Type.Optional(
    Type.String({ description: 'The URL to fetch (http:// or https://)' }),
  ),
  chain: Type.Optional(
    Type.Array(ChainItem, {
      description:
        'Array of {url} for sequential fetching. Use {previous} in the URL to reference the previous result file path.',
    }),
  ),
})

/** @public */
export const webFetchTool = defineTool({
  name: 'web_fetch',
  label: 'Web Fetch',
  description: [
    'Fetch content from a URL. Returns HTML as markdown via Firecrawl (if API key configured) or native fetch.',
    'Supports single URL or chain mode for sequential fetching.',
  ].join(' '),
  parameters: WebFetchParameters,

  async execute(_toolCallId, parameters, signal) {
    const providers = await getProviders()

    // Chain mode
    if (parameters.chain && parameters.chain.length > 0) {
      if (parameters.chain.length > MAX_CHAIN_LENGTH) {
        return toolError(
          `Chain too long: ${String(parameters.chain.length)} items exceeds max of ${String(MAX_CHAIN_LENGTH)}`,
        )
      }

      const tempDirectory = await createTemporaryDirectory()
      const items: WebFetchDetails['items'] = []

      let previousPath = ''

      for (const [index, step] of parameters.chain.entries()) {
        const url = step.url.replaceAll('{previous}', previousPath)
        const urlError = validateUrl(url)
        if (urlError) {
          return toolError(`Step ${String(index + 1)}: ${urlError}`)
        }

        const item = await processUrl(
          url,
          tempDirectory,
          index + 1,
          providers,
          signal,
        )
        items.push(item)
        previousPath = item.filePath
      }

      return buildChainResults(items)
    }

    // Single URL mode
    if (parameters.url) {
      const urlError = validateUrl(parameters.url)
      if (urlError) {
        return toolError(urlError)
      }

      const tempDirectory = await createTemporaryDirectory()
      const item = await processUrl(
        parameters.url,
        tempDirectory,
        1,
        providers,
        signal,
      )

      return buildSingleResult(item)
    }

    return toolError('Provide either url or chain parameters.')
  },

  renderResult(result, { expanded }, theme) {
    return renderWebFetchResult(result, expanded, theme)
  },
})
