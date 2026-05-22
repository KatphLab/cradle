import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { registerStatsCommand } from './commands/stats.js'
import { registerSessionHooks } from './hooks/session.js'
import { helloTool } from './tools/hello.js'

/** @public */
export default function configureExtension(
  pi: Pick<ExtensionAPI, 'registerTool' | 'registerCommand' | 'on'>,
): void {
  pi.registerTool(helloTool)
  registerStatsCommand(pi)
  registerSessionHooks(pi)
}
