import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { AgentMessage } from '@earendil-works/pi-agent-core'
import {
  estimateTokens,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent'

const SYSTEM_REMINDER_FILE = 'SYSTEM_REMINDER.md'
const SYSTEM_REMINDER_TYPE = 'cradle-system-reminder'
const SYSTEM_REMINDER_TOKEN_LIMIT = 500

/** @public */
export function registerSystemReminderHook(pi: Pick<ExtensionAPI, 'on'>): void {
  pi.on('session_start', async (_event, context) => {
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
    const reminder = await loadSystemReminder(context.cwd)

    if (!reminder) {
      return { messages }
    }

    return {
      messages: [...messages, createSystemReminderMessage(reminder)],
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
