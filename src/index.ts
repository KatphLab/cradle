import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { registerSettingsCommand } from './commands/settings.js'
import { registerStatsCommand } from './commands/stats.js'
import { registerSessionHooks } from './hooks/session.js'
import { registerSystemReminderHook } from './hooks/system-reminder.js'
import { createTool } from './tools/create.js'
import { editTool } from './tools/edit.js'
import { globTool } from './tools/glob.js'
import { grepTool } from './tools/grep.js'
import { lsTool } from './tools/ls.js'
import { readTool } from './tools/read.js'

/** @public */
export default function configureExtension(
  pi: Pick<ExtensionAPI, 'registerTool' | 'registerCommand' | 'on'>,
): void {
  pi.registerTool(readTool)
  pi.registerTool(lsTool)
  pi.registerTool(grepTool)
  pi.registerTool(globTool)
  pi.registerTool(editTool)
  pi.registerTool(createTool)
  registerSettingsCommand(pi)
  registerStatsCommand(pi)
  registerSessionHooks(pi)
  registerSystemReminderHook(pi)
}
