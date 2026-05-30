import type {
  AgentToolResult,
  AgentToolUpdateCallback,
} from '@earendil-works/pi-agent-core'
import { StringEnum } from '@earendil-works/pi-ai'
import { Type, type Static } from 'typebox'
import { loadCradleSettings } from '../config/settings.js'
import { formatAgentList } from '../subagents/agents.js'
import { runSingleAgent } from '../subagents/runner.js'
import type {
  AgentConfig,
  AgentScope,
  SingleResult,
  SubagentDetails,
} from '../subagents/types.js'
import {
  getFinalOutput,
  getResultOutput,
  isFailedResult,
  mapWithConcurrencyLimit,
  MAX_CONCURRENCY,
  MAX_PARALLEL_TASKS,
  truncateParallelOutput,
} from '../subagents/utilities.js'

const ComplexitySchema = StringEnum(['low', 'medium', 'high'] as const, {
  description: 'Task complexity for model selection',
})

const TaskItem = Type.Object(
  {
    agent: Type.String({ description: 'Name of the agent to invoke' }),
    task: Type.String({ description: 'Task to delegate to the agent' }),
    cwd: Type.Optional(
      Type.String({ description: 'Working directory for the agent process' }),
    ),
    complexity: Type.Optional(ComplexitySchema),
  },
  { additionalProperties: false },
)

const ChainItem = Type.Object(
  {
    agent: Type.String({ description: 'Name of the agent to invoke' }),
    task: Type.String({
      description: 'Task with optional {previous} placeholder for prior output',
    }),
    cwd: Type.Optional(
      Type.String({ description: 'Working directory for the agent process' }),
    ),
    complexity: Type.Optional(ComplexitySchema),
  },
  { additionalProperties: false },
)

const AgentScopeSchema = StringEnum(['user', 'project', 'both'] as const, {
  description:
    'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
  default: 'user',
})

export const SubagentParameters = Type.Object({
  agent: Type.Optional(
    Type.String({
      description: 'Name of the agent to invoke (for single mode)',
    }),
  ),
  task: Type.Optional(
    Type.String({ description: 'Task to delegate (for single mode)' }),
  ),
  tasks: Type.Optional(
    Type.Array(TaskItem, {
      description: 'Array of {agent, task} for parallel execution',
    }),
  ),
  chain: Type.Optional(
    Type.Array(ChainItem, {
      description: 'Array of {agent, task} for sequential execution',
    }),
  ),
  agentScope: Type.Optional(AgentScopeSchema),
  cwd: Type.Optional(
    Type.String({
      description: 'Working directory for the agent process (single mode)',
    }),
  ),
  complexity: Type.Optional(ComplexitySchema),
})

export type SubagentParametersType = Static<typeof SubagentParameters>

export interface ToolContext {
  cwd: string
  hasUI: boolean
  ui: { confirm: (title: string, body: string) => Promise<boolean> }
}

export type MakeDetails = (
  mode: 'single' | 'parallel' | 'chain',
) => (results: SingleResult[]) => SubagentDetails

export type ToolResult = AgentToolResult<SubagentDetails> & {
  isError?: boolean
}

export type UpdateCallback = AgentToolUpdateCallback<SubagentDetails>

export function validateModeCount(
  parameters: SubagentParametersType,
): string | undefined {
  const hasChain = (parameters.chain?.length ?? 0) > 0
  const hasTasks = (parameters.tasks?.length ?? 0) > 0
  const hasSingle = Boolean(parameters.agent && parameters.task)
  const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle)
  if (modeCount !== 1) {
    return 'Invalid parameters. Provide exactly one mode.'
  }
  return undefined
}

export function makeDetailsFactory(
  agentScope: AgentScope,
  projectAgentsDirectory: string | undefined,
): MakeDetails {
  return (mode) => (results) => ({
    mode,
    agentScope,
    projectAgentsDir: projectAgentsDirectory,
    results,
  })
}

export function buildValidationErrorResponse(
  message: string,
  agents: AgentConfig[],
  makeDetails: MakeDetails,
): ToolResult {
  const { text } = formatAgentList(agents, 10)
  return {
    content: [
      {
        type: 'text',
        text: `${message}\nAvailable agents: ${text}`,
      },
    ],
    details: makeDetails('single')([]),
  }
}

export function buildNoModeResponse(
  agents: AgentConfig[],
  makeDetails: MakeDetails,
): ToolResult {
  const { text } = formatAgentList(agents, 10)
  return {
    content: [
      {
        type: 'text',
        text: `Invalid parameters. Available agents: ${text}`,
      },
    ],
    details: makeDetails('single')([]),
  }
}

export async function handleSingleMode(
  parameters: SubagentParametersType,
  context: ToolContext,
  agents: AgentConfig[],
  signal: AbortSignal | undefined,
  onUpdate: UpdateCallback | undefined,
  makeDetails: MakeDetails,
): Promise<ToolResult> {
  const agentName = parameters.agent
  const task = parameters.task
  if (!agentName || !task) {
    throw new Error('Missing agent or task in single mode')
  }
  const settings = await loadCradleSettings(context.cwd)
  const result = await runSingleAgent({
    defaultCwd: context.cwd,
    agents,
    agentName,
    task,
    cwd: parameters.cwd,
    step: undefined,
    signal,
    onUpdate,
    makeDetails: makeDetails('single'),
    complexity: parameters.complexity,
    settings,
  })
  if (isFailedResult(result)) {
    const errorMessage = getResultOutput(result)
    return {
      content: [
        {
          type: 'text',
          text: `Agent ${result.stopReason ?? 'failed'}: ${errorMessage}`,
        },
      ],
      details: makeDetails('single')([result]),
      isError: true,
    }
  }
  const output = getFinalOutput(result.messages)
  return {
    content: [
      {
        type: 'text',
        text: output === '' ? '(no output)' : output,
      },
    ],
    details: makeDetails('single')([result]),
  }
}

