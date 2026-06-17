import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { withFileMutationQueue } from '@earendil-works/pi-coding-agent'

import type { Message } from '@earendil-works/pi-ai'
import type { DisplayItem, SingleResult } from './types.js'

export const MAX_PARALLEL_TASKS = 8
export const MAX_CONCURRENCY = 4
export const PER_TASK_OUTPUT_CAP = 50 * 1024

export function formatTokens(count: number): string {
  if (count < 1000) return count.toString()
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`
  return `${(count / 1_000_000).toFixed(1)}M`
}

function formatTurns(turns: number | undefined): string | undefined {
  if (turns) return `${turns} turn${turns > 1 ? 's' : ''}`
  return undefined
}

export function formatUsageStats(
  usage: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    cost: number
    contextTokens?: number
    turns?: number
  },
  model?: string,
): string {
  const parts: string[] = []
  const turnsString = formatTurns(usage.turns)
  if (turnsString) parts.push(turnsString)
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`)
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`)
  if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`)
  if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`)
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`)
  if (usage.contextTokens !== undefined && usage.contextTokens > 0) {
    parts.push(`ctx:${formatTokens(usage.contextTokens)}`)
  }
  if (model) parts.push(model)
  return parts.join(' ')
}

function shortenPath(p: string): string {
  const home = os.homedir()
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p
}

function formatBashToolCall(
  args: Record<string, unknown>,
  themeFg: (color: string, text: string) => string,
): string {
  const command = typeof args['command'] === 'string' ? args['command'] : '...'
  const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command
  return themeFg('muted', '$ ') + themeFg('toolOutput', preview)
}

function getFirstStringArgument(
  args: Record<string, unknown>,
  keys: string[],
  fallback: string,
): string {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value) return value
  }
  return fallback
}

function getNumberArgument(
  args: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = args[key]
  return typeof value === 'number' ? value : undefined
}

function formatLineRange(
  offset: number | undefined,
  limit: number | undefined,
): string {
  const startLine = offset ?? 1
  const endLine = limit === undefined ? '' : String(startLine + limit - 1)
  const lineRange = endLine ? `-${endLine}` : ''
  return `:${startLine}${lineRange}`
}

function formatReadToolCall(
  args: Record<string, unknown>,
  themeFg: (color: string, text: string) => string,
): string {
  const rawPath = getFirstStringArgument(args, ['file_path', 'path'], '...')
  const filePath = shortenPath(rawPath)
  const offset = getNumberArgument(args, 'offset')
  const limit = getNumberArgument(args, 'limit')
  let text = themeFg('accent', filePath)
  if (offset !== undefined || limit !== undefined) {
    text += themeFg('warning', formatLineRange(offset, limit))
  }
  return themeFg('muted', 'read ') + text
}

function getFilePathArgument(args: Record<string, unknown>): string {
  const filePathValue = args['file_path']
  const pathValue = args['path']
  if (typeof filePathValue === 'string' && filePathValue) {
    return filePathValue
  }
  if (typeof pathValue === 'string' && pathValue) {
    return pathValue
  }
  return '...'
}

function formatWriteToolCall(
  args: Record<string, unknown>,
  themeFg: (color: string, text: string) => string,
): string {
  const rawPath = getFilePathArgument(args)
  const filePath = shortenPath(rawPath)
  const contentValue = args['content']
  const content = typeof contentValue === 'string' ? contentValue : ''
  const lines = content.split('\n').length
  let text = themeFg('muted', 'write ') + themeFg('accent', filePath)
  if (lines > 1) text += themeFg('dim', ` (${lines} lines)`)
  return text
}

function formatEditToolCall(
  args: Record<string, unknown>,
  themeFg: (color: string, text: string) => string,
): string {
  const rawPath = getFilePathArgument(args)
  return themeFg('muted', 'edit ') + themeFg('accent', shortenPath(rawPath))
}

function formatLsToolCall(
  args: Record<string, unknown>,
  themeFg: (color: string, text: string) => string,
): string {
  const pathValue = args['path']
  const rawPath = typeof pathValue === 'string' && pathValue ? pathValue : '.'
  return themeFg('muted', 'ls ') + themeFg('accent', shortenPath(rawPath))
}

function formatFindToolCall(
  args: Record<string, unknown>,
  themeFg: (color: string, text: string) => string,
): string {
  const patternValue = args['pattern']
  const pattern =
    typeof patternValue === 'string' && patternValue ? patternValue : '*'
  const pathValue = args['path']
  const rawPath = typeof pathValue === 'string' && pathValue ? pathValue : '.'
  return (
    themeFg('muted', 'find ') +
    themeFg('accent', pattern) +
    themeFg('dim', ` in ${shortenPath(rawPath)}`)
  )
}

function formatGrepToolCall(
  args: Record<string, unknown>,
  themeFg: (color: string, text: string) => string,
): string {
  const patternValue = args['pattern']
  const pattern =
    typeof patternValue === 'string' && patternValue ? patternValue : ''
  const pathValue = args['path']
  const rawPath = typeof pathValue === 'string' && pathValue ? pathValue : '.'
  return (
    themeFg('muted', 'grep ') +
    themeFg('accent', `/${pattern}/`) +
    themeFg('dim', ` in ${shortenPath(rawPath)}`)
  )
}

function formatDefaultToolCall(
  toolName: string,
  args: Record<string, unknown>,
  themeFg: (color: string, text: string) => string,
): string {
  const argsString = JSON.stringify(args)
  const preview =
    argsString.length > 50 ? `${argsString.slice(0, 50)}...` : argsString
  return themeFg('accent', toolName) + themeFg('dim', ` ${preview}`)
}

