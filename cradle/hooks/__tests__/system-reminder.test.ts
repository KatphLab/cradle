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

import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registerSystemReminderHook } from '../system-reminder.js'
import {
  createAssistantMessage,
  createPi,
  createStaleReminder,
  createTodoToolResult,
  createUserMessage,
  getBeforeAgentStartHandler,
  getContextHandler,
  getMessageUpdateHandler,
  getSessionStartHandler,
  type RegisteredHandler,
  writeCradleSettings,
} from './system-reminder-fixtures.js'

let tempRoot: string

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
        display: true,
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
    await writeCradleSettings(tempRoot, {
      reminderTokenThreshold: 500,
      displaySystemReminder: false,
    })
    const handlers: RegisteredHandler[] = []
    registerSystemReminderHook(createPi(handlers))

    const notify = vi.fn()

    // Prime cachedSettings via session_start.
    const sessionHandler = getSessionStartHandler(handlers)
    await sessionHandler({}, { cwd: tempRoot, ui: { notify } })

    const beforeHandler = getBeforeAgentStartHandler(handlers)
    const beforeResult = await beforeHandler(
      {
        systemPrompt:
          '<system-reminder>\nAlways prefer tiny changes.\n</system-reminder>',
      },
      { cwd: tempRoot, ui: { notify } },
    )
    expect(beforeResult?.message).toEqual(
      expect.objectContaining({ display: false }),
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
        display: false,
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
