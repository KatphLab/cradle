import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { loadCradleSettings } from '../../config/settings.js'
import { runSingleAgent } from '../../lib/subagents/runner.js'
import type {
  AgentConfig,
  SingleResult,
  SubagentDetails,
} from '../../lib/subagents/types.js'
import { getFinalOutput } from '../../lib/subagents/utilities.js'
import { ADVISOR_SYSTEM_PROMPT, buildAdvisorUserMessage } from './prompt.js'

const ADVISOR_TOOLS = ['read', 'ls', 'grep', 'glob']

const ADVISOR_AGENT: AgentConfig = {
  name: 'advisor',
  description: 'Expert advisor for analysis and recommendations',
  tools: ADVISOR_TOOLS,
  systemPrompt: ADVISOR_SYSTEM_PROMPT,
  source: 'extension',
  filePath: '',
}

export interface AdvisorResult {
  output: string
  result: SingleResult
}

export async function runAdvisor(parameters: {
  context: string
  code: string | undefined
  error: string | undefined
  attempted: string | undefined
  files: string[] | undefined
  cwd: string
  signal: AbortSignal | undefined
  onUpdate: ((partial: AgentToolResult<SubagentDetails>) => void) | undefined
}): Promise<AdvisorResult> {
  const settings = await loadCradleSettings(parameters.cwd)

  if (
    settings.advisorModel === undefined ||
    settings.advisorModel.length === 0
  ) {
    throw new Error(
      'Advisor model not configured. Run /cradle-settings to set it.',
    )
  }

  let userMessage = buildAdvisorUserMessage({
    context: parameters.context,
    code: parameters.code,
    error: parameters.error,
    attempted: parameters.attempted,
  })

  if (parameters.files !== undefined && parameters.files.length > 0) {
    const fileList = parameters.files.map((f) => `- ${f}`).join('\n')
    userMessage += `\n\n## Files to Examine\n${fileList}\n\nPlease read these files to gather additional context.`
  }

  const result = await runSingleAgent({
    defaultCwd: parameters.cwd,
    agents: [ADVISOR_AGENT],
    agentName: 'advisor',
    task: userMessage,
    cwd: parameters.cwd,
    step: undefined,
    signal: parameters.signal,
    onUpdate: parameters.onUpdate,
    makeDetails: (results) => ({
      mode: 'single',
      projectAgentsDir: undefined,
      results,
    }),
    complexity: undefined,
    settings: {
      subagentModels: {
        low: settings.advisorModel,
        medium: settings.advisorModel,
        high: settings.advisorModel,
      },
    },
  })

  const output = getFinalOutput(result.messages)

  return {
    output: output.length > 0 ? output : '(no output)',
    result,
  }
}
