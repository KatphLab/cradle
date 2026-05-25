import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { registerSettingsCommand } from './commands/settings.js'
import { registerSpecCommand } from './commands/spec.js'
import { registerStatsCommand } from './commands/stats.js'
import { registerShellHook } from './hooks/shell.js'
import { registerSpecModeHook } from './hooks/spec-mode.js'
import { registerSystemReminderHook } from './hooks/system-reminder.js'
import { bashTool } from './tools/bash.js'
import { createSpecTool } from './tools/create-spec.js'
import { editTool } from './tools/edit.js'
import { globTool } from './tools/glob.js'
import { grepTool } from './tools/grep.js'
import { lsTool } from './tools/ls.js'
import { readTool } from './tools/read.js'
import { todoTool } from './tools/todo.js'
import { writeTool } from './tools/write.js'
import { createSpecModeState } from './utils/spec-state.js'

/** @public */
export default function configureExtension(
  pi: Pick<
    ExtensionAPI,
    | 'registerTool'
    | 'registerCommand'
    | 'on'
    | 'appendEntry'
    | 'getActiveTools'
    | 'setActiveTools'
  >,
): void {
  pi.registerTool(readTool)
  pi.registerTool(lsTool)
  pi.registerTool(grepTool)
  pi.registerTool(globTool)
  pi.registerTool(editTool)
  pi.registerTool(writeTool)
  pi.registerTool(bashTool)
  pi.registerTool(todoTool)
  pi.registerTool(createSpecTool)

  const specModeState = createSpecModeState()

  registerSettingsCommand(pi)
  registerStatsCommand(pi)
  registerSpecCommand(pi, specModeState)
  registerShellHook(pi)
  registerSystemReminderHook(pi)
  registerSpecModeHook(pi, specModeState)
}
