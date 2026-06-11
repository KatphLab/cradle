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
  'You have been working for too long. If you are stuck with a thought or problem, ask the advisor. Otherwise, continue.'

const DEFAULT_SYSTEM_REMINDER = [
  'Always use the todo tool to break tasks into concrete steps and track progress.',
  'Periodically review what the user originally asked and confirm you are still on track.',
  'If you are stuck or unsure, ask the advisor for help.',
].join('\n')
const REMINDER_CONTINUE_POLL_INTERVAL_MS = 25

type SystemReminderPi = Pick<ExtensionAPI, 'on' | 'sendUserMessage'>

type ContinuationContext = Pick<ExtensionContext, 'abort' | 'isIdle'>

interface SystemReminderState {
  cachedSettings: GlobalSettings
  cachedReminder: string | undefined
  lastInjectedPayload: string | undefined
  lastInjectedNonReminderTokens: number
  cachedPayload: string | undefined
  streamedTokensSinceLastInjection: number
  forcedNextPayload: string | undefined
  continuationScheduled: boolean
  sessionRevision: number
  cachedTotalTokens: number
  lastMessageCount: number
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
    lastInjectedPayload: undefined,
    lastInjectedNonReminderTokens: 0,
    cachedPayload: undefined,
    streamedTokensSinceLastInjection: 0,
    forcedNextPayload: undefined,
    continuationScheduled: false,
    cachedTotalTokens: 0,
    lastMessageCount: 0,
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
  const currentNonReminderTokens = getNonReminderTokens(messages, state)

  const forcedPayload = state.forcedNextPayload
  const payload = forcedPayload ?? buildReminderPayload(messages, state)
  state.cachedPayload = payload
  if (payload === undefined) {
    state.lastInjectedPayload = undefined
    state.lastInjectedNonReminderTokens = currentNonReminderTokens
    state.streamedTokensSinceLastInjection = 0
    return { messages }
  }

  if (!shouldInjectReminder(payload, currentNonReminderTokens, state)) {
    return { messages }
  }

  if (forcedPayload !== undefined) state.forcedNextPayload = undefined
  state.lastInjectedPayload = payload
  state.lastInjectedNonReminderTokens = currentNonReminderTokens
  state.streamedTokensSinceLastInjection = 0

  return {
    messages: [...messages, createSystemReminderMessage(payload)],
  }
}

function shouldInjectReminder(
  payload: string,
  currentNonReminderTokens: number,
  state: SystemReminderState,
): boolean {
  if (state.forcedNextPayload !== undefined) return true

  const tokenDistance =
    currentNonReminderTokens - state.lastInjectedNonReminderTokens
  const payloadChanged = payload !== state.lastInjectedPayload
  const contextAppearsTruncated = tokenDistance < 0
  const thresholdReached =
    tokenDistance >= getReminderTokenThreshold(state.cachedSettings)

  return payloadChanged || contextAppearsTruncated || thresholdReached
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
      getReminderTokenThreshold(state.cachedSettings) ||
    state.cachedPayload === undefined
  ) {
    return
  }

  state.forcedNextPayload = state.cachedPayload
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
    if (state.forcedNextPayload === undefined) {
      state.continuationScheduled = false
      return
    }
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

function buildReminderPayload(
  messages: AgentMessage[],
  state: SystemReminderState,
): string | undefined {
  const parts: string[] = []
  if (state.cachedReminder) parts.push(state.cachedReminder)

  const todoReminder = getTodoReminder(messages, state)
  if (todoReminder) parts.push(todoReminder)

  return parts.length > 0 ? parts.join('\n\n') : undefined
}

function getNonReminderTokens(
  messages: AgentMessage[],
  state: SystemReminderState,
): number {
  if (messages.length === state.lastMessageCount) {
    return state.cachedTotalTokens
  }

  const canAppend = messages.length > state.lastMessageCount
  const messagesToCount = canAppend
    ? messages.slice(state.lastMessageCount)
    : messages
  const tokens = messagesToCount.reduce(
    (total, message) => total + estimateTokens(message),
    0,
  )

  state.cachedTotalTokens = canAppend
    ? state.cachedTotalTokens + tokens
    : tokens
  state.lastMessageCount = messages.length
  return state.cachedTotalTokens
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

function createSystemReminderMessage(reminder: string): AgentMessage {
  return {
    role: 'user',
    content: `[REMINDER]\n${reminder}`,
    customType: SYSTEM_REMINDER_TYPE,
    timestamp: Date.now(),
  } as AgentMessage
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
