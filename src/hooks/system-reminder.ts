import type { AgentMessage } from '@earendil-works/pi-agent-core'
import {
  estimateTokens,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent'

import {
  DEFAULT_REMINDER_TOKEN_THRESHOLD,
  loadGlobalSettings,
  type GlobalSettings,
} from '../config/settings.js'
import { formatTodoReminder, reconstructTodos } from '../utils/todo-state.js'

const SYSTEM_REMINDER_TYPE = 'cradle-system-reminder'
const SYSTEM_REMINDER_TOKEN_LIMIT = 500

const SYSTEM_REMINDER_TAG_PATTERN =
  /<system-reminder>([\s\S]*?)<\/system-reminder>/g

/** @public */
export function registerSystemReminderHook(pi: Pick<ExtensionAPI, 'on'>): void {
  let cachedSettings: GlobalSettings = {}
  let cachedReminder: string | undefined = undefined
  let lastInjectedPayload: string | undefined = undefined
  let lastInjectedNonReminderTokens = 0

  pi.on('session_start', async (_event) => {
    cachedReminder = undefined
    lastInjectedPayload = undefined
    lastInjectedNonReminderTokens = 0
    cachedSettings = await loadGlobalSettings()
  })

  pi.on('before_agent_start', (event, context) => {
    const extracted = extractSystemReminder(event.systemPrompt)
    if (!extracted) {
      return
    }
    cachedReminder = extracted.reminder
    const tokens = countSystemReminderTokens(cachedReminder)
    if (tokens > SYSTEM_REMINDER_TOKEN_LIMIT) {
      context.ui.notify(
        `System reminder exceeds ${String(SYSTEM_REMINDER_TOKEN_LIMIT)} tokens (~${String(tokens)}). Consider shortening it.`,
        'warning',
      )
    }
    return { systemPrompt: extracted.systemPrompt }
  })

  pi.on('context', (event) => {
    const messages = event.messages.filter(
      (message) => !isSystemReminder(message),
    )

    const payload = buildReminderPayload(cachedReminder, event.messages)
    if (payload === undefined) {
      lastInjectedPayload = undefined
      lastInjectedNonReminderTokens = countMessagesTokens(messages)
      return { messages }
    }

    const currentNonReminderTokens = countMessagesTokens(messages)
    const tokenDistance =
      currentNonReminderTokens - lastInjectedNonReminderTokens
    const reminderTokenThreshold =
      cachedSettings.reminderTokenThreshold ?? DEFAULT_REMINDER_TOKEN_THRESHOLD
    const payloadChanged = payload !== lastInjectedPayload
    const contextAppearsTruncated = tokenDistance < 0
    const thresholdReached = tokenDistance >= reminderTokenThreshold

    if (!payloadChanged && !contextAppearsTruncated && !thresholdReached) {
      return { messages }
    }

    lastInjectedPayload = payload
    lastInjectedNonReminderTokens = currentNonReminderTokens

    return {
      messages: [...messages, createSystemReminderMessage(payload)],
    }
  })
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

function countSystemReminderTokens(reminder: string): number {
  return estimateTokens({
    role: 'custom',
    customType: SYSTEM_REMINDER_TYPE,
    content: reminder,
    display: false,
    timestamp: Date.now(),
  })
}

function createSystemReminderMessage(reminder: string): AgentMessage {
  return {
    role: 'custom',
    customType: SYSTEM_REMINDER_TYPE,
    content: `<system-reminder>\n${reminder}\n</system-reminder>`,
    display: false,
    timestamp: Date.now(),
  }
}

function isSystemReminder(message: AgentMessage): boolean {
  return 'customType' in message && message.customType === SYSTEM_REMINDER_TYPE
}
