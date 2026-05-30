import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registerSystemReminderHook } from './system-reminder.js'

interface RegisteredHandler {
  event: string
  fn: unknown
}

interface TestContext {
  cwd: string
}

interface TestSessionContext extends TestContext {
  ui: {
    notify: (message: string, level: string) => void
  }
}

interface TestBeforeAgentStartEvent {
  systemPrompt: string
}

type ContextHandler = (
  event: { messages: AgentMessage[] },
  context: TestContext,
) => Promise<{ messages?: AgentMessage[] } | undefined>

type SessionStartHandler = (
  event: unknown,
  context: TestSessionContext,
) => unknown

type BeforeAgentStartHandler = (
  event: TestBeforeAgentStartEvent,
  context: TestSessionContext,
) => Promise<{ systemPrompt?: string } | undefined>

let tempRoot: string

function createPi(handlers: RegisteredHandler[]): Pick<ExtensionAPI, 'on'> {
  return {
    on: (event, handler) => {
      handlers.push({ event, fn: handler })
    },
  }
}

function isContextHandler(value: unknown): value is ContextHandler {
  return typeof value === 'function'
}

function isSessionStartHandler(value: unknown): value is SessionStartHandler {
  return typeof value === 'function'
}

function isBeforeAgentStartHandler(
  value: unknown,
): value is BeforeAgentStartHandler {
  return typeof value === 'function'
}

function getContextHandler(handlers: RegisteredHandler[]): ContextHandler {
  const handler = handlers.find((entry) => entry.event === 'context')
  if (!handler) {
    throw new Error('Expected context handler to be registered')
  }
  if (!isContextHandler(handler.fn)) {
    throw new TypeError('Expected registered handler to be callable')
  }
  return handler.fn
}

function getSessionStartHandler(
  handlers: RegisteredHandler[],
): SessionStartHandler {
  const handler = handlers.find((entry) => entry.event === 'session_start')
  if (!handler) {
    throw new Error('Expected session_start handler to be registered')
  }
  if (!isSessionStartHandler(handler.fn)) {
    throw new TypeError('Expected registered handler to be callable')
  }
  return handler.fn
}

function getBeforeAgentStartHandler(
  handlers: RegisteredHandler[],
): BeforeAgentStartHandler {
  const handler = handlers.find((entry) => entry.event === 'before_agent_start')
  if (!handler) {
    throw new Error('Expected before_agent_start handler to be registered')
  }
  if (!isBeforeAgentStartHandler(handler.fn)) {
    throw new TypeError('Expected registered handler to be callable')
  }
  return handler.fn
}

function createUserMessage(content: string): AgentMessage {
  return {
    role: 'user',
    content,
    timestamp: Date.now(),
  }
}

function createStaleReminder(content: string): AgentMessage {
  return {
    role: 'custom',
    customType: 'cradle-system-reminder',
    content,
    display: false,
    timestamp: Date.now(),
  }
}

function createTodoToolResult(text: string): AgentMessage {
  return {
    role: 'toolResult',
    toolName: 'todo',
    toolCallId: 'call_1',
    content: [{ type: 'text', text }],
    isError: false,
    timestamp: Date.now(),
  }
}

async function writeCradleSettings(
  cwd: string,
  settings: Record<string, unknown>,
): Promise<void> {
  const configDirectory = path.join(cwd, '.pi', 'cradle')
  await mkdir(configDirectory, { recursive: true })
  await writeFile(
    path.join(configDirectory, 'settings.json'),
    JSON.stringify(settings, undefined, 2),
  )
}

