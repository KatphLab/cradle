// Isolate global settings to a temp directory to avoid cross-file pollution.
import path from 'node:path'
import { vi } from 'vitest'

vi.mock('node:os', async () => {
  const actual = await vi.importActual('node:os')
  const home = path.join(
    ((actual as Record<string, unknown>)['tmpdir'] as () => string)(),
    'pi-system-reminder-global-test-home',
  )
  return { ...actual, homedir: () => home }
})

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'

import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registerSystemReminderHook } from '../system-reminder.js'

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

interface TestMessageUpdateContext extends TestContext {
  abort: () => void
  isIdle: () => boolean
}

interface TestMessageUpdateEvent {
  message: AgentMessage
  assistantMessageEvent: {
    delta: string
    type: string
  }
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

type MessageUpdateHandler = (
  event: TestMessageUpdateEvent,
  context: TestMessageUpdateContext,
) => unknown

let tempRoot: string

function createPi(
  handlers: RegisteredHandler[],
  sendUserMessage: ExtensionAPI['sendUserMessage'] = vi.fn(),
): Pick<ExtensionAPI, 'on' | 'sendUserMessage'> {
  return {
    on: (event, handler) => {
      handlers.push({ event, fn: handler })
    },
    sendUserMessage,
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

function isMessageUpdateHandler(value: unknown): value is MessageUpdateHandler {
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

function getMessageUpdateHandler(
  handlers: RegisteredHandler[],
): MessageUpdateHandler {
  const handler = handlers.find((entry) => entry.event === 'message_update')
  if (!handler) {
    throw new Error('Expected message_update handler to be registered')
  }
  if (!isMessageUpdateHandler(handler.fn)) {
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

function createAssistantMessage(content: string): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'thinking', thinking: content }],
    api: 'test-api',
    provider: 'test-provider',
    model: 'test-model',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: 'stop',
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
  _cwd: string,
  settings: Record<string, unknown>,
): Promise<void> {
  const configDirectory = path.join(homedir(), '.pi', 'cradle')
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
    tempRoot = await mkdtemp(path.join(tmpdir(), 'cradle-reminder-'))
    await writeCradleSettings(tempRoot, { reminderTokenThreshold: 500 })
  })

  afterEach(async () => {
    vi.useRealTimers()
    await rm(tempRoot, { recursive: true, force: true })
    // Clean up global settings file
    try {
      await rm(path.join(homedir(), '.pi', 'cradle', 'settings.json'), {
        force: true,
      })
    } catch {
      // ignore
    }
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
      expect.objectContaining({
        role: 'custom',
        customType: 'cradle-system-reminder',
        content:
          '<system-reminder>\nAlways prefer tiny changes.\n</system-reminder>',
        timestamp: Date.now(),
      }),
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

    // Prime cachedSettings via session_start.
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
      expect.objectContaining({
        role: 'custom',
        customType: 'cradle-system-reminder',
        content:
          '<system-reminder>\nAlways prefer tiny changes.\n\n## Current Todos\n1. [in_progress] Fix bug\n</system-reminder>',
        timestamp: Date.now(),
      }),
    ])
  })

  it('skips unchanged reminders until token threshold is reached', async () => {
    await writeCradleSettings(tempRoot, { reminderTokenThreshold: 500 })

    const handlers: RegisteredHandler[] = []
    registerSystemReminderHook(createPi(handlers))

    const notify = vi.fn()
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
    const handler = getContextHandler(handlers)

    const firstResult = await handler(
      { messages: [userMessage] },
      { cwd: tempRoot },
    )
    expect(firstResult?.messages).toHaveLength(2)
    const firstReminder = firstResult?.messages?.at(-1)
    if (firstReminder === undefined) {
      throw new Error('Expected first reminder to be injected')
    }

    const smallMessage = createUserMessage('ok')
    const secondResult = await handler(
      { messages: [userMessage, firstReminder, smallMessage] },
      { cwd: tempRoot },
    )
    expect(secondResult?.messages).toEqual([userMessage, smallMessage])

    const largeMessage = createUserMessage('x'.repeat(2400))
    const thirdResult = await handler(
      { messages: [userMessage, firstReminder, smallMessage, largeMessage] },
      { cwd: tempRoot },
    )
    expect(thirdResult?.messages).toHaveLength(4)
    expect(thirdResult?.messages?.at(-1)?.role).toBe('custom')
  })

  it('injects when the reminder payload changes below the token threshold', async () => {
    await writeCradleSettings(tempRoot, { reminderTokenThreshold: 50_000 })

    const handlers: RegisteredHandler[] = []
    registerSystemReminderHook(createPi(handlers))

    const notify = vi.fn()
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

    const userMessage = createUserMessage('hello')
    const handler = getContextHandler(handlers)

    const firstResult = await handler(
      { messages: [userMessage] },
      { cwd: tempRoot },
    )
    const firstReminder = firstResult?.messages?.at(-1)
    if (firstReminder === undefined) {
      throw new Error('Expected first reminder to be injected')
    }

    const todoResult = createTodoToolResult('1. [in_progress] Fix bug')
    const result = await handler(
      { messages: [userMessage, firstReminder, todoResult] },
      { cwd: tempRoot },
    )

    expect(result?.messages).toHaveLength(3)
    const lastMessage = result?.messages?.at(-1)
    expect(lastMessage?.role).toBe('custom')
    if (lastMessage === undefined || !('content' in lastMessage)) {
      throw new Error('Expected system reminder message')
    }
    expect(lastMessage.content).toContain('## Current Todos')
  })

  it('aborts mid-thought and asks the agent to continue when streamed tokens cross the threshold', async () => {
    await writeCradleSettings(tempRoot, { reminderTokenThreshold: 500 })

    const handlers: RegisteredHandler[] = []
    const sendUserMessage = vi.fn<ExtensionAPI['sendUserMessage']>()
    registerSystemReminderHook(createPi(handlers, sendUserMessage))

    const notify = vi.fn()
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
    const contextHandler = getContextHandler(handlers)
    const firstResult = await contextHandler(
      { messages: [userMessage] },
      { cwd: tempRoot },
    )
    expect(firstResult?.messages?.at(-1)?.role).toBe('custom')

    let idle = false
    const abort = vi.fn(() => {
      idle = true
    })
    const updateHandler = getMessageUpdateHandler(handlers)
    await updateHandler(
      {
        message: createAssistantMessage('thinking'),
        assistantMessageEvent: {
          delta: 'x'.repeat(2000),
          type: 'thinking_delta',
        },
      },
      { abort, cwd: tempRoot, isIdle: () => idle },
    )

    expect(abort).toHaveBeenCalledOnce()
    await vi.runOnlyPendingTimersAsync()
    expect(sendUserMessage).toHaveBeenCalledWith('Continue.')

    const continuedUserMessage = createUserMessage('Continue.')
    const forcedResult = await contextHandler(
      {
        messages: [
          userMessage,
          createAssistantMessage(''),
          continuedUserMessage,
        ],
      },
      { cwd: tempRoot },
    )

    expect(forcedResult?.messages?.at(-1)).toEqual(
      expect.objectContaining({
        role: 'custom',
        customType: 'cradle-system-reminder',
        content:
          '<system-reminder>\nAlways prefer tiny changes.\n</system-reminder>',
        timestamp: Date.now(),
      }),
    )
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
