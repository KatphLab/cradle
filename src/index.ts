import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { registerSettingsCommand } from './commands/settings.js'
import { registerStatsCommand } from './commands/stats.js'
import { registerShellHook } from './hooks/shell.js'
import { registerSystemReminderHook } from './hooks/system-reminder.js'
import { bashTool } from './tools/bash.js'
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
  pi.registerTool(bashTool)
  registerSettingsCommand(pi)
  registerStatsCommand(pi)
  registerShellHook(pi)
  registerSystemReminderHook(pi)
}
