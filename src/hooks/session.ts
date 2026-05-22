import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { isToolCallEventType } from '@earendil-works/pi-coding-agent'

const sessions = new Map<string, number>()

/** @public */
export function registerSessionHooks(pi: Pick<ExtensionAPI, 'on'>): void {
  pi.on('session_start', (_event, context) => {
    const id = `s${sessions.size + 1}`
    sessions.set(id, 0)
    context.ui.notify(`Session ${id} started`, 'info')
  })

  pi.on('tool_call', async (event, context) => {
    const lastId = [...sessions.keys()].at(-1)
    if (lastId) {
      sessions.set(lastId, (sessions.get(lastId) ?? 0) + 1)
    }

    if (!isToolCallEventType('bash', event)) {
      return {}
    }

    const command = event.input.command
    if (command.includes('rm -rf')) {
      const allowed = await context.ui.confirm('Dangerous!', 'Allow rm -rf?')
      if (!allowed) {
        return { block: true, reason: 'Blocked by user' }
      }
    }

    return {}
  })

  pi.on('agent_end', (_event, context) => {
    context.ui.notify(`${sessions.size} sessions tracked`, 'info')
  })
}

/** @public */
export function clearSessions(): void {
  sessions.clear()
}
