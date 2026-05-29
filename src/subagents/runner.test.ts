import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import type {
  AssistantMessage,
  Message,
  ToolResultMessage,
  Usage,
} from '@earendil-works/pi-ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runSingleAgent } from './runner.js'
import type { AgentConfig, SingleResult, SubagentDetails } from './types.js'
import {
  getFinalOutput,
  getPiInvocation,
  writePromptToTemporaryFile,
} from './utilities.js'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('node:fs', () => ({
  default: {
    unlinkSync: vi.fn(),
    rmdirSync: vi.fn(),
  },
}))

function isTextPart(value: unknown): value is { type: 'text'; text: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'text' in value &&
    value.type === 'text' &&
    typeof value.text === 'string'
  )
}

const temporaryPromptDirectory = path.join(
  tmpdir(),
  `pi-subagent-${randomUUID()}`,
)
const temporaryPromptFilePath = path.join(
  temporaryPromptDirectory,
  'prompt-writer.md',
)

function findFinalOutput(messages: { role: string; content?: unknown[] }[]) {
  for (const message of messages.toReversed()) {
    if (message.role !== 'assistant') continue
    const textPart = message.content?.find(isTextPart)
    if (textPart) return textPart.text
  }
  return ''
}

vi.mock('./utilities.js', () => {
  return {
    getFinalOutput: vi.fn(findFinalOutput),
    getPiInvocation: vi.fn((args: string[]) => ({
      command: 'pi-bin',
      args: ['run', ...args],
    })),
    writePromptToTemporaryFile: vi.fn(),
  }
})

type MockEventHandler = (...args: unknown[]) => void

type OnUpdate = (partial: AgentToolResult<SubagentDetails>) => void

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

type MockProcess = MockEventSource & {
  killed: boolean
  kill: ReturnType<typeof vi.fn<(signal?: NodeJS.Signals | number) => boolean>>
  stderr: MockEventSource
  stdout: MockEventSource
}

