import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

let checkCount = 0

/** @public */
export function registerStatsCommand(
  pi: Pick<ExtensionAPI, 'registerCommand'>,
): void {
  pi.registerCommand('stats', {
    description: 'Show session statistics',
    handler: (_args, context): Promise<void> => {
      checkCount++
      const entries = context.sessionManager.getEntries().length
      context.ui.notify(
        `Stats: ${checkCount} checks, ${entries} entries`,
        'info',
      )
      return Promise.resolve()
    },
  })
}

/** @public */
export function resetStatsCount(): void {
  checkCount = 0
}
