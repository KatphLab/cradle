import { defineTool } from '@earendil-works/pi-coding-agent'

import { loadGlobalSettings } from '../../config/settings.js'
import { discoverAgents } from '../../lib/subagents/agents.js'
import type { SingleResult } from '../../lib/subagents/types.js'
import {
  getFinalOutput,
  isFailedResult,
} from '../../lib/subagents/utilities.js'
import {
  executeToolSubagent,
  getSubagentFailureText,
} from '../../utils/subagent-tool-helpers.js'
import { renderIterativeRetrievalResult } from './render.js'
import {
  DEFAULT_LIMIT,
  DEFAULT_MAX_CYCLES,
  DEFAULT_MIN_RELEVANCE,
  IterativeRetrievalParameters,
  retrievalToolError,
  type IterativeRetrievalDetails,
  type IterativeRetrievalResultItem,
} from './types.js'

function buildSubagentTask(parameters: {
  task: string
  paths?: string[]
  keywords?: string[]
  excludes?: string[]
  maxCycles?: number
  minRelevance?: number
  limit?: number
}): string {
  const taskParts = [`Task: ${parameters.task}`]

  if (parameters.paths !== undefined && parameters.paths.length > 0) {
    taskParts.push(`Paths: ${JSON.stringify(parameters.paths)}`)
  }
  if (parameters.keywords !== undefined && parameters.keywords.length > 0) {
    taskParts.push(`Keywords: ${JSON.stringify(parameters.keywords)}`)
  }
  if (parameters.excludes !== undefined && parameters.excludes.length > 0) {
    taskParts.push(`Excludes: ${JSON.stringify(parameters.excludes)}`)
  }
  taskParts.push(
    `maxCycles: ${String(parameters.maxCycles ?? DEFAULT_MAX_CYCLES)}`,
    `minRelevance: ${String(parameters.minRelevance ?? DEFAULT_MIN_RELEVANCE)}`,
    `limit: ${String(parameters.limit ?? DEFAULT_LIMIT)}`,
  )

  return taskParts.join('\n')
}

// ---- section extraction helpers ----

function sectionBody(text: string, header: string): string {
  const start = text.indexOf(header)
  if (start === -1) return ''

  const after = text.slice(start + header.length)
  const nextHeader = /^##\s/m
  const nextExec = nextHeader.exec(after)
  const end = nextExec ? start + header.length + nextExec.index : text.length

  return text.slice(start + header.length, end)
}

function parseRelevanceLine(
  line: string,
): IterativeRetrievalResultItem | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith('- ')) return undefined

  const content = trimmed.slice(2)
  const relevanceTag = '(relevance:'
  const relevanceIndex = content.indexOf(relevanceTag)
  if (relevanceIndex === -1) return undefined

  const path = content.slice(0, relevanceIndex).trimEnd()
  const afterTag = content.slice(relevanceIndex + relevanceTag.length)

  const parenIndex = afterTag.indexOf(')')
  if (parenIndex === -1) return undefined

  const scoreString = afterTag.slice(0, parenIndex).trim()
  const relevance = Number.parseFloat(scoreString)

  const rest = afterTag.slice(parenIndex + 1).trimStart()
  let reason = ''
  if (rest.startsWith('\u2014 reason:')) {
    reason = rest.slice(rest.indexOf(':') + 1).trim()
  } else if (rest.length > 0) {
    reason = rest.replace(/^\u2014\s*/, '').trim()
  }

  return { path, relevance, reason }
}

function parseSectionItems(
  text: string,
  sectionHeader: string,
): IterativeRetrievalResultItem[] {
  const body = sectionBody(text, sectionHeader)
  if (body.length === 0) return []

  const items: IterativeRetrievalResultItem[] = []
  for (const line of body.split('\n')) {
    const parsed = parseRelevanceLine(line)
    if (parsed) items.push(parsed)
  }
  return items
}

