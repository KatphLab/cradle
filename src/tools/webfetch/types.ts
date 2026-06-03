import type { TextContent } from '@earendil-works/pi-ai'
import { Type } from '@earendil-works/pi-ai'

export interface WebFetchDetails {
  items: WebFetchItem[]
  mode: 'single' | 'chain'
}

interface WebFetchItem {
  url: string
  provider: string
  status: number
  contentType: string
  size: number
  artifactPath: string
  metadataPath: string
  cacheStatus: 'hit' | 'refresh' | 'error'
  urlHash: string
}

export interface FetchResult {
  content: string
  contentType: string
  status: number
}

export interface WebFetchProvider {
  name: string
  fetch(url: string, signal?: AbortSignal): Promise<FetchResult>
}

export interface CacheMetadata {
  url: string
  normalizedUrl: string
  provider: string
  status: number
  contentType: string
  size: number
  fetchedAt: number
  artifactPath: string
  metadataPath: string
  urlHash: string
}

export function toolError(message: string): {
  content: [TextContent]
  details: undefined
} {
  return {
    content: [{ type: 'text', text: message }],
    details: undefined,
  }
}

export const ChainItem = Type.Object(
  {
    url: Type.String({ description: 'The URL to fetch (http:// or https://)' }),
  },
  { additionalProperties: false },
)
