import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import type { SingleResult, UsageStats } from '../lib/subagents/types.js'

const SUBAGENT_TOOL_NAMES = new Set([
  'subagent',
  'advisor',
  'council',
  'iterative_retrieval',
])

let pendingUsage: UsageStats | undefined

function createEmptyUsage(): UsageStats {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    contextTokens: 0,
    turns: 0,
  }
}

function addUsage(target: UsageStats, usage: UsageStats): void {
  target.input += usage.input
  target.output += usage.output
  target.cacheRead += usage.cacheRead
  target.cacheWrite += usage.cacheWrite
  target.cost += usage.cost
  target.contextTokens += usage.contextTokens
  target.turns += usage.turns
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUsageStats(value: unknown): value is UsageStats {
  if (!isRecord(value)) return false
  return (
    typeof value['input'] === 'number' &&
    typeof value['output'] === 'number' &&
    typeof value['cacheRead'] === 'number' &&
    typeof value['cacheWrite'] === 'number' &&
    typeof value['cost'] === 'number' &&
    typeof value['contextTokens'] === 'number' &&
    typeof value['turns'] === 'number'
  )
}

function isSingleResult(value: unknown): value is SingleResult {
  if (!isRecord(value)) return false
  return (
    typeof value['agent'] === 'string' &&
    typeof value['exitCode'] === 'number' &&
    isUsageStats(value['usage'])
  )
}

function aggregateResults(
  values: unknown[],
  getResult: (value: unknown) => SingleResult | undefined,
): UsageStats | undefined {
  const aggregated = createEmptyUsage()
  let found = false
  for (const value of values) {
    const result = getResult(value)
    if (!result) continue
    found = true
    addUsage(aggregated, result.usage)
  }
  return found ? aggregated : undefined
}

/**
 * Extract usage from SubagentDetails (used by subagent and advisor tools).
 * Shape: { mode, projectAgentsDir, results: SingleResult[] }
 */
function extractFromSubagentDetails(details: unknown): UsageStats | undefined {
  if (!isRecord(details)) return undefined
  const results = details['results']
  if (!Array.isArray(results)) return undefined
  return aggregateResults(results, (value) =>
    isSingleResult(value) ? value : undefined,
  )
}

/**
 * Extract usage from CouncilOutput (used by council tool).
 * Shape: { verdict, voiceResults: VoiceResult[], error }
 * where VoiceResult = { voice, output, result: SingleResult, error }
 */
function extractFromCouncilDetails(details: unknown): UsageStats | undefined {
  if (!isRecord(details)) return undefined
  const voiceResults = details['voiceResults']
  if (!Array.isArray(voiceResults)) return undefined
  return aggregateResults(voiceResults, (value) => {
    if (!isRecord(value)) return
    const result = value['result']
    return isSingleResult(result) ? result : undefined
  })
}

/**
 * Extract usage from IterativeRetrievalDetails (used by iterative_retrieval tool).
 * Shape: { task, cycles, paths, sources, ..., usage?: UsageStats }
 */
function extractFromIterativeRetrievalDetails(
  details: unknown,
): UsageStats | undefined {
  if (!isRecord(details)) return undefined
  const usage = details['usage']
  if (isUsageStats(usage)) return usage
  return undefined
}

function extractSubagentUsage(
  toolName: string,
  details: unknown,
): UsageStats | undefined {
  switch (toolName) {
    case 'subagent':
    case 'advisor': {
      return extractFromSubagentDetails(details)
    }
    case 'council': {
      return extractFromCouncilDetails(details)
    }
    case 'iterative_retrieval': {
      return extractFromIterativeRetrievalDetails(details)
    }
    default: {
      return undefined
    }
  }
}

function accumulateUsage(usage: UsageStats): void {
  pendingUsage ??= createEmptyUsage()
  addUsage(pendingUsage, usage)
}

interface AssistantLike {
  role: 'assistant'
  usage: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    totalTokens: number
    cost: { total: number }
  }
}

function isAssistantMessage(message: unknown): message is AssistantLike {
  if (!isRecord(message)) return false
  if (message['role'] !== 'assistant') return false
  const usage = message['usage']
  if (!isRecord(usage)) return false
  return (
    typeof usage['input'] === 'number' &&
    typeof usage['output'] === 'number' &&
    typeof usage['cacheRead'] === 'number' &&
    typeof usage['cacheWrite'] === 'number' &&
    typeof usage['totalTokens'] === 'number' &&
    isRecord(usage['cost']) &&
    typeof usage['cost']['total'] === 'number'
  )
}

/** @public */
export function registerSubagentUsageHook(pi: Pick<ExtensionAPI, 'on'>): void {
  pi.on('session_start', () => {
    pendingUsage = undefined
  })

  pi.on('tool_result', (event) => {
    if (!SUBAGENT_TOOL_NAMES.has(event.toolName)) return
    const usage = extractSubagentUsage(event.toolName, event.details)
    if (!usage) return
    accumulateUsage(usage)
  })

  pi.on('message_end', (event) => {
    if (!isAssistantMessage(event.message)) return
    if (!pendingUsage) return

    const sub = pendingUsage
    pendingUsage = undefined

    const { usage: originalUsage } = event.message

    return {
      message: {
        ...event.message,
        usage: {
          ...originalUsage,
          input: originalUsage.input + sub.input,
          output: originalUsage.output + sub.output,
          cacheRead: originalUsage.cacheRead + sub.cacheRead,
          cacheWrite: originalUsage.cacheWrite + sub.cacheWrite,
          totalTokens: originalUsage.totalTokens + sub.input + sub.output,
          cost: {
            ...originalUsage.cost,
            total: originalUsage.cost.total + sub.cost,
          },
        },
      },
    }
  })
}
