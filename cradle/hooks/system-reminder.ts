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
import {
  formatApprovalReminder,
  reconstructApprovalState,
} from '../utils/approval-state.js'
import { formatTodoReminder, reconstructTodos } from '../utils/todo-state.js'
import { isCradleSubagentProcess } from '../utils/tool.js'

const SYSTEM_REMINDER_TYPE = 'cradle-system-reminder'
const SYSTEM_REMINDER_TOKEN_LIMIT = 500
export const CONTINUE_AFTER_REMINDER_PROMPT =
  "You have been working for too long. Re-read and quote the user's original request before continuing. If you are stuck, unsure, or about to take an action the user did not explicitly request, ask the user or advisor first. Otherwise, continue with only the requested work."

export const DEFAULT_SYSTEM_REMINDER = [
  'Use approval as the authorization boundary for file edits/writes and medium, high, or critical bash commands. Low-risk bash commands do not require approval.',
  'For non-trivial work, plan first and request approval one scoped step at a time, with at most 4 file scopes and 4 bash scopes.',
  'After approval, execute the approved scope without re-asking. Do not infer approval from the initial request, prior context, or out-of-scope work.',
  'Request a new proposal for changed scope or if the plan no longer fits. If approval is the only blocker, create the proposal and wait.',
  'For other uncertainty or blockers, stop, summarize progress and the blocker, and ask how to proceed rather than retrying indefinitely.',
  'Do not maintain backwards compatibility for any feature; prefer the cleanest modern implementation.',
].join('\n')
const REMINDER_CONTINUE_POLL_INTERVAL_MS = 25

type SystemReminderPi = Pick<ExtensionAPI, 'on' | 'sendUserMessage'>

interface ModeReminderState {
  isEnabled: () => boolean
}

interface ModeSystemReminder {
  state: ModeReminderState
  systemPrompt: string
}

interface SystemReminderOptions {
  modeReminders?: readonly ModeSystemReminder[]
}

type ContinuationContext = Pick<ExtensionContext, 'abort' | 'isIdle'>

interface SystemReminderState {
  cachedSettings: GlobalSettings
  cachedReminder: string | undefined
  streamedTokensSinceLastInjection: number
  continuationScheduled: boolean
  sessionRevision: number
  cachedTodoReminder: string | undefined
  lastTodoMessageCount: number
  cachedApprovalReminder: string | undefined
  lastApprovalMessageCount: number
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
export function registerSystemReminderHook(
  pi: SystemReminderPi,
  options: SystemReminderOptions = {},
): void {
  const state = createSystemReminderState()

  pi.on('session_start', async (_event) => {
    resetSystemReminderState(state)
    state.cachedSettings = await loadGlobalSettings()
  })

  pi.on('before_agent_start', (event, context) =>
    handleBeforeAgentStart(event, context, state, options.modeReminders),
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
    cachedApprovalReminder: undefined,
    lastApprovalMessageCount: 0,
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
  modeReminders: readonly ModeSystemReminder[] = [],
): BeforeAgentStartResultLike | undefined {
  const display = shouldDisplaySystemReminder(state.cachedSettings)
  const modeReminder = getActiveModeReminder(modeReminders)
  if (modeReminder !== undefined) {
    const cleanedPrompt = extractSystemReminder(
      event.systemPrompt,
    )?.systemPrompt
    return cacheSystemReminder(
      modeReminder,
      cleanedPrompt ?? event.systemPrompt,
      display,
      context,
      state,
    )
  }

  const extracted = extractSystemReminder(event.systemPrompt)
  if (extracted) {
    return cacheSystemReminder(
      extracted.reminder,
      extracted.systemPrompt,
      display,
      context,
      state,
    )
  }

  // Subagents don't get the default system reminder (which includes approval
  // instructions), since they shouldn't manage proposals or ask for approval.
  // They can still use <system-reminder> tags in their agent prompt if needed.
  if (isCradleSubagentProcess()) return undefined

  state.cachedReminder = DEFAULT_SYSTEM_REMINDER
  return {
    message: createSystemReminderDisplayMessage(state.cachedReminder, display),
    systemPrompt: event.systemPrompt,
  }
}

function getActiveModeReminder(
  modeReminders: readonly ModeSystemReminder[],
): string | undefined {
  for (const modeReminder of modeReminders) {
    if (!modeReminder.state.isEnabled()) continue
    const extracted = extractSystemReminder(modeReminder.systemPrompt)
    if (extracted !== undefined) return extracted.reminder
  }
  return undefined
}

function cacheSystemReminder(
  reminder: string,
  systemPrompt: string,
  display: boolean,
  context: NotifyContextLike,
  state: SystemReminderState,
): BeforeAgentStartResultLike {
  const tokens = estimateTokens({
    role: 'custom',
    customType: SYSTEM_REMINDER_TYPE,
    content: reminder,
    display,
    timestamp: Date.now(),
  })
  if (tokens > SYSTEM_REMINDER_TOKEN_LIMIT) {
    context.ui.notify(
      `System reminder exceeds ${SYSTEM_REMINDER_TOKEN_LIMIT} tokens (~${tokens}). Consider shortening it.`,
      'warning',
    )
  }
  state.cachedReminder = reminder
  return {
    message: createSystemReminderDisplayMessage(state.cachedReminder, display),
    systemPrompt,
  }
}

function handleContext(
  eventMessages: AgentMessage[],
  state: SystemReminderState,
): { messages: AgentMessage[] } {
  const messages = eventMessages.filter((message) => !isSystemReminder(message))

  // Cache updated task reminder for before_provider_request
  getTodoReminder(messages, state)
  getApprovalReminder(messages, state)

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
  if (state.cachedApprovalReminder) parts.push(state.cachedApprovalReminder)
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

function handleMessageUpdate(
  event: MessageUpdateEventLike,
  context: ContinuationContext,
  pi: Pick<SystemReminderPi, 'sendUserMessage'>,
  state: SystemReminderState,
): void {
  if (isCradleSubagentProcess()) return

  // A new user message resets the streaming-reminder counter so it starts fresh
  if (event.message.role === 'user') {
    state.streamedTokensSinceLastInjection = 0
    state.continuationScheduled = false
    return
  }

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
    if (!state.continuationScheduled) return
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

function getApprovalReminder(
  messages: AgentMessage[],
  state: SystemReminderState,
): string | undefined {
  if (messages.length === state.lastApprovalMessageCount) {
    return state.cachedApprovalReminder
  }
  const approvalState = reconstructApprovalState(messages)
  state.cachedApprovalReminder = formatApprovalReminder(approvalState)
  state.lastApprovalMessageCount = messages.length
  return state.cachedApprovalReminder
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
