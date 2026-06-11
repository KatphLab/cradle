import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'

import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import type { Message, Usage } from '@earendil-works/pi-ai'

import type { GlobalSettings } from '../../config/settings.js'
import type {
  AgentConfig,
  SingleResult,
  SubagentDetails,
  TaskComplexity,
  UsageStats,
} from './types.js'
import {
  getFinalOutput,
  getPiInvocation,
  writePromptToTemporaryFile,
} from './utilities.js'

type SpawnedPiProcess = ChildProcess

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void
type PiMessageEventType = 'message_end' | 'tool_result_end'

type DetailsFactory = (results: SingleResult[]) => SubagentDetails

interface PiMessageEvent {
  type: PiMessageEventType
  message: Message
}

interface TemporaryPromptState {
  directory?: string
  filePath?: string
}

interface ProcessRunOptions {
  args: string[]
  cwd: string
  emitUpdate: () => void
  result: SingleResult
  signal: AbortSignal | undefined
}

export interface RunSingleAgentOptions {
  defaultCwd: string
  agents: AgentConfig[]
  agentName: string
  task: string
  cwd: string | undefined
  step: number | undefined
  signal: AbortSignal | undefined
  onUpdate: OnUpdateCallback | undefined
  makeDetails: DetailsFactory
  complexity: TaskComplexity | undefined
  settings: GlobalSettings | undefined
}

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

function resolveModel(
  complexity: TaskComplexity | undefined,
  settings: GlobalSettings | undefined,
): string | undefined {
  if (complexity === undefined) return undefined
  return settings?.subagentModels?.[complexity]
}

function buildPiArgs(
  agent: AgentConfig,
  task: string,
  resolvedModel: string | undefined,
): string[] {
  const args: string[] = [
    '--mode',
    'json',
    '-p',
    '--no-session',
    '--no-context-files',
  ]
  if (resolvedModel) args.push('--model', resolvedModel)
  if (agent.tools && agent.tools.length > 0)
    args.push('--tools', agent.tools.join(','))
  args.push(`Task: ${task}`)
  return args
}

function createInitialResult(
  agent: AgentConfig,
  task: string,
  step: number | undefined,
  resolvedModel: string | undefined,
): SingleResult {
  const result: SingleResult = {
    agent: agent.name,
    agentSource: agent.source,
    task,
    exitCode: 0,
    messages: [],
    stderr: '',
    usage: createEmptyUsage(),
  }
  if (resolvedModel !== undefined) {
    result.model = resolvedModel
  }
  if (step !== undefined) {
    result.step = step
  }
  return result
}

function createUnknownAgentResult(
  agents: AgentConfig[],
  agentName: string,
  task: string,
  step: number | undefined,
): SingleResult {
  const available =
    agents.length > 0
      ? agents.map((agent) => `"${agent.name}"`).join(', ')
      : 'none'
  const result: SingleResult = {
    agent: agentName,
    agentSource: 'unknown',
    task,
    exitCode: 1,
    messages: [],
    stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
    usage: createEmptyUsage(),
  }
  if (step !== undefined) {
    result.step = step
  }
  return result
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value instanceof Object &&
    !Array.isArray(value)
  )
}

function hasNumberProperty(
  value: Record<string, unknown>,
  property: string,
): boolean {
  return typeof value[property] === 'number'
}

function hasStringProperty(
  value: Record<string, unknown>,
  property: string,
): boolean {
  return typeof value[property] === 'string'
}

function hasBooleanProperty(
  value: Record<string, unknown>,
  property: string,
): boolean {
  return typeof value[property] === 'boolean'
}

function hasOptionalStringProperty(
  value: Record<string, unknown>,
  property: string,
): boolean {
  const propertyValue = value[property]
  return propertyValue === undefined || typeof propertyValue === 'string'
}

function isUsageCost(value: unknown): value is Usage['cost'] {
  return (
    isJsonObject(value) &&
    hasNumberProperty(value, 'input') &&
    hasNumberProperty(value, 'output') &&
    hasNumberProperty(value, 'cacheRead') &&
    hasNumberProperty(value, 'cacheWrite') &&
    hasNumberProperty(value, 'total')
  )
}

