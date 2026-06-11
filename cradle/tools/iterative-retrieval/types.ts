import type { TextContent } from '@earendil-works/pi-ai'
import { Type } from '@earendil-works/pi-ai'

import type { DisplayItem, UsageStats } from '../../lib/subagents/types.js'

export const DEFAULT_MAX_CYCLES = 3
export const DEFAULT_MIN_RELEVANCE = 0.5
export const DEFAULT_LIMIT = 20

export interface IterativeRetrievalResultItem {
  path: string
  relevance: number
  reason: string
}

export interface IterativeRetrievalDetails {
  task: string
  cycles: number
  paths: IterativeRetrievalResultItem[]
  sources: IterativeRetrievalResultItem[]
  findings: string[]
  gaps: string[]
  suggestions: string[]
  model?: string
  usage?: UsageStats
  displayItems?: DisplayItem[]
}

export function retrievalToolError(message: string): {
  content: [TextContent]
  details: undefined
} {
  return {
    content: [{ type: 'text', text: message }],
    details: undefined,
  }
}

export const IterativeRetrievalParameters = Type.Object({
  task: Type.String({
    description:
      'The retrieval task or question. Describe what context you need gathered.',
  }),
  paths: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Directories or files to constrain local search scope. If omitted, searches the entire working directory.',
    }),
  ),
  keywords: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Hint keywords to prioritize during search. Helps the retriever focus.',
    }),
  ),
  excludes: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Domains, paths, or patterns to exclude from search results.',
    }),
  ),
  maxCycles: Type.Optional(
    Type.Number({
      description: `Maximum number of retrieval cycles. Default: ${DEFAULT_MAX_CYCLES}. Higher values gather more context but cost more.`,
      default: DEFAULT_MAX_CYCLES,
    }),
  ),
  minRelevance: Type.Optional(
    Type.Number({
      description: `Minimum relevance score (0.0-1.0) for a result to be included. Default: ${DEFAULT_MIN_RELEVANCE}.`,
      default: DEFAULT_MIN_RELEVANCE,
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: `Maximum total results (paths + sources) to return. Default: ${DEFAULT_LIMIT}.`,
      default: DEFAULT_LIMIT,
    }),
  ),
})
