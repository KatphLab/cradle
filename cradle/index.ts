import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { registerOrchestratorCommand } from './commands/orchestrator.js'
import { registerSettingsCommand } from './commands/settings.js'
import { registerSpecCommand } from './commands/spec.js'
import { registerStatsCommand } from './commands/stats.js'
import { initToolOutputModeCache } from './config/settings.js'
import { registerCompactionHook } from './hooks/compaction.js'
import { registerOrchestratorModeHook } from './hooks/orchestrator-mode.js'
import { registerProjectContextHook } from './hooks/project-context.js'
import { registerShellHook } from './hooks/shell.js'
import { registerSpecModeHook } from './hooks/spec-mode.js'
import { registerSubagentUsageHook } from './hooks/subagent-usage.js'
import { registerSystemReminderHook } from './hooks/system-reminder.js'
import { ORCHESTRATOR_MODE_SYSTEM_PROMPT } from './prompts/orchestrator.js'
import { SPEC_MODE_SYSTEM_PROMPT } from './prompts/spec.js'
import { advisorTool } from './tools/advisor.js'
import { approvalTool } from './tools/approval.js'
import { bashTool } from './tools/bash.js'
import { councilTool } from './tools/council.js'
import { discoverAgentsTool } from './tools/discover-agents.js'
import { editTool } from './tools/edit.js'
import { globTool } from './tools/glob.js'
import { grepTool } from './tools/grep.js'
import { iterativeRetrievalTool } from './tools/iterative-retrieval/index.js'
import { lsTool } from './tools/ls.js'
import { readTool } from './tools/read.js'
import { subagentResumeTool } from './tools/subagent-resume.js'
import { subagentSessionsTool } from './tools/subagent-sessions.js'
import { subagentTool } from './tools/subagent.js'
import { todoTool } from './tools/todo.js'
import { webFetchInternalTool, webFetchTool } from './tools/webfetch/index.js'
import {
  webSearchInternalTool,
  webSearchTool,
} from './tools/websearch/index.js'
import { writeTool } from './tools/write.js'
import { createOrchestratorModeState } from './utils/orchestrator-state.js'
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
    | 'getAllTools'
    | 'setActiveTools'
    | 'getThinkingLevel'
    | 'sendUserMessage'
  >,
): void {
  void initToolOutputModeCache()

  pi.registerTool(readTool)
  pi.registerTool(lsTool)
  pi.registerTool(grepTool)
  pi.registerTool(globTool)
  pi.registerTool(editTool)
  pi.registerTool(writeTool)
  pi.registerTool(bashTool)
  pi.registerTool(approvalTool)
  pi.registerTool(todoTool)
  pi.registerTool(webFetchInternalTool)
  pi.registerTool(webFetchTool)
  pi.registerTool(webSearchInternalTool)
  pi.registerTool(webSearchTool)
  pi.registerTool(subagentTool)
  pi.registerTool(subagentSessionsTool)
  pi.registerTool(subagentResumeTool)
  pi.registerTool(discoverAgentsTool)
  pi.registerTool(advisorTool)
  pi.registerTool(councilTool)
  pi.registerTool(iterativeRetrievalTool)

  const specModeState = createSpecModeState()
  const orchestratorModeState = createOrchestratorModeState()

  registerSettingsCommand(pi)
  registerStatsCommand(pi)

  registerSpecCommand(pi, specModeState)
  registerOrchestratorCommand(pi, orchestratorModeState)
  registerShellHook(pi)
  registerSystemReminderHook(pi, {
    modeReminders: [
      { state: specModeState, systemPrompt: SPEC_MODE_SYSTEM_PROMPT },
      {
        state: orchestratorModeState,
        systemPrompt: ORCHESTRATOR_MODE_SYSTEM_PROMPT,
      },
    ],
  })
  registerProjectContextHook(pi)
  registerCompactionHook(pi)
  registerSpecModeHook(pi, specModeState)
  registerOrchestratorModeHook(pi, orchestratorModeState)
  registerSubagentUsageHook(pi)
}
