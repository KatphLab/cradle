import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { AgentMessage } from '@earendil-works/pi-agent-core'
import {
  estimateTokens,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent'

import { loadCradleSettings, type CradleSettings } from '../config/settings.js'
import { formatTodoReminder, reconstructTodos } from '../utils/todo-state.js'

const SYSTEM_REMINDER_FILE = 'SYSTEM_REMINDER.md'
const SYSTEM_REMINDER_TYPE = 'cradle-system-reminder'
const SYSTEM_REMINDER_TOKEN_LIMIT = 500
const DEFAULT_REMINDER_INTERVAL = 3

/** @public */
export function registerSystemReminderHook(pi: Pick<ExtensionAPI, 'on'>): void {
  let cachedSettings: CradleSettings = {}
  let eventsSinceLastInjection = 0

  pi.on('session_start', async (_event, context) => {
    eventsSinceLastInjection = 0
    cachedSettings = await loadCradleSettings(context.cwd)

    const reminder = await loadSystemReminder(context.cwd)

    if (!reminder) {
      return
    }

    const tokens = countSystemReminderTokens(reminder)
    if (tokens > SYSTEM_REMINDER_TOKEN_LIMIT) {
      context.ui.notify(
        `SYSTEM_REMINDER.md exceeds ${String(SYSTEM_REMINDER_TOKEN_LIMIT)} tokens (~${String(tokens)}). Consider shortening it.`,
        'warning',
      )
    }
  })

  pi.on('context', async (event, context) => {
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

    // File-based reminder
    const fileReminder = await loadSystemReminder(context.cwd)
    if (fileReminder) {
      parts.push(fileReminder)
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

async function loadSystemReminder(cwd: string): Promise<string | undefined> {
  try {
    const content = await readFile(path.join(cwd, SYSTEM_REMINDER_FILE), 'utf8')
    const reminder = content.trim()
    return reminder.length > 0 ? reminder : undefined
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}