export async function handleChainMode(
  parameters: SubagentParametersType,
  context: ToolContext,
  agents: AgentConfig[],
  signal: AbortSignal | undefined,
  onUpdate: UpdateCallback | undefined,
  makeDetails: MakeDetails,
): Promise<ToolResult> {
  const chain = parameters.chain
  if (!chain || chain.length === 0) {
    throw new Error('Missing chain in chain mode')
  }
  const settings = await loadCradleSettings(context.cwd)
  const results: SingleResult[] = []
  let previousOutput = ''

  for (const [index, step] of chain.entries()) {
    const taskWithContext = step.task.replaceAll('{previous}', previousOutput)

    const chainUpdate: UpdateCallback | undefined = onUpdate
      ? (partial) => {
          const currentResult = partial.details.results[0]
          if (currentResult) {
            const allResults = [...results, currentResult]
            onUpdate({
              content: partial.content,
              details: makeDetails('chain')(allResults),
            })
          }
        }
      : undefined

    const result = await runSingleAgent({
      defaultCwd: context.cwd,
      agents,
      agentName: step.agent,
      task: taskWithContext,
      cwd: step.cwd,
      step: index + 1,
      signal,
      onUpdate: chainUpdate,
      makeDetails: makeDetails('chain'),
      complexity: step.complexity,
      settings,
    })
    results.push(result)

    if (isFailedResult(result)) {
      const errorMessage = getResultOutput(result)
      return {
        content: [
          {
            type: 'text',
            text: `Chain stopped at step ${index + 1} (${step.agent}): ${errorMessage}`,
          },
        ],
        details: makeDetails('chain')(results),
        isError: true,
      }
    }
    previousOutput = getFinalOutput(result.messages)
  }

  const last = results.at(-1)
  const output = last ? getFinalOutput(last.messages) : '(no output)'
  return {
    content: [
      {
        type: 'text',
        text: output,
      },
    ],
    details: makeDetails('chain')(results),
  }
}

function createParallelPlaceholder(agent: string, task: string): SingleResult {
  return {
    agent,
    agentSource: 'unknown',
    task,
    exitCode: -1,
    messages: [],
    stderr: '',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: 0,
      turns: 0,
    },
  }
}

function buildParallelProgressUpdate(
  done: number,
  total: number,
  running: number,
  makeDetails: MakeDetails,
): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: `Parallel: ${done}/${total} done, ${running} running...`,
      },
    ],
    details: makeDetails('parallel')([]),
  }
}

function buildParallelTooManyResponse(
  count: number,
  makeDetails: MakeDetails,
): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: `Too many parallel tasks (${count}). Max is ${MAX_PARALLEL_TASKS}.`,
      },
    ],
    details: makeDetails('parallel')([]),
  }
}

function getResultStatus(result: SingleResult): string {
  if (isFailedResult(result)) {
    return result.stopReason && result.stopReason !== 'end'
      ? `failed (${result.stopReason})`
      : 'failed'
  }
  return 'completed'
}

function buildParallelSummary(result: SingleResult): string {
  const output = truncateParallelOutput(getResultOutput(result))
  const status = getResultStatus(result)
  return `### [${result.agent}] ${status}\n\n${output}`
}

function buildParallelFinalResponse(
  results: SingleResult[],
  makeDetails: MakeDetails,
): ToolResult {
  const successCount = results.filter((r) => !isFailedResult(r)).length
  const summaries = results.map((r) => buildParallelSummary(r))
  return {
    content: [
      {
        type: 'text',
        text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join('\n\n---\n\n')}`,
      },
    ],
    details: makeDetails('parallel')(results),
  }
}

export async function handleParallelMode(
  parameters: SubagentParametersType,
  context: ToolContext,
  agents: AgentConfig[],
  signal: AbortSignal | undefined,
  onUpdate: UpdateCallback | undefined,
  makeDetails: MakeDetails,
): Promise<ToolResult> {
  const tasks = parameters.tasks
  if (!tasks || tasks.length === 0) {
    throw new Error('Missing tasks in parallel mode')
  }
  const settings = await loadCradleSettings(context.cwd)
  if (tasks.length > MAX_PARALLEL_TASKS) {
    return buildParallelTooManyResponse(tasks.length, makeDetails)
  }

  const allResults: SingleResult[] = tasks.map((t) =>
    createParallelPlaceholder(t.agent, t.task),
  )

  const emitUpdate = () => {
    if (onUpdate) {
      const running = allResults.filter((r) => r.exitCode === -1).length
      const done = allResults.filter((r) => r.exitCode !== -1).length
      onUpdate(
        buildParallelProgressUpdate(
          done,
          allResults.length,
          running,
          makeDetails,
        ),
      )
    }
  }

  const results = await mapWithConcurrencyLimit(
    tasks,
    MAX_CONCURRENCY,
    async (t, index) => {
      const result = await runSingleAgent({
        defaultCwd: context.cwd,
        agents,
        agentName: t.agent,
        task: t.task,
        cwd: t.cwd,
        step: undefined,
        signal,
        onUpdate: (partial) => {
          const currentResult = partial.details.results[0]
          if (currentResult) {
            allResults[index] = currentResult
            emitUpdate()
          }
        },
        makeDetails: makeDetails('parallel'),
        complexity: t.complexity,
        settings,
      })
      allResults[index] = result
      emitUpdate()
      return result
    },
  )

  return buildParallelFinalResponse(results, makeDetails)
}