describe('registerSystemReminderHook', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-24T00:00:00.000Z'))
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'cradle-reminder-'))
    await writeCradleSettings(tempRoot, { reminderInterval: 1 })
  })

  afterEach(async () => {
    vi.useRealTimers()
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('warns on before_agent_start when the system reminder exceeds 500 tokens', async () => {
    const handlers: RegisteredHandler[] = []
    registerSystemReminderHook(createPi(handlers))

    const notify = vi.fn()
    const handler = getBeforeAgentStartHandler(handlers)
    const reminder = 'a'.repeat(2001)
    const result = await handler(
      {
        systemPrompt: `<system-reminder>\n${reminder}\n</system-reminder>`,
      },
      { cwd: tempRoot, ui: { notify } },
    )

    expect(notify).toHaveBeenCalledWith(
      'System reminder exceeds 500 tokens (~501). Consider shortening it.',
      'warning',
    )
    expect(result?.systemPrompt).toBe('')
  })

  it('does not warn on before_agent_start when the system reminder is within 500 tokens', async () => {
    const handlers: RegisteredHandler[] = []
    registerSystemReminderHook(createPi(handlers))

    const notify = vi.fn()
    const handler = getBeforeAgentStartHandler(handlers)
    const result = await handler(
      {
        systemPrompt: `<system-reminder>\n${'a'.repeat(2000)}\n</system-reminder>`,
      },
      { cwd: tempRoot, ui: { notify } },
    )

    expect(notify).not.toHaveBeenCalled()
    expect(result?.systemPrompt).toBe('')
  })

  it('does not warn on before_agent_start when the system reminder is missing', async () => {
    const handlers: RegisteredHandler[] = []
    registerSystemReminderHook(createPi(handlers))

    const notify = vi.fn()
    const handler = getBeforeAgentStartHandler(handlers)
    const result = await handler(
      { systemPrompt: 'Some system prompt without reminder tags' },
      { cwd: tempRoot, ui: { notify } },
    )

    expect(notify).not.toHaveBeenCalled()
    expect(result).toBeUndefined()
  })

  it('adds the system reminder and removes stale reminders', async () => {
    const handlers: RegisteredHandler[] = []
    registerSystemReminderHook(createPi(handlers))

    const notify = vi.fn()
    const beforeHandler = getBeforeAgentStartHandler(handlers)
    await beforeHandler(
      {
        systemPrompt:
          '<system-reminder>\nAlways prefer tiny changes.\n</system-reminder>',
      },
      { cwd: tempRoot, ui: { notify } },
    )

    const userMessage = createUserMessage('please fix this')
    const staleReminder = createStaleReminder('old reminder')
    const handler = getContextHandler(handlers)
    const result = await handler(
      { messages: [userMessage, staleReminder] },
      { cwd: tempRoot },
    )

    expect(result?.messages).toEqual([
      userMessage,
      {
        role: 'custom',
        customType: 'cradle-system-reminder',
        content:
          '<system-reminder>\nAlways prefer tiny changes.\n</system-reminder>',
        display: false,
        timestamp: Date.now(),
      },
    ])
  })

  it('only removes stale reminders when the system reminder is empty', async () => {
    const handlers: RegisteredHandler[] = []
    registerSystemReminderHook(createPi(handlers))

    const notify = vi.fn()
    const beforeHandler = getBeforeAgentStartHandler(handlers)
    await beforeHandler(
      { systemPrompt: 'Some system prompt without reminder tags' },
      { cwd: tempRoot, ui: { notify } },
    )

    const userMessage = createUserMessage('hello')
    const staleReminder = createStaleReminder('old reminder')
    const handler = getContextHandler(handlers)
    const result = await handler(
      { messages: [staleReminder, userMessage] },
      { cwd: tempRoot },
    )

    expect(result?.messages).toEqual([userMessage])
  })

  it('adds active todo reminder alongside system reminder', async () => {
    const handlers: RegisteredHandler[] = []
    registerSystemReminderHook(createPi(handlers))

    const notify = vi.fn()

    // Prime cachedSettings via session_start so interval=1 from settings file is loaded
    const sessionHandler = getSessionStartHandler(handlers)
    await sessionHandler({}, { cwd: tempRoot, ui: { notify } })

    const beforeHandler = getBeforeAgentStartHandler(handlers)
    await beforeHandler(
      {
        systemPrompt:
          '<system-reminder>\nAlways prefer tiny changes.\n</system-reminder>',
      },
      { cwd: tempRoot, ui: { notify } },
    )

    const userMessage = createUserMessage('please fix this')
    const todoResult = createTodoToolResult('1. [in_progress] Fix bug')
    const handler = getContextHandler(handlers)
    const result = await handler(
      { messages: [userMessage, todoResult] },
      { cwd: tempRoot },
    )

    expect(result?.messages).toEqual([
      userMessage,
      todoResult,
      {
        role: 'custom',
        customType: 'cradle-system-reminder',
        content:
          '<system-reminder>\nAlways prefer tiny changes.\n\n## Current Todos\n1. [in_progress] Fix bug\n</system-reminder>',
        display: false,
        timestamp: Date.now(),
      },
    ])
  })

  it('skips injection when counter is below interval on non-user turns', async () => {
    await writeCradleSettings(tempRoot, { reminderInterval: 3 })

    const handlers: RegisteredHandler[] = []
    registerSystemReminderHook(createPi(handlers))

    const notify = vi.fn()
    const beforeHandler = getBeforeAgentStartHandler(handlers)
    await beforeHandler(
      {
        systemPrompt:
          '<system-reminder>\nAlways prefer tiny changes.\n</system-reminder>',
      },
      { cwd: tempRoot, ui: { notify } },
    )

    const userMessage = createUserMessage('please fix this')
    const todoResult = createTodoToolResult('1. [in_progress] Fix bug')
    const handler = getContextHandler(handlers)

    // First non-user turn after session start: counter=1, skip
    const result1 = await handler(
      { messages: [userMessage, todoResult] },
      { cwd: tempRoot },
    )
    expect(result1?.messages).toEqual([userMessage, todoResult])

    // Second non-user turn: counter=2, skip
    const toolResult2 = createTodoToolResult('1. [in_progress] Fix bug')
    const result2 = await handler(
      { messages: [userMessage, todoResult, toolResult2] },
      { cwd: tempRoot },
    )
    expect(result2?.messages).toEqual([userMessage, todoResult, toolResult2])

    // Third non-user turn: counter=3, inject
    const toolResult3 = createTodoToolResult('1. [in_progress] Fix bug')
    const result3 = await handler(
      {
        messages: [userMessage, todoResult, toolResult2, toolResult3],
      },
      { cwd: tempRoot },
    )
    expect(result3?.messages).toHaveLength(5)
    const lastMessage = result3?.messages?.at(-1)
    expect(lastMessage?.role).toBe('custom')
  })

  it('always injects on user turns regardless of counter', async () => {
    await writeCradleSettings(tempRoot, { reminderInterval: 5 })

    const handlers: RegisteredHandler[] = []
    registerSystemReminderHook(createPi(handlers))

    const notify = vi.fn()
    const beforeHandler = getBeforeAgentStartHandler(handlers)
    await beforeHandler(
      {
        systemPrompt:
          '<system-reminder>\nAlways prefer tiny changes.\n</system-reminder>',
      },
      { cwd: tempRoot, ui: { notify } },
    )

    const userMessage = createUserMessage('hello')
    const handler = getContextHandler(handlers)

    // First user turn: always injects
    const result = await handler({ messages: [userMessage] }, { cwd: tempRoot })

    expect(result?.messages).toHaveLength(2)
    expect(result?.messages?.at(-1)?.role).toBe('custom')
  })

  it('strips system reminder tags from the system prompt', async () => {
    const handlers: RegisteredHandler[] = []
    registerSystemReminderHook(createPi(handlers))

    const notify = vi.fn()
    const handler = getBeforeAgentStartHandler(handlers)
    const result = await handler(
      {
        systemPrompt:
          'Base prompt.\n\n<system-reminder>\nAlways prefer tiny changes.\n</system-reminder>\n\nMore instructions.',
      },
      { cwd: tempRoot, ui: { notify } },
    )

    expect(result?.systemPrompt).toBe('Base prompt.\n\n\n\nMore instructions.')
  })
})
