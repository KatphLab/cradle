import type { TextContent } from '@earendil-works/pi-ai'

import type { GlobalSettings } from '../config/settings.js'
import { runSingleAgent } from '../subagents/runner.js'
import type { AgentConfig, SingleResult } from '../subagents/types.js'
import { getFinalOutput, isFailedResult } from '../subagents/utilities.js'

function getSubagentFailureText(result: SingleResult): string {
  if (result.errorMessage) return result.errorMessage
  if (result.stderr) return result.stderr
  const output = getFinalOutput(result.messages)
  if (output.length > 0) return output
  return result.stopReason ?? 'error'
}

export function buildSubagentResult(
  result: SingleResult,
  toolName: string,
): {
  content: [TextContent]
  details: undefined
} {
  const output = isFailedResult(result)
    ? `${toolName} failed: ${getSubagentFailureText(result)}`
    : getFinalOutput(result.messages)
  return {
    content: [{ type: 'text', text: output }],
    details: undefined,
  }
}

export async function executeToolSubagent(
  context: { cwd: string },
  discovery: { agents: AgentConfig[]; projectAgentsDir: string | undefined },
  agentName: string,
  task: string,
  settings: GlobalSettings,
  signal: AbortSignal | undefined,
): Promise<SingleResult> {
  return runSingleAgent({
    defaultCwd: context.cwd,
    agents: discovery.agents,
    agentName,
    task,
    cwd: undefined,
    step: undefined,
    signal,
    onUpdate: undefined,
    makeDetails: () => ({
      mode: 'single' as const,
      projectAgentsDir: discovery.projectAgentsDir,
      results: [],
    }),
    complexity: 'low',
    settings,
  })
}
