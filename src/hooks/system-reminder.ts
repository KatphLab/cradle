import type { AgentMessage } from '@earendil-works/pi-agent-core'
import {
  estimateTokens,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent'

import { loadCradleSettings, type CradleSettings } from '../config/settings.js'
import { formatTodoReminder, reconstructTodos } from '../utils/todo-state.js'

const SYSTEM_REMINDER_TYPE = 'cradle-system-reminder'
const SYSTEM_REMINDER_TOKEN_LIMIT = 500
const DEFAULT_REMINDER_INTERVAL = 3

const SYSTEM_REMINDER_TAG_PATTERN =
  /<system-reminder>([\s\S]*?)<\/system-reminder>/g

/** @public */
export function registerSystemReminderHook(pi: Pick<ExtensionAPI, 'on'>): void {
  let cachedSettings: CradleSettings = {}
  let cachedReminder: string | undefined = undefined
  let eventsSinceLastInjection = 0

  pi.on('session_start', async (_event, _context) => {
    eventsSinceLastInjection = 0
    cachedReminder = undefined
    cachedSettings = await loadCradleSettings(_context.cwd)
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

  pi.on('context', (event, _context) => {
    const messages = event.messages.filter(
      (message) => !isSystemReminder(message),
    )

    const interval =
      cachedSettings.reminderInterval ?? DEFAULT_REMINDER_INTERVAL
    const lastRole = getLastNonReminderMessageRole(event.messages)
    const isUserTurn = lastRole === 'user'

    if (isUserTurn) {
      eventsSinceLastInjection = 0
    } else {
      eventsSinceLastInjection++
    }

    if (!isUserTurn && eventsSinceLastInjection < interval) {
      return { messages }
    }

    eventsSinceLastInjection = 0

    const parts: string[] = []

    // Cached reminder from system prompt
    if (cachedReminder) {
      parts.push(cachedReminder)
    }

    // Active task list reminder
    const currentTodos = reconstructTodos(event.messages)
    const hasActiveTodos = currentTodos.some((t) => t.status !== 'completed')
    if (hasActiveTodos) {
      parts.push(formatTodoReminder(currentTodos))
    }

    if (parts.length === 0) {
      return { messages }
    }

    return {
      messages: [...messages, createSystemReminderMessage(parts.join('\n\n'))],
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

function getLastNonReminderMessageRole(
  messages: AgentMessage[],
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message !== undefined && !isSystemReminder(message)) {
      return message.role
    }
  }
  return undefined
}

function isSystemReminder(message: AgentMessage): boolean {
  return 'customType' in message && message.customType === SYSTEM_REMINDER_TYPE
}