function parseListSection(text: string, sectionHeader: string): string[] {
  const body = sectionBody(text, sectionHeader)
  if (body.length === 0) return []

  const items: string[] = []
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('- ')) {
      items.push(trimmed.slice(2).trim())
    }
  }
  return items
}

function parseCycles(text: string): number {
  const body = sectionBody(text, '## Cycles')
  if (body.length === 0) return 0

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim()
    if (!line.startsWith('- ')) continue
    const numberString = line.slice(2).trim()
    if (/^\d+$/.test(numberString)) return Number.parseInt(numberString, 10)
  }
  return 0
}

function tryParseDetails(
  text: string,
  task: string,
): IterativeRetrievalDetails | undefined {
  if (typeof text !== 'string' || text.length === 0) return undefined

  const paths = parseSectionItems(text, '## Relevant Paths')
  const sources = parseSectionItems(text, '## Web Sources')
  if (paths.length === 0 && sources.length === 0) return undefined

  const findings = parseListSection(text, '## Key Findings')
  const gaps = parseListSection(text, '## Missing Gaps')
  const suggestions = parseListSection(text, '## Suggested Next Actions')
  const cycles = parseCycles(text)

  return { task, cycles, paths, sources, findings, gaps, suggestions }
}

function buildIterativeRetrievalResult(
  result: SingleResult,
  task: string,
): {
  content: [{ type: 'text'; text: string }]
  details: IterativeRetrievalDetails | undefined
} {
  const output = getFinalOutput(result.messages)

  if (isFailedResult(result)) {
    const errorText = `Iterative retrieval failed: ${getSubagentFailureText(result)}`
    return {
      content: [{ type: 'text', text: errorText }],
      details: undefined,
    }
  }

  const details = tryParseDetails(output, task)
  return {
    content: [{ type: 'text', text: output }],
    details,
  }
}

// ---- validation ----

function validateParameters(params: {
  task: string
  maxCycles?: number
  minRelevance?: number
  limit?: number
}): string | undefined {
  if (!params.task || params.task.trim().length === 0) {
    return 'Task must be non-empty.'
  }

  const maxCycles = params.maxCycles ?? DEFAULT_MAX_CYCLES
  const minRelevance = params.minRelevance ?? DEFAULT_MIN_RELEVANCE
  const limit = params.limit ?? DEFAULT_LIMIT

  if (maxCycles < 1) {
    return `maxCycles must be at least 1, got ${String(maxCycles)}.`
  }
  if (minRelevance < 0 || minRelevance > 1) {
    return `minRelevance must be between 0 and 1, got ${String(minRelevance)}.`
  }
  if (limit < 1) {
    return `limit must be at least 1, got ${String(limit)}.`
  }
  return undefined
}

/** @public Public facade — delegates to the iterative-retriever subagent. */
export const iterativeRetrievalTool = defineTool({
  name: 'iterative_retrieval',
  label: 'Iterative Retrieval',
  description: [
    'Perform bounded iterative retrieval across local files and the web.',
    'Refines search queries over multiple cycles to build a compact context bundle.',
    'Returns synthesized paths, relevance scores, findings, gaps, and suggested next actions.',
  ].join(' '),
  parameters: IterativeRetrievalParameters,

  async execute(_toolCallId, parameters, signal, _onUpdate, context) {
    const validationError = validateParameters(parameters)
    if (validationError) return retrievalToolError(validationError)

    const discovery = discoverAgents(context.cwd)
    const agent = discovery.agents.find((a) => a.name === 'iterative-retriever')
    if (!agent) {
      return retrievalToolError('iterative-retriever agent not found.')
    }

    const task = buildSubagentTask(parameters)

    const settings = await loadGlobalSettings()
    const result = await executeToolSubagent(
      context,
      discovery,
      'iterative-retriever',
      task,
      settings,
      signal,
    )

    return buildIterativeRetrievalResult(result, parameters.task)
  },

  renderResult(result, { expanded }, theme) {
    return renderIterativeRetrievalResult(result, expanded, theme)
  },
})
