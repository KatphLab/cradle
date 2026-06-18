import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import type { ApprovalDetails } from '../../utils/approval-state.js'
import {
  CONTINUE_AFTER_REMINDER_PROMPT,
  DEFAULT_SYSTEM_REMINDER,
  registerSystemReminderHook,
} from '../system-reminder.js'
import {
  createAssistantMessage,
  createPi,
  createStaleReminder,
  createTodoToolResult,
  createUserMessage,
  getBeforeAgentStartHandler,
  getBeforeProviderRequestHandler,
  getContextHandler,
  getMessageUpdateHandler,
  getSessionStartHandler,
  type RegisteredHandler,
  writeCradleSettings,
} from './system-reminder-fixtures.js'

let tempRoot: string

function createApprovalToolResult(details: ApprovalDetails): AgentMessage {
  return {
    role: 'toolResult',
    toolName: 'approval',
    toolCallId: 'call_approval',
    content: [],
    isError: false,
    timestamp: Date.now(),
    details,
  }
}

function expectApprovalTags(text: string): void {
  expect(text).toContain('<yes>')
  expect(text).toContain('<approve>')
  expect(text).toContain('<proceed>')
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

  it('uses default system reminder when no user-defined reminder tags exist', async () => {
    const handlers: RegisteredHandler[] = []
    registerSystemReminderHook(createPi(handlers))

    const notify = vi.fn()
    const handler = getBeforeAgentStartHandler(handlers)
    const result = await handler(
      { systemPrompt: 'Some system prompt without reminder tags' },
      { cwd: tempRoot, ui: { notify } },
    )

    expect(notify).not.toHaveBeenCalled()
    expect(result?.systemPrompt).toBe(
      'Some system prompt without reminder tags',
    )
    expect(result?.message?.content).toContain(DEFAULT_SYSTEM_REMINDER[0])
  })

  it('removes stale reminders from context', async () => {
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

    // Context handler filters stale reminders but does not inject new ones
    expect(result?.messages).toEqual([userMessage])
  })

  it('removes stale reminders and caches todo state', async () => {
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

    // Context handler filters stale reminders but does not inject new ones
    expect(result?.messages).toEqual([userMessage])
  })

  it('caches pending approval reminder for before_provider_request', async () => {
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

    const approvalResult = createApprovalToolResult({
      action: 'proposal',
      id: 'pending-1',
      fileScopes: [
        {
          path: 'src/example.ts',
          operation: 'edit',
          intent: 'test pending reminder',
        },
      ],
      bashScopes: [],
    })
    const contextHandler = getContextHandler(handlers)
    await contextHandler({ messages: [approvalResult] }, { cwd: tempRoot })

    const providerHandler = getBeforeProviderRequestHandler(handlers)
    const payload = {
      messages: [{ role: 'user', content: 'test' }],
      model: 'test',
    }
    providerHandler({ payload })

    const reminderMessage = (payload.messages[1] ?? {}) as unknown as {
      content: { type: string; text: string }[]
    }
    const text = reminderMessage.content[0]?.text ?? ''
    expect(text).toContain('pending-1')
    expect(text).toContain('src/example.ts')
    expect(text).toMatch(/pending/i)
    expectApprovalTags(text)
  })

  it('caches todo reminder for before_provider_request', async () => {
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
    const contextHandler = getContextHandler(handlers)
    const contextResult = await contextHandler(
      { messages: [userMessage, todoResult] },
      { cwd: tempRoot },
    )

    // Context handler filters but does not inject
    expect(contextResult?.messages).toEqual([userMessage, todoResult])

    // Verify task state is cached by checking before_provider_request
    const providerHandler = getBeforeProviderRequestHandler(handlers)
    const payload = {
      messages: [{ role: 'user', content: 'test' }],
      model: 'test',
    }
    providerHandler({ payload })

    expect(payload.messages).toHaveLength(2)
    const reminderMessage = (payload.messages[1] ?? {}) as unknown as {
      role: string
      content: { type: string; text: string }[]
    }
    expect(reminderMessage.role).toBe('user')
    expect(reminderMessage.content[0]?.text ?? '').toContain(
      'Always prefer tiny changes.',
    )
    expect(reminderMessage.content[0]?.text ?? '').toContain('## Current Todos')
  })

  it('before_provider_request injects reminder into LLM payload', async () => {
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

    const providerHandler = getBeforeProviderRequestHandler(handlers)
    const payload = {
      messages: [{ role: 'user', content: 'please fix this' }],
      model: 'test',
    }
    const result = providerHandler({ payload })

    expect(result).toBe(payload)
    expect(payload.messages).toHaveLength(2)
    expect(payload.messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '[REMINDER]\nAlways prefer tiny changes.' },
      ],
    })
  })

  it('before_provider_request always injects regardless of token threshold', async () => {
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

    const providerHandler = getBeforeProviderRequestHandler(handlers)

    // First call
    const payload1 = {
      messages: [{ role: 'user', content: 'first' }],
      model: 'test',
    }
    providerHandler({ payload: payload1 })
    expect(payload1.messages).toHaveLength(2)

    // Second call with same reminder — should still inject
    const payload2 = {
      messages: [{ role: 'user', content: 'second' }],
      model: 'test',
    }
    providerHandler({ payload: payload2 })
    expect(payload2.messages).toHaveLength(2)
    expect((payload2.messages[1] as { role: string }).role).toBe('user')
  })

  it('before_provider_request returns undefined when no reminder cached', () => {
    const handlers: RegisteredHandler[] = []
    registerSystemReminderHook(createPi(handlers))

    const providerHandler = getBeforeProviderRequestHandler(handlers)
    const payload = {
      messages: [{ role: 'user', content: 'test' }],
      model: 'test',
    }
    const result = providerHandler({ payload })

    expect(result).toBeUndefined()
    expect(payload.messages).toHaveLength(1)
  })

  it('before_provider_request returns undefined when payload has no messages', async () => {
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

    const providerHandler = getBeforeProviderRequestHandler(handlers)
    const result = providerHandler({ payload: { model: 'test' } })

    expect(result).toBeUndefined()
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
    const contextResult = await contextHandler(
      { messages: [userMessage] },
      { cwd: tempRoot },
    )
    // Context handler filters but does not inject
    expect(contextResult?.messages).toEqual([userMessage])

    // before_provider_request injects the reminder
    const providerHandler = getBeforeProviderRequestHandler(handlers)
    const payload = {
      messages: [{ role: 'user', content: 'please fix this' }],
      model: 'test',
    }
    providerHandler({ payload })
    expect(payload.messages).toHaveLength(2)

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
    expect(sendUserMessage).toHaveBeenCalledWith(CONTINUE_AFTER_REMINDER_PROMPT)

    const continuedUserMessage = createUserMessage(
      CONTINUE_AFTER_REMINDER_PROMPT,
    )
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

    // Context handler filters stale reminders but keeps other messages
    expect(forcedResult?.messages).toHaveLength(3)
    expect(forcedResult?.messages?.[0]).toEqual(userMessage)
    expect(forcedResult?.messages?.[1]).toEqual(createAssistantMessage(''))
    expect(forcedResult?.messages?.[2]).toEqual(continuedUserMessage)

    // before_provider_request injects the reminder
    const forcedPayload = {
      messages: [
        { role: 'user', content: 'test' },
        { role: 'assistant', content: 'response' },
      ],
      model: 'test',
    }
    providerHandler({ payload: forcedPayload })
    expect(forcedPayload.messages).toHaveLength(3)
    expect(forcedPayload.messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '[REMINDER]\nAlways prefer tiny changes.' },
      ],
    })
  })

  it('does not abort mid-thought when running as a subagent', async () => {
    vi.stubEnv('CRADLE_SUBAGENT', '1')
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

    const abort = vi.fn()
    const updateHandler = getMessageUpdateHandler(handlers)
    await updateHandler(
      {
        message: createAssistantMessage('thinking'),
        assistantMessageEvent: {
          delta: 'x'.repeat(2000),
          type: 'thinking_delta',
        },
      },
      { abort, cwd: tempRoot, isIdle: () => false },
    )

    expect(abort).not.toHaveBeenCalled()
    expect(sendUserMessage).not.toHaveBeenCalled()
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
