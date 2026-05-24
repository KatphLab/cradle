import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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

type ContextHandler = (
  event: { messages: AgentMessage[] },
  context: TestContext,
) => Promise<{ messages?: AgentMessage[] } | undefined>

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

function getContextHandler(handlers: RegisteredHandler[]): ContextHandler {
  const handler = handlers[0]
  if (!handler) {
    throw new Error('Expected context handler to be registered')
  }
  expect(handler.event).toBe('context')
  if (!isContextHandler(handler.fn)) {
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

describe('registerSystemReminderHook', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-24T00:00:00.000Z'))
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'cradle-reminder-'))
  })

  afterEach(async () => {
    vi.useRealTimers()
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('adds the project system reminder and removes stale reminders', async () => {
    const handlers: RegisteredHandler[] = []
    registerSystemReminderHook(createPi(handlers))
    await writeFile(
      path.join(tempRoot, 'SYSTEM_REMINDER.md'),
      'Always prefer tiny changes.\n',
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

  it('only removes stale reminders when the project file is empty', async () => {
    const handlers: RegisteredHandler[] = []
    registerSystemReminderHook(createPi(handlers))
    await writeFile(path.join(tempRoot, 'SYSTEM_REMINDER.md'), '   \n')

    const userMessage = createUserMessage('hello')
    const staleReminder = createStaleReminder('old reminder')
    const handler = getContextHandler(handlers)
    const result = await handler(
      { messages: [staleReminder, userMessage] },
      { cwd: tempRoot },
    )

    expect(result?.messages).toEqual([userMessage])
  })

  it('only removes stale reminders when the project file is missing', async () => {
    const handlers: RegisteredHandler[] = []
    registerSystemReminderHook(createPi(handlers))

    const userMessage = createUserMessage('hello')
    const staleReminder = createStaleReminder('old reminder')
    const handler = getContextHandler(handlers)
    const result = await handler(
      { messages: [staleReminder, userMessage] },
      { cwd: tempRoot },
    )

    expect(result?.messages).toEqual([userMessage])
  })

  it('throws unexpected file read errors', async () => {
    const handlers: RegisteredHandler[] = []
    registerSystemReminderHook(createPi(handlers))
    const handler = getContextHandler(handlers)
    const invalidCwd = path.join(tempRoot, 'file')
    await writeFile(invalidCwd, 'not a directory')

    await expect(
      handler({ messages: [] }, { cwd: invalidCwd }),
    ).rejects.toThrow()
  })
})
