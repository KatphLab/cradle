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
const CONTINUE_AFTER_REMINDER_PROMPT = 'Continue.'
const REMINDER_CONTINUE_POLL_INTERVAL_MS = 25

const SYSTEM_REMINDER_TAG_PATTERN =
  /<system-reminder>([\s\S]*?)<\/system-reminder>/g

type SystemReminderPi = Pick<ExtensionAPI, 'on' | 'sendUserMessage'>

type ContinuationContext = Pick<ExtensionContext, 'abort' | 'isIdle'>

interface SystemReminderState {
  cachedSettings: GlobalSettings
  cachedReminder: string | undefined
  lastInjectedPayload: string | undefined
  lastInjectedNonReminderTokens: number
  latestNonReminderMessages: AgentMessage[]
  streamedTokensSinceLastInjection: number
  forcedNextPayload: string | undefined
  continuationScheduled: boolean
  sessionRevision: number
}

interface BeforeAgentStartEventLike {
  systemPrompt: string
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
    cachedReminder: undefined,
    lastInjectedPayload: undefined,
    lastInjectedNonReminderTokens: 0,
    latestNonReminderMessages: [],
    streamedTokensSinceLastInjection: 0,
    forcedNextPayload: undefined,
    continuationScheduled: false,
    sessionRevision: 0,
  }
}

function resetSystemReminderState(state: SystemReminderState): void {
  state.sessionRevision++
  state.cachedReminder = undefined
  state.lastInjectedPayload = undefined
  state.lastInjectedNonReminderTokens = 0
  state.latestNonReminderMessages = []
  state.streamedTokensSinceLastInjection = 0
  state.forcedNextPayload = undefined
  state.continuationScheduled = false
}

function handleBeforeAgentStart(
  event: BeforeAgentStartEventLike,
  context: NotifyContextLike,
  state: SystemReminderState,
): { systemPrompt: string } | undefined {
  const extracted = extractSystemReminder(event.systemPrompt)
  if (!extracted) return undefined

  state.cachedReminder = extracted.reminder
  const tokens = countSystemReminderTokens(state.cachedReminder)
  if (tokens > SYSTEM_REMINDER_TOKEN_LIMIT) {
    context.ui.notify(
      `System reminder exceeds ${String(SYSTEM_REMINDER_TOKEN_LIMIT)} tokens (~${String(tokens)}). Consider shortening it.`,
      'warning',
    )
  }

  return { systemPrompt: extracted.systemPrompt }
}

function handleContext(
  eventMessages: AgentMessage[],
  state: SystemReminderState,
): { messages: AgentMessage[] } {
  const messages = eventMessages.filter((message) => !isSystemReminder(message))
  state.latestNonReminderMessages = messages

  const forcedPayload = state.forcedNextPayload
  const payload =
    forcedPayload ?? buildReminderPayload(state.cachedReminder, eventMessages)
  if (payload === undefined) return handleEmptyContextPayload(messages, state)

  const currentNonReminderTokens = countMessagesTokens(messages)
  if (!shouldInjectReminder(payload, currentNonReminderTokens, state)) {
    return { messages }
  }

  if (forcedPayload !== undefined) state.forcedNextPayload = undefined
  state.lastInjectedPayload = payload
  state.lastInjectedNonReminderTokens = currentNonReminderTokens
  state.streamedTokensSinceLastInjection = 0

  return { messages: [...messages, createSystemReminderMessage(payload)] }
}

function handleEmptyContextPayload(
  messages: AgentMessage[],
  state: SystemReminderState,
): { messages: AgentMessage[] } {
  state.lastInjectedPayload = undefined
  state.lastInjectedNonReminderTokens = countMessagesTokens(messages)
  state.streamedTokensSinceLastInjection = 0
  return { messages }
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

  const deltaTokens = countUpdateDeltaTokens(event)
  if (deltaTokens === 0) return

  state.streamedTokensSinceLastInjection += deltaTokens
  if (state.continuationScheduled) return
  if (
    state.streamedTokensSinceLastInjection <
    getReminderTokenThreshold(state.cachedSettings)
  ) {
    return
  }

  const payload = buildReminderPayload(
    state.cachedReminder,
    state.latestNonReminderMessages,
  )
  if (payload === undefined) return

  state.forcedNextPayload = payload
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
    SYSTEM_REMINDER_TAG_PATTERN,
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
  cachedReminder: string | undefined,
  messages: AgentMessage[],
): string | undefined {
  const parts: string[] = []

  if (cachedReminder) {
    parts.push(cachedReminder)
  }

  const currentTodos = reconstructTodos(messages)
  const hasActiveTodos = currentTodos.some(
    (todo) => todo.status !== 'completed',
  )
  if (hasActiveTodos) {
    parts.push(formatTodoReminder(currentTodos))
  }

  if (parts.length === 0) {
    return undefined
  }

  return parts.join('\n\n')
}

function countMessagesTokens(messages: AgentMessage[]): number {
  return messages.reduce((total, message) => total + estimateTokens(message), 0)
}

function getReminderTokenThreshold(settings: GlobalSettings): number {
  return settings.reminderTokenThreshold ?? DEFAULT_REMINDER_TOKEN_THRESHOLD
}

function countUpdateDeltaTokens(event: {
  assistantMessageEvent: unknown
}): number {
  const assistantEvent = event.assistantMessageEvent
  if (!hasStringDelta(assistantEvent)) return 0
  if (assistantEvent.delta.length === 0) return 0
  return countTextTokens(assistantEvent.delta)
}

function hasStringDelta(value: unknown): value is { delta: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'delta' in value &&
    typeof value.delta === 'string'
  )
}

function countTextTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function countSystemReminderTokens(reminder: string): number {
  return estimateTokens({
    role: 'custom',
    customType: SYSTEM_REMINDER_TYPE,
    content: reminder,
    display: true,
    timestamp: Date.now(),
  })
}

function createSystemReminderMessage(reminder: string): AgentMessage {
  return {
    role: 'custom',
    customType: SYSTEM_REMINDER_TYPE,
    content: `<system-reminder>\n${reminder}\n</system-reminder>`,
    display: true,
    timestamp: Date.now(),
  }
}

function isSystemReminder(message: AgentMessage): boolean {
  return 'customType' in message && message.customType === SYSTEM_REMINDER_TYPE
}
