import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { isToolCallEventType } from '@earendil-works/pi-coding-agent'

import {
  classifyShellRisk,
  loadShellRiskPatterns,
} from '../config/shell-risk.js'

/** @public */
export function registerShellHook(pi: Pick<ExtensionAPI, 'on'>): void {
  pi.on('tool_call', async (event, context) => {
    if (!isToolCallEventType('bash', event)) {
      return {}
    }

    const command = (event.input as { command?: string }).command ?? ''
    const patterns = await loadShellRiskPatterns(context.cwd)
    const detected = classifyShellRisk(command, patterns)

    // Notify the user for high/critical shell commands when patterns are loaded.
    if (
      detected !== undefined &&
      (detected.level === 'high' || detected.level === 'critical')
    ) {
      context.ui.notify(
        `Shell ${detected.level}: ${detected.reason} — ${command}`,
        detected.level === 'critical' ? 'error' : 'warning',
      )
    }

    return {}
  })
}
