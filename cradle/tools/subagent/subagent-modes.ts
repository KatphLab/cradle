import type {
  AgentToolResult,
  AgentToolUpdateCallback,
} from '@earendil-works/pi-agent-core'
import { StringEnum } from '@earendil-works/pi-ai'
import { Type, type Static } from 'typebox'
import { loadCradleSettings } from '../../config/settings.js'
import { runSingleAgent } from '../../lib/subagents/runner.js'
import type {
  AgentConfig,
  SingleResult,
  SubagentDetails,
  TaskComplexity,
} from '../../lib/subagents/types.js'
import {
  getFinalOutput,
  getResultOutput,
  isFailedResult,
  mapWithConcurrencyLimit,
  MAX_CONCURRENCY,
  MAX_PARALLEL_TASKS,
  truncateParallelOutput,
} from '../../lib/subagents/utilities.js'

const ComplexitySchema = StringEnum(['low', 'medium', 'high'] as const, {
  description: 'Task complexity for model selection',
})

const AgentParameter = Type.String({
  description: 'Name of the agent to invoke',
})
const TaskParameter = Type.String({
  description: 'Task to delegate to the agent',
})
const ChainTaskParameter = Type.String({
  description: 'Task with optional {previous} placeholder for prior output',
})
const CwdParameter = Type.String({
  description: 'Working directory for the agent process',
})
const SessionIdParameter = Type.String({
  description: 'Existing subagent session id to continue',
})

const TaskItem = Type.Object(
  {
    agent: AgentParameter,
    task: TaskParameter,
    complexity: ComplexitySchema,
    cwd: Type.Optional(CwdParameter),
  },
  { additionalProperties: false },
)

const ChainItem = Type.Object(
  {
    agent: AgentParameter,
    task: ChainTaskParameter,
    complexity: ComplexitySchema,
    cwd: Type.Optional(CwdParameter),
  },
  { additionalProperties: false },
)

export const SubagentParameters = Type.Object(
  {
    agent: Type.Optional(AgentParameter),
    task: Type.Optional(TaskParameter),
    complexity: Type.Optional(ComplexitySchema),
    cwd: Type.Optional(CwdParameter),
    sessionId: Type.Optional(SessionIdParameter),
    tasks: Type.Optional(
      Type.Array(TaskItem, {
        description:
          'Array of {agent, task, complexity} for parallel execution',
      }),
    ),
    chain: Type.Optional(
      Type.Array(ChainItem, {
        description:
          'Array of {agent, task, complexity} for sequential execution',
      }),
    ),
  },
  { additionalProperties: false },
)

type TaskItemParameters = Static<typeof TaskItem>
type ChainItemParameters = Static<typeof ChainItem>

export interface SingleModeParameters {
  agent: string
  task: string
  complexity: TaskComplexity
  cwd?: string
  sessionId?: string
}

export interface ParallelModeParameters {
  tasks: TaskItemParameters[]
}

export interface ChainModeParameters {
  chain: ChainItemParameters[]
}
export type SubagentParametersType =
  | SingleModeParameters
  | ParallelModeParameters
  | ChainModeParameters
export type SubagentToolParameters = Static<typeof SubagentParameters>
type SubagentMode = 'single' | 'parallel' | 'chain'

const MODE_SELECTION_ERROR =
  'Specify exactly one subagent mode: single (agent + task), parallel (tasks), or chain (chain).'

function hasSingleModeFields(parameters: SubagentToolParameters): boolean {
  return (
    parameters.agent !== undefined ||
    parameters.task !== undefined ||
    parameters.complexity !== undefined ||
    parameters.cwd !== undefined ||
    parameters.sessionId !== undefined
  )
}

export function resolveSubagentMode(
  parameters: SubagentToolParameters,
): SubagentMode {
  const modes: SubagentMode[] = []
  if (hasSingleModeFields(parameters)) modes.push('single')
  if (parameters.tasks !== undefined) modes.push('parallel')
  if (parameters.chain !== undefined) modes.push('chain')

  const selectedMode = modes[0]
  if (modes.length !== 1 || selectedMode === undefined) {
    throw new Error(MODE_SELECTION_ERROR)
  }

  return selectedMode
}

export function toSingleMode(
  parameters: SubagentToolParameters,
): SingleModeParameters {
  const { agent, task, complexity } = parameters
  if (agent === undefined || task === undefined || complexity === undefined) {
    throw new Error('Missing agent, task, or complexity in single mode')
  }

  const singleParameters: SingleModeParameters = { agent, task, complexity }
  if (parameters.cwd !== undefined) singleParameters.cwd = parameters.cwd
  if (parameters.sessionId !== undefined) {
    singleParameters.sessionId = parameters.sessionId
  }
  return singleParameters
}

export function toParallelMode(
  parameters: SubagentToolParameters,
): ParallelModeParameters {
  const { tasks } = parameters
  if (tasks === undefined) throw new Error('Missing tasks in parallel mode')
  return { tasks }
}

export function toChainMode(
  parameters: SubagentToolParameters,
): ChainModeParameters {
  const { chain } = parameters
  if (chain === undefined) throw new Error('Missing chain in chain mode')
  return { chain }
}

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

export function makeDetailsFactory(
  projectAgentsDirectory: string | undefined,
): MakeDetails {
  return (mode) => (results) => ({
    mode,
    projectAgentsDir: projectAgentsDirectory,
    results,
  })
}

export async function handleSingleMode(
  parameters: SingleModeParameters,
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
    sessionId: parameters.sessionId,
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
  parameters: ChainModeParameters,
  context: ToolContext,
  agents: AgentConfig[],
  signal: AbortSignal | undefined,
  onUpdate: UpdateCallback | undefined,
  makeDetails: MakeDetails,
): Promise<ToolResult> {
  const chain = parameters.chain
  if (chain.length === 0) {
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
      sessionId: undefined,
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
  parameters: ParallelModeParameters,
  context: ToolContext,
  agents: AgentConfig[],
  signal: AbortSignal | undefined,
  onUpdate: UpdateCallback | undefined,
  makeDetails: MakeDetails,
): Promise<ToolResult> {
  const tasks = parameters.tasks
  if (tasks.length === 0) {
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
        sessionId: undefined,
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