function createMockProcess(): MockProcess {
  return Object.assign(new MockEventSource(), {
    killed: false,
    kill: vi.fn(() => true),
    stderr: new MockEventSource(),
    stdout: new MockEventSource(),
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isChildProcess(value: unknown): value is ChildProcess {
  if (!isRecord(value)) return false

  return (
    typeof value['on'] === 'function' &&
    typeof value['kill'] === 'function' &&
    typeof value['killed'] === 'boolean' &&
    value['stderr'] instanceof MockEventSource &&
    value['stdout'] instanceof MockEventSource
  )
}

function createUsage(overrides: Partial<Usage> = {}): Usage {
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

function createAssistantMessage(
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

function createToolResultMessage(
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

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
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

function makeOptions(
  overrides: {
    agents?: AgentConfig[]
    agentName?: string
    cwd?: string
    defaultCwd?: string
    makeDetails?: (results: SingleResult[]) => SubagentDetails
    onUpdate?: OnUpdate
    signal?: AbortSignal
    step?: number
    task?: string
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
        agentScope: 'user',
        mode: 'single',
        projectAgentsDir: undefined,
        results,
      })),
    onUpdate: overrides.onUpdate,
    signal: overrides.signal,
    step: overrides.step,
    task: overrides.task ?? 'do work',
  }
}

function eventLine(type: 'message_end' | 'tool_result_end', message: Message) {
  return `${JSON.stringify({ message, type })}\n`
}

async function waitForSpawn(spawned: MockProcess[]): Promise<MockProcess> {
  for (let attempts = 0; attempts < 10; attempts += 1) {
    const proc = spawned.at(-1)
    if (proc) return proc
    await Promise.resolve()
  }
  throw new Error('Process was not spawned')
}

describe('runSingleAgent', () => {
  let spawned: MockProcess[]

  beforeEach(() => {
    spawned = []
    vi.clearAllMocks()
    vi.mocked(writePromptToTemporaryFile).mockResolvedValue({
      directory: temporaryPromptDirectory,
      filePath: temporaryPromptFilePath,
    })
    vi.mocked(spawn).mockImplementation(() => {
      const proc = createMockProcess()
      spawned.push(proc)
      if (!isChildProcess(proc)) {
        throw new TypeError('Mock process does not satisfy ChildProcess')
      }
      return proc
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns an unknown-agent failure with available agents and no process spawn', async () => {
    const result = await runSingleAgent(
      makeOptions({
        agentName: 'missing',
        agents: [makeAgent({ name: 'writer' }), makeAgent({ name: 'critic' })],
        step: 3,
        task: 'draft',
      }),
    )

    expect(result).toMatchObject({
      agent: 'missing',
      agentSource: 'unknown',
      exitCode: 1,
      stderr: 'Unknown agent: "missing". Available agents: "writer", "critic".',
      step: 3,
      task: 'draft',
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        contextTokens: 0,
        cost: 0,
        input: 0,
        output: 0,
        turns: 0,
      },
    })
    expect(result.messages).toEqual([])
    expect(spawn).not.toHaveBeenCalled()
  })

  it('reports none when an unknown agent is requested with no discovered agents', async () => {
    const result = await runSingleAgent(
      makeOptions({ agentName: 'missing', agents: [] }),
    )

    expect(result.stderr).toBe(
      'Unknown agent: "missing". Available agents: none.',
    )
    expect(result).not.toHaveProperty('step')
  })

  it('spawns pi with model, tools, system prompt file, streams messages, emits updates, and cleans up', async () => {
    const onUpdate = vi.fn<OnUpdate>()
    const agent = makeAgent({
      model: 'claude-sonnet',
      tools: ['read', 'write'],
    })
    const promise = runSingleAgent(
      makeOptions({
        agents: [agent],
        cwd: '/worktree',
        onUpdate,
        step: 2,
        task: 'implement feature',
      }),
    )
    const proc = await waitForSpawn(spawned)
    const userMessage: Message = {
      content: 'hello',
      role: 'user',
      timestamp: 10,
    }
    const toolMessage = createToolResultMessage()
    const assistantMessage = createAssistantMessage('done', {
      errorMessage: '',
      model: 'runtime-model',
      stopReason: 'stop',
      timestamp: 11,
      usage: createUsage({
        cacheRead: 3,
        cacheWrite: 4,
        cost: {
          cacheRead: 0.03,
          cacheWrite: 0.04,
          input: 0.01,
          output: 0.02,
          total: 0.1,
        },
        input: 100,
        output: 25,
        totalTokens: 125,
      }),
    })
    const assistantLine = eventLine('message_end', assistantMessage)

    proc.stdout.emit(
      'data',
      [
        '',
        'not json',
        '[]',
        JSON.stringify({ message: assistantMessage, type: 'ignored' }),
        JSON.stringify({
          message: { role: 'assistant', content: [] },
          type: 'message_end',
        }),
        eventLine('message_end', userMessage).trimEnd(),
        eventLine('tool_result_end', toolMessage).trimEnd(),
        assistantLine.slice(0, 12),
      ].join('\n'),
    )
    proc.stdout.emit('data', assistantLine.slice(12))
    proc.stderr.emit('data', 'warning')
    proc.stderr.emit('data', Buffer.from(' details'))
    proc.emit('close', 7)

    const result = await promise
    const expectedArgs = [
      '--mode',
      'json',
      '-p',
      '--no-session',
      '--model',
      'claude-sonnet',
      '--tools',
      'read,write',
      'Task: implement feature',
      '--append-system-prompt',
      temporaryPromptFilePath,
    ]

    expect(writePromptToTemporaryFile).toHaveBeenCalledWith(
      'writer',
      'Be helpful.',
    )
    expect(getPiInvocation).toHaveBeenCalledWith(expectedArgs)
    expect(spawn).toHaveBeenCalledWith('pi-bin', ['run', ...expectedArgs], {
      cwd: '/worktree',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    expect(result).toMatchObject({
      agent: 'writer',
      agentSource: 'user',
      exitCode: 7,
      model: 'claude-sonnet',
      stderr: 'warning details',
      step: 2,
      stopReason: 'stop',
      task: 'implement feature',
      usage: {
        cacheRead: 3,
        cacheWrite: 4,
        contextTokens: 125,
        cost: 0.1,
        input: 100,
        output: 25,
        turns: 1,
      },
    })
    expect(result).not.toHaveProperty('errorMessage')
    expect(result.messages).toEqual([
      userMessage,
      toolMessage,
      assistantMessage,
    ])
    expect(onUpdate).toHaveBeenCalledTimes(3)
    expect(onUpdate.mock.calls[0]?.[0].content).toEqual([
      { type: 'text', text: '(running...)' },
    ])
    expect(onUpdate.mock.calls.at(-1)?.[0].content).toEqual([
      { type: 'text', text: 'done' },
    ])
    expect(onUpdate.mock.calls.at(-1)?.[0].details.results).toHaveLength(1)
    expect(getFinalOutput).toHaveBeenCalled()
    expect(fs.unlinkSync).toHaveBeenCalledWith(temporaryPromptFilePath)
    expect(fs.rmdirSync).toHaveBeenCalledWith(temporaryPromptDirectory)
  })

  it('uses default cwd, skips blank system prompts, records assistant model and error metadata, and resolves null close codes to zero', async () => {
    const promise = runSingleAgent(
      makeOptions({
        agents: [
          makeAgent({
            source: 'project',
            systemPrompt: '   ',
            tools: [],
          }),
        ],
        onUpdate: vi.fn(),
      }),
    )
    const proc = await waitForSpawn(spawned)
    const assistantMessage = createAssistantMessage('failed output', {
      errorMessage: 'model failed',
      model: 'runtime-model',
      stopReason: 'error',
      usage: createUsage({ input: 1, output: 2, totalTokens: 3 }),
    })

    proc.stdout.emit(
      'data',
      eventLine('message_end', assistantMessage).trimEnd(),
    )
    proc.emit('close', null)

    const result = await promise

    expect(writePromptToTemporaryFile).not.toHaveBeenCalled()
    expect(getPiInvocation).toHaveBeenCalledWith([
      '--mode',
      'json',
      '-p',
      '--no-session',
      'Task: do work',
    ])
    expect(spawn).toHaveBeenCalledWith(
      'pi-bin',
      ['run', '--mode', 'json', '-p', '--no-session', 'Task: do work'],
      expect.objectContaining({ cwd: '/repo' }),
    )
    expect(result).toMatchObject({
      agentSource: 'project',
      errorMessage: 'model failed',
      exitCode: 0,
      model: 'runtime-model',
      stopReason: 'error',
      usage: expect.objectContaining({
        contextTokens: 3,
        input: 1,
        output: 2,
        turns: 1,
      }),
    })
    expect(fs.unlinkSync).not.toHaveBeenCalled()
    expect(fs.rmdirSync).not.toHaveBeenCalled()
  })

  it('resolves process errors as exit code one and ignores cleanup failures', async () => {
    vi.mocked(fs.unlinkSync).mockImplementation(() => {
      throw new Error('unlink failed')
    })
    vi.mocked(fs.rmdirSync).mockImplementation(() => {
      throw new Error('rmdir failed')
    })
    const promise = runSingleAgent(makeOptions())
    const proc = await waitForSpawn(spawned)

    proc.emit('error', new Error('spawn failed'))

    await expect(promise).resolves.toMatchObject({ exitCode: 1 })
    expect(fs.unlinkSync).toHaveBeenCalledWith(temporaryPromptFilePath)
    expect(fs.rmdirSync).toHaveBeenCalledWith(temporaryPromptDirectory)
  })

  it('terminates a process when an already-aborted signal is provided', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    controller.abort()
    const promise = runSingleAgent(makeOptions({ signal: controller.signal }))
    const proc = await waitForSpawn(spawned)

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM')
    vi.advanceTimersByTime(5000)
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL')
    proc.emit('close', 143)

    await expect(promise).resolves.toMatchObject({ exitCode: 143 })
  })

  it('registers an abort listener for a running process', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const promise = runSingleAgent(makeOptions({ signal: controller.signal }))
    const proc = await waitForSpawn(spawned)

    expect(proc.kill).not.toHaveBeenCalled()
    controller.abort()
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM')
    proc.killed = true
    vi.advanceTimersByTime(5000)
    expect(proc.kill).not.toHaveBeenCalledWith('SIGKILL')
    proc.emit('close', 130)

    await expect(promise).resolves.toMatchObject({ exitCode: 130 })
  })
})
