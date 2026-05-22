import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { registerStatsCommand } from './commands/stats.js'
import { registerSessionHooks } from './hooks/session.js'
import { readTool } from './tools/read.js'

/** @public */
export default function configureExtension(
  pi: Pick<ExtensionAPI, 'registerTool' | 'registerCommand' | 'on'>,
): void {
  pi.registerTool(readTool)
  registerStatsCommand(pi)
  registerSessionHooks(pi)
}