function isUsage(value: unknown): value is Usage {
  if (!isJsonObject(value)) return false

  return (
    hasNumberProperty(value, 'input') &&
    hasNumberProperty(value, 'output') &&
    hasNumberProperty(value, 'cacheRead') &&
    hasNumberProperty(value, 'cacheWrite') &&
    hasNumberProperty(value, 'totalTokens') &&
    isUsageCost(value['cost'])
  )
}

function isUserMessage(value: Record<string, unknown>): boolean {
  const content = value['content']
  return (
    value['role'] === 'user' &&
    (typeof content === 'string' || Array.isArray(content)) &&
    hasNumberProperty(value, 'timestamp')
  )
}

function isAssistantMessage(value: Record<string, unknown>): boolean {
  return (
    value['role'] === 'assistant' &&
    Array.isArray(value['content']) &&
    hasStringProperty(value, 'api') &&
    hasStringProperty(value, 'provider') &&
    hasStringProperty(value, 'model') &&
    isUsage(value['usage']) &&
    hasStringProperty(value, 'stopReason') &&
    hasOptionalStringProperty(value, 'errorMessage') &&
    hasNumberProperty(value, 'timestamp')
  )
}

function isToolResultMessage(value: Record<string, unknown>): boolean {
  return (
    value['role'] === 'toolResult' &&
    hasStringProperty(value, 'toolCallId') &&
    hasStringProperty(value, 'toolName') &&
    Array.isArray(value['content']) &&
    hasBooleanProperty(value, 'isError') &&
    hasNumberProperty(value, 'timestamp')
  )
}

function isMessage(value: unknown): value is Message {
  if (!isJsonObject(value)) return false

  return (
    isUserMessage(value) ||
    isAssistantMessage(value) ||
    isToolResultMessage(value)
  )
}

function parseJsonObjectLine(
  line: string,
): Record<string, unknown> | undefined {
  if (line.trim().length === 0) return undefined

  try {
    const parsed: unknown = JSON.parse(line)
    return isJsonObject(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function parsePiMessageEvent(line: string): PiMessageEvent | undefined {
  const event = parseJsonObjectLine(line)
  if (event === undefined) return undefined

  const type = event['type']
  const message = event['message']
  if (type !== 'message_end' && type !== 'tool_result_end') return undefined
  if (!isMessage(message)) return undefined

  return { type, message }
}

function applyUsage(result: SingleResult, usage: Usage): void {
  result.usage.input += usage.input
  result.usage.output += usage.output
  result.usage.cacheRead += usage.cacheRead
  result.usage.cacheWrite += usage.cacheWrite
  result.usage.cost += usage.cost.total
  result.usage.contextTokens = usage.totalTokens
}

function applyAssistantMetadata(result: SingleResult, message: Message): void {
  if (message.role !== 'assistant') return

  if (result.model === undefined || result.model.length === 0) {
    result.model = message.model
  }
  result.stopReason = message.stopReason
  if (message.errorMessage !== undefined && message.errorMessage.length > 0) {
    result.errorMessage = message.errorMessage
  }
}

function updateAssistantResult(result: SingleResult, message: Message): void {
  if (message.role !== 'assistant') return

  result.usage.turns += 1
  applyUsage(result, message.usage)
  applyAssistantMetadata(result, message)
}

function processStdoutLine(
  line: string,
  result: SingleResult,
  emitUpdate: () => void,
): void {
  const event = parsePiMessageEvent(line)
  if (event === undefined) return

  result.messages.push(event.message)
  if (event.type === 'message_end') {
    updateAssistantResult(result, event.message)
  }
  emitUpdate()
}

function setupAbortHandler(
  proc: SpawnedPiProcess,
  signal: AbortSignal | undefined,
): void {
  if (signal === undefined) return

  const killProc = () => {
    proc.kill('SIGTERM')
    setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL')
    }, 5000)
  }
  if (signal.aborted) killProc()
  else signal.addEventListener('abort', killProc, { once: true })
}

function setupProcessEventHandlers(
  proc: SpawnedPiProcess,
  result: SingleResult,
  emitUpdate: () => void,
  resolve: (code: number) => void,
  signal: AbortSignal | undefined,
): void {
  let buffer = ''

  if (proc.stdout) {
    proc.stdout.on('data', (data: unknown) => {
      buffer += String(data)
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) processStdoutLine(line, result, emitUpdate)
    })
  }

  if (proc.stderr) {
    proc.stderr.on('data', (data: unknown) => {
      result.stderr += String(data)
    })
  }

  proc.on('close', (code) => {
    if (buffer.trim()) processStdoutLine(buffer, result, emitUpdate)
    resolve(code ?? 0)
  })

  proc.on('error', () => {
    resolve(1)
  })

  setupAbortHandler(proc, signal)
}

