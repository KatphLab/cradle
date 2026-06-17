import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import type {
  AssistantMessage,
  Message,
  ToolResultMessage,
  Usage,
} from '@earendil-works/pi-ai'
import type { AgentConfig, SingleResult, SubagentDetails } from './types.js'

export function isTextPart(
  value: unknown,
): value is { type: 'text'; text: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'text' in value &&
    value.type === 'text' &&
    typeof value.text === 'string'
  )
}

export const temporaryPromptDirectory = path.join(
  tmpdir(),
  `pi-subagent-${randomUUID()}`,
)
export const temporaryPromptFilePath = path.join(
  temporaryPromptDirectory,
  'prompt-writer.md',
)

export function findFinalOutput(
  messages: { role: string; content?: unknown[] }[],
) {
  for (const message of messages.toReversed()) {
    if (message.role !== 'assistant') continue
    const textPart = message.content?.find(isTextPart)
    if (textPart) return textPart.text
  }
  return ''
}

type MockEventHandler = (...args: unknown[]) => void

export type OnUpdate = (partial: AgentToolResult<SubagentDetails>) => void

class MockEventSource {
  readonly #handlers = new Map<string, MockEventHandler[]>()

  emit(eventName: string, ...args: unknown[]): boolean {
    const handlers = this.#handlers.get(eventName) ?? []
    for (const handler of handlers) handler(...args)
    return handlers.length > 0
  }

  on(eventName: string, handler: MockEventHandler): this {
    const handlers = this.#handlers.get(eventName) ?? []
    handlers.push(handler)
    this.#handlers.set(eventName, handlers)
    return this
  }
}

interface MockKillFn {
  (signal?: NodeJS.Signals | number): boolean
  mock: { calls: [NodeJS.Signals | number | undefined][] }
}

export type MockProcess = MockEventSource & {
  killed: boolean
  kill: MockKillFn
  stderr: MockEventSource
  stdout: MockEventSource
}

function createMockKillFn(): MockKillFn {
  const calls: [NodeJS.Signals | number | undefined][] = []
  return Object.assign(
    (signal?: NodeJS.Signals | number): boolean => {
      calls.push([signal])
      return true
    },
    { mock: { calls } },
  )
}

export function createMockProcess(): MockProcess {
  return Object.assign(new MockEventSource(), {
    killed: false,
    kill: createMockKillFn(),
    stderr: new MockEventSource(),
    stdout: new MockEventSource(),
  })
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function createUsage(overrides: Partial<Usage> = {}): Usage {
  const cost = overrides.cost ?? {
    cacheRead: 0,
    cacheWrite: 0,
    input: 0,
    output: 0,
    total: 0,
  }
  return {
    cacheRead: 0,
    cacheWrite: 0,
    cost,
    input: 0,
    output: 0,
    totalTokens: 0,
    ...overrides,
  }
}

export function createAssistantMessage(
  text: string,
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    api: 'test-api',
    content: [{ type: 'text', text }],
    model: 'runtime-model',
    provider: 'test-provider',
    role: 'assistant',
    stopReason: 'stop',
    timestamp: 1,
    usage: createUsage(),
    ...overrides,
  }
}

export function createToolResultMessage(
  overrides: Partial<ToolResultMessage> = {},
): ToolResultMessage {
  return {
    content: [{ type: 'text', text: 'tool output' }],
    isError: false,
    role: 'toolResult',
    timestamp: 2,
    toolCallId: 'call-1',
    toolName: 'read',
    ...overrides,
  }
}

export function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  const name = overrides.name ?? 'writer'
  return {
    description: `${name} agent`,
    filePath: `/agents/${name}.md`,
    name,
    source: 'user',
    systemPrompt: 'Be helpful.',
    ...overrides,
  }
}

export function makeOptions(
  overrides: {
    agents?: AgentConfig[]
    agentName?: string
    cwd?: string
    defaultCwd?: string
    sessionId?: string
    makeDetails?: (results: SingleResult[]) => SubagentDetails
    onUpdate?: OnUpdate
    signal?: AbortSignal
    step?: number
    task?: string
    complexity?: 'low' | 'medium' | 'high'
    settings?: {
      subagentModels?: { low?: string; medium?: string; high?: string }
    }
  } = {},
) {
  const agents = overrides.agents ?? [makeAgent()]
  return {
    agentName: overrides.agentName ?? 'writer',
    agents,
    cwd: overrides.cwd,
    defaultCwd: overrides.defaultCwd ?? '/repo',
    makeDetails:
      overrides.makeDetails ??
      ((results: SingleResult[]): SubagentDetails => ({
        mode: 'single',
        projectAgentsDir: undefined,
        results,
      })),
    onUpdate: overrides.onUpdate,
    signal: overrides.signal,
    step: overrides.step,
    task: overrides.task ?? 'do work',
    complexity: overrides.complexity,
    sessionId: overrides.sessionId,
    settings: overrides.settings,
  }
}

export function eventLine(
  type: 'message_end' | 'tool_result_end',
  message: Message,
) {
  return `${JSON.stringify({ message, type })}
`
}

export async function waitForSpawn(
  spawned: MockProcess[],
): Promise<MockProcess> {
  for (let attempts = 0; attempts < 10; attempts += 1) {
    const proc = spawned.at(-1)
    if (proc) return proc
    await Promise.resolve()
  }
  throw new Error('Process was not spawned')
}
