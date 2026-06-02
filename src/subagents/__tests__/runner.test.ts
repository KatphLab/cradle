import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'

import type { Message } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runSingleAgent } from '../runner.js'
import {
  createAssistantMessage,
  createMockProcess,
  createToolResultMessage,
  createUsage,
  eventLine,
  makeAgent,
  makeOptions,
  temporaryPromptDirectory,
  temporaryPromptFilePath,
  waitForSpawn,
  type MockProcess,
  type OnUpdate,
} from '../runner.test-helpers.js'
import {
  getFinalOutput,
  getPiInvocation,
  writePromptToTemporaryFile,
} from '../utilities.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isChildProcess(value: unknown): value is ChildProcess {
  if (!isRecord(value)) return false
  return (
    typeof value['on'] === 'function' &&
    typeof value['kill'] === 'function' &&
    typeof value['killed'] === 'boolean'
  )
}

function findFinalOutput(
  messages: { role: string; content?: unknown[] }[],
): string {
  for (const message of messages.toReversed()) {
    if (message.role !== 'assistant') continue
    const textPart = message.content?.find(
      (value: unknown): value is { type: 'text'; text: string } =>
        typeof value === 'object' &&
        value !== null &&
        'type' in value &&
        'text' in value &&
        value.type === 'text' &&
        typeof value.text === 'string',
    )
    if (textPart) return textPart.text
  }
  return ''
}

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('node:fs', () => ({
  default: {
    unlinkSync: vi.fn(),
    rmdirSync: vi.fn(),
  },
}))

vi.mock('../utilities.js', () => {
  return {
    getFinalOutput: vi.fn(findFinalOutput),
    getPiInvocation: vi.fn((args: string[]) => ({
      command: 'pi-bin',
      args: ['run', ...args],
    })),
    writePromptToTemporaryFile: vi.fn(),
  }
})

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
      usage: {
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
      },
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
      '--no-context-files',
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
      model: 'runtime-model',
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
    expect(vi.mocked(getFinalOutput)).toHaveBeenCalled()
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
      '--no-context-files',
      'Task: do work',
    ])
    expect(spawn).toHaveBeenCalledWith(
      'pi-bin',
      [
        'run',
        '--mode',
        'json',
        '-p',
        '--no-session',
        '--no-context-files',
        'Task: do work',
      ],
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

    expect(proc.kill.mock.calls).toContainEqual(['SIGTERM'])
    vi.advanceTimersByTime(5000)
    expect(proc.kill.mock.calls).toContainEqual(['SIGKILL'])
    proc.emit('close', 143)

    await expect(promise).resolves.toMatchObject({ exitCode: 143 })
  })

  it('registers an abort listener for a running process', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const promise = runSingleAgent(makeOptions({ signal: controller.signal }))
    const proc = await waitForSpawn(spawned)

    expect(proc.kill.mock.calls).toHaveLength(0)
    controller.abort()
    expect(proc.kill.mock.calls).toContainEqual(['SIGTERM'])
    proc.killed = true
    vi.advanceTimersByTime(5000)
    expect(proc.kill.mock.calls).not.toContainEqual(['SIGKILL'])
    proc.emit('close', 130)

    await expect(promise).resolves.toMatchObject({ exitCode: 130 })
  })

  it('uses settings-based model by complexity regardless of agent model', async () => {
    const agent = makeAgent({ model: 'agent-model' })
    const promise = runSingleAgent(
      makeOptions({
        agents: [agent],
        complexity: 'low',
        settings: { subagentModels: { low: 'settings-model' } },
      }),
    )
    const proc = await waitForSpawn(spawned)

    proc.stdout.emit(
      'data',
      eventLine('message_end', createAssistantMessage('done')).trimEnd(),
    )
    proc.emit('close', 0)
    await promise

    expect(getPiInvocation).toHaveBeenCalledWith(
      expect.arrayContaining(['--model', 'settings-model']),
    )
  })

  it('uses settings-based model by complexity when agent has no model', async () => {
    const agent = makeAgent()
    const promise = runSingleAgent(
      makeOptions({
        agents: [agent],
        complexity: 'medium',
        settings: { subagentModels: { medium: 'settings-medium' } },
      }),
    )
    const proc = await waitForSpawn(spawned)

    proc.stdout.emit(
      'data',
      eventLine('message_end', createAssistantMessage('done')).trimEnd(),
    )
    proc.emit('close', 0)
    await promise

    expect(getPiInvocation).toHaveBeenCalledWith(
      expect.arrayContaining(['--model', 'settings-medium']),
    )
  })

  it('skips model flag when no model is resolved', async () => {
    const agent = makeAgent()
    const promise = runSingleAgent(
      makeOptions({
        agents: [agent],
        complexity: 'high',
        settings: { subagentModels: {} },
      }),
    )
    const proc = await waitForSpawn(spawned)

    proc.stdout.emit(
      'data',
      eventLine('message_end', createAssistantMessage('done')).trimEnd(),
    )
    proc.emit('close', 0)
    await promise

    const invocation = vi.mocked(getPiInvocation).mock.calls.at(-1)?.[0]
    expect(invocation).not.toContain('--model')
  })
})