function cleanupTemporaryFiles(
  temporaryPromptPath: string | undefined,
  temporaryPromptDirectory: string | undefined,
): void {
  if (temporaryPromptPath) {
    try {
      fs.unlinkSync(temporaryPromptPath)
    } catch {
      // ignore
    }
  }
  if (temporaryPromptDirectory) {
    try {
      fs.rmdirSync(temporaryPromptDirectory)
    } catch {
      // ignore
    }
  }
}

async function appendSystemPromptFile(
  agent: AgentConfig,
  args: string[],
): Promise<TemporaryPromptState> {
  if (agent.systemPrompt.trim().length === 0) return {}

  const temporary = await writePromptToTemporaryFile(
    agent.name,
    agent.systemPrompt,
  )
  args.push('--append-system-prompt', temporary.filePath)
  return {
    directory: temporary.directory,
    filePath: temporary.filePath,
  }
}

function getRunningOutput(result: SingleResult): string {
  const output = getFinalOutput(result.messages)
  return output.length > 0 ? output : '(running...)'
}

function createUpdateEmitter(
  currentResult: SingleResult,
  onUpdate: OnUpdateCallback | undefined,
  makeDetails: DetailsFactory,
): () => void {
  return () => {
    if (onUpdate === undefined) return

    onUpdate({
      content: [
        {
          type: 'text',
          text: getRunningOutput(currentResult),
        },
      ],
      details: makeDetails([currentResult]),
    })
  }
}

function runAgentProcess(options: ProcessRunOptions): Promise<number> {
  return new Promise<number>((resolve) => {
    const invocation = getPiInvocation(options.args)
    const proc = spawn(invocation.command, invocation.args, {
      cwd: options.cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CRADLE_SUBAGENT: '1' },
    })

    setupProcessEventHandlers(
      proc,
      options.result,
      options.emitUpdate,
      resolve,
      options.signal,
    )
  })
}

export async function runSingleAgent(
  options: RunSingleAgentOptions,
): Promise<SingleResult> {
  const agent = options.agents.find((item) => item.name === options.agentName)

  if (agent === undefined) {
    return createUnknownAgentResult(
      options.agents,
      options.agentName,
      options.task,
      options.step,
    )
  }

  const resolvedModel = resolveModel(options.complexity, options.settings)
  const args = buildPiArgs(agent, options.task, resolvedModel)
  const currentResult = createInitialResult(
    agent,
    options.task,
    options.step,
    resolvedModel,
  )
  const emitUpdate = createUpdateEmitter(
    currentResult,
    options.onUpdate,
    options.makeDetails,
  )
  let temporaryPrompt: TemporaryPromptState = {}

  try {
    temporaryPrompt = await appendSystemPromptFile(agent, args)
    const exitCode = await runAgentProcess({
      args,
      cwd: options.cwd ?? options.defaultCwd,
      emitUpdate,
      result: currentResult,
      signal: options.signal,
    })

    currentResult.exitCode = exitCode
    return currentResult
  } finally {
    cleanupTemporaryFiles(temporaryPrompt.filePath, temporaryPrompt.directory)
  }
}
