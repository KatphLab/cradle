import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

/**
 * Failsafe hook that immediately aborts the agent operation when the
 * ask_user tool finishes executing. This guards against non-compliant
 * agents that ignore the tool description and try to keep working after
 * presenting a questionnaire.
 *
 * @public
 */
export function registerAskUserAbortHook(pi: Pick<ExtensionAPI, 'on'>): void {
  pi.on('tool_execution_end', (event, context) => {
    if (event.toolName !== 'ask_user') {
      return
    }

    context.abort()
  })
}
