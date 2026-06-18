import { Type, type Static } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'

import { loadCradleSettings } from '../config/settings.js'
import { discoverAgents } from '../lib/subagents/agents.js'
import { runSingleAgent } from '../lib/subagents/runner.js'
import type { SingleResult, SubagentDetails } from '../lib/subagents/types.js'
import {
  getFinalOutput,
  getResultOutput,
  isFailedResult,
} from '../lib/subagents/utilities.js'
import {
  renderCollapsedToolSummary,
  shouldRenderFullToolResult,
} from '../utils/tool-render.js'
import {
  buildRenderResult,
  renderResultFallback,
} from './subagent/subagent-render.js'

const SubagentResumeParameters = Type.Object(
  {
    agent: Type.String({ description: 'Name of the agent to resume' }),
    task: Type.String({ description: 'Follow-up task to send to the session' }),
    sessionId: Type.String({
      description: 'Existing subagent session id to resume',
    }),
    cwd: Type.Optional(
      Type.String({ description: 'Working directory for the agent process' }),
    ),
  },
  { additionalProperties: false },
)

type SubagentResumeParametersType = Static<typeof SubagentResumeParameters>

interface SubagentResumeResult {
  content: { type: 'text'; text: string }[]
  details: SubagentDetails
  isError?: boolean
}

function makeDetails(
  projectAgentsDir: string | undefined,
  result: SingleResult,
) {
  return {
    mode: 'single' as const,
    projectAgentsDir,
    results: [result],
  }
}

function buildResumeResponse(
  result: SingleResult,
  projectAgentsDir: string | undefined,
): SubagentResumeResult {
  const details = makeDetails(projectAgentsDir, result)
  if (isFailedResult(result)) {
    return {
      content: [
        {
          type: 'text',
          text: `Agent ${result.stopReason ?? 'failed'}: ${getResultOutput(result)}`,
        },
      ],
      details,
      isError: true,
    }
  }
  const output = getFinalOutput(result.messages)
  return {
    content: [{ type: 'text', text: output === '' ? '(no output)' : output }],
    details,
  }
}

/** @public */
export const subagentResumeTool = defineTool({
  name: 'subagent_resume',
  label: 'Subagent Resume',
  description:
    'Resume an existing subagent session. Use subagent_sessions first if you do not know the session id.',
  parameters: SubagentResumeParameters,

  async execute(
    _toolCallId,
    parameters: SubagentResumeParametersType,
    signal,
    onUpdate,
    context,
  ) {
    const discovery = discoverAgents(context.cwd)
    const settings = await loadCradleSettings(context.cwd)
    const result = await runSingleAgent({
      defaultCwd: context.cwd,
      agents: discovery.agents,
      agentName: parameters.agent,
      task: parameters.task,
      cwd: parameters.cwd,
      sessionId: parameters.sessionId,
      step: undefined,
      signal,
      onUpdate: onUpdate
        ? (partial) => {
            onUpdate({
              content: partial.content,
              details: {
                mode: 'single',
                projectAgentsDir: discovery.projectAgentsDir,
                results: partial.details.results,
              },
            })
          }
        : undefined,
      makeDetails: (results) => ({
        mode: 'single',
        projectAgentsDir: discovery.projectAgentsDir,
        results,
      }),
      complexity: undefined,
      settings,
    })

    return buildResumeResponse(result, discovery.projectAgentsDir)
  },

  renderCall(args, theme) {
    const parsed = args as Partial<SubagentResumeParametersType>
    const agent = parsed.agent ?? 'unknown'
    const sessionId = parsed.sessionId ?? 'unknown-session'
    return new Text(
      theme.fg('toolTitle', theme.bold('subagent resume ')) +
        theme.fg('accent', agent) +
        theme.fg('muted', ` (${sessionId})`),
      0,
      0,
    )
  },

  renderResult(result, options, theme, context) {
    const summary = renderCollapsedToolSummary(
      'subagent_resume',
      '',
      options,
      theme,
      context,
    )
    if (summary) return summary
    if (result.details && typeof result.details === 'object') {
      return buildRenderResult(
        result,
        shouldRenderFullToolResult(options),
        theme,
      )
    }
    return renderResultFallback(result)
  },
})
