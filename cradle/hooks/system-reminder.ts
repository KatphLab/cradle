import type { AgentMessage } from '@earendil-works/pi-agent-core'
import {
  estimateTokens,
  type ExtensionAPI,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent'

import {
  DEFAULT_REMINDER_TOKEN_THRESHOLD,
  loadGlobalSettings,
  type GlobalSettings,
} from '../config/settings.js'
import { formatTodoReminder, reconstructTodos } from '../utils/todo-state.js'

const SYSTEM_REMINDER_TYPE = 'cradle-system-reminder'
const SYSTEM_REMINDER_TOKEN_LIMIT = 500
export const CONTINUE_AFTER_REMINDER_PROMPT =
  "You have been working for too long. Re-read and quote the user's original request before continuing. If you are stuck, unsure, or about to take an action the user did not explicitly request, ask the user or advisor first. Otherwise, continue with only the requested work."

const DEFAULT_SYSTEM_REMINDER = [
  "Before any file edit or write, quote the user's exact words that asked for that change. If you cannot quote them, stop and ask first.",
  'The todo list tracks only your private implementation plan. Do not use it to respond to system reminder, check actual user message.',
  "Before acting, separate the user's request from your plan. If an action was not explicitly requested, stop and ask first.",
  "Periodically re-read the user's original words, not just your todo list, and confirm you are still on track.",
  'If you are stuck, unsure, or about to overreach beyond the explicit request, ask the advisor or user before acting.',
].join('\n')
const REMINDER_CONTINUE_POLL_INTERVAL_MS = 25

type SystemReminderPi = Pick<ExtensionAPI, 'on' | 'sendUserMessage'>

type ContinuationContext = Pick<ExtensionContext, 'abort' | 'isIdle'>

interface SystemReminderState {
  cachedSettings: GlobalSettings
  cachedReminder: string | undefined
  streamedTokensSinceLastInjection: number
  continuationScheduled: boolean
  sessionRevision: number
  cachedTodoReminder: string | undefined
  lastTodoMessageCount: number
}

type ResettableSystemReminderState = Omit<
  SystemReminderState,
  'cachedSettings' | 'sessionRevision'
>

interface BeforeAgentStartEventLike {
  systemPrompt: string
}

interface BeforeAgentStartResultLike {
  message?: {
    customType: string
    content: string
    display: boolean
  }
  systemPrompt?: string
}

interface NotifyContextLike {
  ui: {
    notify(message: string, level: 'warning'): void
  }
}

interface MessageUpdateEventLike {
  message: AgentMessage
  assistantMessageEvent: unknown
}

/** @public */
export function registerSystemReminderHook(pi: SystemReminderPi): void {
  const state = createSystemReminderState()

  pi.on('session_start', async (_event) => {
    resetSystemReminderState(state)
    state.cachedSettings = await loadGlobalSettings()
  })

  pi.on('before_agent_start', (event, context) =>
    handleBeforeAgentStart(event, context, state),
  )

  pi.on('context', (event) => handleContext(event.messages, state))

  pi.on('before_provider_request', (event) =>
    handleBeforeProviderRequest(event, state),
  )

  pi.on('message_update', (event, context) => {
    handleMessageUpdate(event, context, pi, state)
  })
}

function createSystemReminderState(): SystemReminderState {
  return {
    cachedSettings: {},
    sessionRevision: 0,
    ...createResettableSystemReminderState(),
  }
}

function createResettableSystemReminderState(): ResettableSystemReminderState {
  return {
    cachedReminder: undefined,
    streamedTokensSinceLastInjection: 0,
    continuationScheduled: false,
    cachedTodoReminder: undefined,
    lastTodoMessageCount: 0,
  }
}

function resetSystemReminderState(state: SystemReminderState): void {
  Object.assign(state, createResettableSystemReminderState())
  state.sessionRevision++
}

function handleBeforeAgentStart(
  event: BeforeAgentStartEventLike,
  context: NotifyContextLike,
  state: SystemReminderState,
): BeforeAgentStartResultLike | undefined {
  const extracted = extractSystemReminder(event.systemPrompt)
  const display = shouldDisplaySystemReminder(state.cachedSettings)

  if (extracted) {
    const tokens = estimateTokens({
      role: 'custom',
      customType: SYSTEM_REMINDER_TYPE,
      content: extracted.reminder,
      display,
      timestamp: Date.now(),
    })
    if (tokens > SYSTEM_REMINDER_TOKEN_LIMIT) {
      context.ui.notify(
        `System reminder exceeds ${SYSTEM_REMINDER_TOKEN_LIMIT} tokens (~${tokens}). Consider shortening it.`,
        'warning',
      )
    }
    state.cachedReminder = extracted.reminder
    return {
      message: createSystemReminderDisplayMessage(
        state.cachedReminder,
        display,
      ),
      systemPrompt: extracted.systemPrompt,
    }
  }

  state.cachedReminder = DEFAULT_SYSTEM_REMINDER
  return {
    message: createSystemReminderDisplayMessage(state.cachedReminder, display),
    systemPrompt: event.systemPrompt,
  }
}

function handleContext(
  eventMessages: AgentMessage[],
  state: SystemReminderState,
): { messages: AgentMessage[] } {
  const messages = eventMessages.filter((message) => !isSystemReminder(message))

  // Cache updated task reminder for before_provider_request
  getTodoReminder(messages, state)

  return { messages }
}

function isProviderPayload(
  payload: unknown,
): payload is { messages: unknown[] } {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'messages' in payload &&
    Array.isArray(payload.messages)
  )
}