export function formatToolCall(
  toolName: string,
  args: Record<string, unknown>,
  themeFg: (color: string, text: string) => string,
): string {
  switch (toolName) {
    case 'bash': {
      return formatBashToolCall(args, themeFg)
    }
    case 'read': {
      return formatReadToolCall(args, themeFg)
    }
    case 'write': {
      return formatWriteToolCall(args, themeFg)
    }
    case 'edit': {
      return formatEditToolCall(args, themeFg)
    }
    case 'ls': {
      return formatLsToolCall(args, themeFg)
    }
    case 'find': {
      return formatFindToolCall(args, themeFg)
    }
    case 'grep': {
      return formatGrepToolCall(args, themeFg)
    }
    default: {
      return formatDefaultToolCall(toolName, args, themeFg)
    }
  }
}

function isRecordStringUnknown(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getTextFromMessage(message: Message): string | undefined {
  if (message.role !== 'assistant') return undefined
  if (!Array.isArray(message.content)) return undefined
  for (const part of message.content) {
    const item = extractDisplayItem(part)
    if (item?.type === 'text') return item.text
  }
  return undefined
}

export function getFinalOutput(messages: Message[]): string {
  for (const message of messages.toReversed()) {
    const text = getTextFromMessage(message)
    if (text !== undefined) return text
  }
  return ''
}

export function isFailedResult(result: SingleResult): boolean {
  return (
    result.exitCode !== 0 ||
    result.stopReason === 'error' ||
    result.stopReason === 'aborted'
  )
}

function formatSessionHint(result: SingleResult): string {
  const session = result.session
  if (session === undefined) return ''
  return [
    '',
    'Subagent session:',
    `- id: ${session.id}`,
    `- cwd: ${session.cwd}`,
    `- inspect: ${session.inspectCommand}`,
    `- continue: ${session.continueHint}`,
  ].join('\n')
}

export function getResultOutput(result: SingleResult): string {
  let output = ''
  if (isFailedResult(result)) {
    output = result.errorMessage ?? result.stderr
  }
  if (!output) output = getFinalOutput(result.messages)
  const sessionHint = isFailedResult(result) ? formatSessionHint(result) : ''
  const outputText = output.length > 0 ? output : '(no output)'
  return `${outputText}${sessionHint}`
}

export function truncateParallelOutput(output: string): string {
  const byteLength = Buffer.byteLength(output, 'utf8')
  if (byteLength <= PER_TASK_OUTPUT_CAP) return output

  let truncated = output.slice(0, PER_TASK_OUTPUT_CAP)
  while (Buffer.byteLength(truncated, 'utf8') > PER_TASK_OUTPUT_CAP) {
    truncated = truncated.slice(0, -1)
  }
  const omitted = byteLength - Buffer.byteLength(truncated, 'utf8')
  return `${truncated}\n\n[Output truncated: ${omitted} bytes omitted. Full output preserved in tool details.]`
}

function extractDisplayItem(part: unknown): DisplayItem | undefined {
  if (!isRecordStringUnknown(part)) return undefined
  if (part['type'] === 'text' && typeof part['text'] === 'string') {
    return { type: 'text', text: part['text'] }
  }
  if (
    part['type'] === 'toolCall' &&
    typeof part['name'] === 'string' &&
    isRecordStringUnknown(part['arguments'])
  ) {
    return { type: 'toolCall', name: part['name'], args: part['arguments'] }
  }
  return undefined
}

export function getDisplayItems(messages: Message[]): DisplayItem[] {
  const items: DisplayItem[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    if (!Array.isArray(message.content)) continue
    for (const part of message.content) {
      const item = extractDisplayItem(part)
      if (item) items.push(item)
    }
  }
  return items
}

export async function writePromptToTemporaryFile(
  agentName: string,
  prompt: string,
): Promise<{ directory: string; filePath: string }> {
  const temporaryDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'pi-subagent-'),
  )
  const safeName = agentName.replaceAll(/[^\w.-]+/g, '_')
  const filePath = path.join(temporaryDirectory, `prompt-${safeName}.md`)
  await withFileMutationQueue(filePath, async () => {
    await fs.promises.writeFile(filePath, prompt, {
      encoding: 'utf8',
      mode: 0o600,
    })
  })
  return { directory: temporaryDirectory, filePath }
}

export function getPiInvocation(args: string[]): {
  command: string
  args: string[]
} {
  const currentScript = process.argv[1]
  const isBunVirtualScript = currentScript?.startsWith('/$bunfs/root/')
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] }
  }

  const execName = path.basename(process.execPath).toLowerCase()
  const isGenericRuntime = /^(?:node|bun)(?:\.exe)?$/.test(execName)
  if (!isGenericRuntime) {
    return { command: process.execPath, args }
  }

  return { command: 'pi', args }
}

export async function mapWithConcurrencyLimit<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  if (items.length === 0) return []
  const limit = Math.max(1, Math.min(concurrency, items.length))
  const results: TOut[] = Array.from({ length: items.length })
  let nextIndex = 0
  const workers = Array.from({ length: limit }).map(async () => {
    for (
      let current = nextIndex++;
      current < items.length;
      current = nextIndex++
    ) {
      const item = items[current]
      if (item === undefined) continue
      results[current] = await fn(item, current)
    }
  })
  await Promise.all(workers)
  return results
}