function handleBeforeProviderRequest(
  event: { payload: unknown },
  state: SystemReminderState,
): unknown {
  const payload = event.payload
  if (!isProviderPayload(payload)) {
    return undefined
  }

  const reminder = buildFullReminder(state)
  if (!reminder) {
    return undefined
  }

  payload.messages.push({
    role: 'user',
    content: [{ type: 'text', text: `[REMINDER]\n${reminder}` }],
  })

  state.streamedTokensSinceLastInjection = 0

  return payload
}

function buildFullReminder(state: SystemReminderState): string | undefined {
  const parts: string[] = []
  if (state.cachedReminder) parts.push(state.cachedReminder)
  if (state.cachedTodoReminder) parts.push(state.cachedTodoReminder)
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

function handleMessageUpdate(
  event: MessageUpdateEventLike,
  context: ContinuationContext,
  pi: Pick<SystemReminderPi, 'sendUserMessage'>,
  state: SystemReminderState,
): void {
  if (event.message.role !== 'assistant') return

  const assistantEvent = event.assistantMessageEvent
  if (!isStringDelta(assistantEvent)) return
  const deltaTokens = Math.ceil(assistantEvent.delta.length / 4)

  state.streamedTokensSinceLastInjection += deltaTokens
  if (
    state.continuationScheduled ||
    state.streamedTokensSinceLastInjection <
      getReminderTokenThreshold(state.cachedSettings)
  ) {
    return
  }

  state.continuationScheduled = true
  const revision = state.sessionRevision
  context.abort()
  scheduleContinueAfterAbort(context, revision, pi, state)
}

function scheduleContinueAfterAbort(
  context: ContinuationContext,
  revision: number,
  pi: Pick<SystemReminderPi, 'sendUserMessage'>,
  state: SystemReminderState,
): void {
  const continueWhenIdle = (): void => {
    if (revision !== state.sessionRevision) return
    if (!context.isIdle()) {
      setTimeout(continueWhenIdle, REMINDER_CONTINUE_POLL_INTERVAL_MS)
      return
    }

    state.continuationScheduled = false
    state.streamedTokensSinceLastInjection = 0
    pi.sendUserMessage(CONTINUE_AFTER_REMINDER_PROMPT)
  }

  setTimeout(continueWhenIdle, 0)
}

function extractSystemReminder(
  systemPrompt: string,
): { reminder: string; systemPrompt: string } | undefined {
  const matches: string[] = []
  const cleanedSystemPrompt = systemPrompt.replaceAll(
    /<system-reminder>([\s\S]*?)<\/system-reminder>/g,
    (_match, content) => {
      const trimmed = String(content).trim()
      if (trimmed.length > 0) {
        matches.push(trimmed)
      }
      return ''
    },
  )

  if (matches.length === 0) {
    return undefined
  }

  const reminder = matches.join('\n\n')

  return { reminder, systemPrompt: cleanedSystemPrompt }
}

function getReminderTokenThreshold(settings: GlobalSettings): number {
  return settings.reminderTokenThreshold ?? DEFAULT_REMINDER_TOKEN_THRESHOLD
}

function shouldDisplaySystemReminder(settings: GlobalSettings): boolean {
  return settings.displaySystemReminder ?? true
}

function getTodoReminder(
  messages: AgentMessage[],
  state: SystemReminderState,
): string | undefined {
  if (messages.length === state.lastTodoMessageCount) {
    return state.cachedTodoReminder
  }
  const currentTodos = reconstructTodos(messages)
  state.cachedTodoReminder = currentTodos.some(
    (todo) => todo.status !== 'completed',
  )
    ? formatTodoReminder(currentTodos)
    : undefined
  state.lastTodoMessageCount = messages.length
  return state.cachedTodoReminder
}

function createSystemReminderDisplayMessage(
  reminder: string,
  display: boolean,
): {
  customType: string
  content: string
  display: boolean
} {
  return {
    customType: SYSTEM_REMINDER_TYPE,
    content: `[REMINDER]\n${reminder}`,
    display,
  }
}

function isStringDelta(value: unknown): value is { delta: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'delta' in value &&
    typeof value.delta === 'string' &&
    value.delta.length > 0
  )
}

function isSystemReminder(message: AgentMessage): boolean {
  return 'customType' in message && message.customType === SYSTEM_REMINDER_TYPE
}
