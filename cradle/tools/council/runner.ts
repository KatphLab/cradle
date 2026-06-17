import { loadCradleSettings } from '../../config/settings.js'
import { runSingleAgent } from '../../lib/subagents/runner.js'
import type {
  AgentConfig,
  SingleResult,
  TaskComplexity,
} from '../../lib/subagents/types.js'
import {
  getFinalOutput,
  isFailedResult,
} from '../../lib/subagents/utilities.js'
import {
  ARCHITECT_PROMPT,
  buildSynthesisUserMessage,
  buildVoiceUserMessage,
  CRITIC_PROMPT,
  PRAGMATIST_PROMPT,
  SKEPTIC_PROMPT,
  SYNTHESIS_PROMPT,
} from './prompt.js'

const VOICE_TOOLS = ['read', 'ls', 'grep', 'glob']

const ARCHITECT_AGENT: AgentConfig = {
  name: 'council-architect',
  description:
    'Architect voice on the decision council — correctness, maintainability, long-term',
  tools: VOICE_TOOLS,
  systemPrompt: ARCHITECT_PROMPT,
  source: 'extension',
  filePath: '',
}

const SKEPTIC_AGENT: AgentConfig = {
  name: 'council-skeptic',
  description:
    'Skeptic voice on the decision council — premise challenge, simplification',
  tools: VOICE_TOOLS,
  systemPrompt: SKEPTIC_PROMPT,
  source: 'extension',
  filePath: '',
}

const PRAGMATIST_AGENT: AgentConfig = {
  name: 'council-pragmatist',
  description:
    'Pragmatist voice on the decision council — speed, user impact, operational reality',
  tools: VOICE_TOOLS,
  systemPrompt: PRAGMATIST_PROMPT,
  source: 'extension',
  filePath: '',
}

const CRITIC_AGENT: AgentConfig = {
  name: 'council-critic',
  description:
    'Critic voice on the decision council — edge cases, downside risk, failure modes',
  tools: VOICE_TOOLS,
  systemPrompt: CRITIC_PROMPT,
  source: 'extension',
  filePath: '',
}

const SYNTHESIS_AGENT: AgentConfig = {
  name: 'council-synthesis',
  description:
    'Synthesizer on the decision council — merges four independent voices into a structured verdict',
  tools: [],
  systemPrompt: SYNTHESIS_PROMPT,
  source: 'extension',
  filePath: '',
}

function buildSubagentModels(model: string | undefined) {
  return {
    ...(model !== undefined && { low: model }),
    ...(model !== undefined && { medium: model }),
    ...(model !== undefined && { high: model }),
  }
}

function resolveCouncilModel(
  settings: {
    subagentModels?: { low?: string; medium?: string; high?: string }
  },
  complexity: TaskComplexity,
): string | undefined {
  return settings.subagentModels?.[complexity]
}

interface VoiceResult {
  voice: string
  output: string
  result: SingleResult
  error: string | undefined
}

export interface CouncilOutput {
  verdict: string
  voiceResults: VoiceResult[]
  error: string | undefined
}

const makeSingleDetails = (results: SingleResult[]) => ({
  mode: 'single' as const,
  projectAgentsDir: undefined,
  results,
})

function getErrorOutput(result: SingleResult): string {
  if (result.errorMessage) return result.errorMessage
  if (result.stderr) return result.stderr
  return `${result.agent} failed`
}

async function runVoiceAgent(parameters: {
  agent: AgentConfig
  voice: string
  userMessage: string
  cwd: string
  complexity: TaskComplexity
  model: string | undefined
  signal: AbortSignal | undefined
}): Promise<VoiceResult> {
  try {
    const result = await runSingleAgent({
      defaultCwd: parameters.cwd,
      agents: [parameters.agent],
      agentName: parameters.agent.name,
      task: parameters.userMessage,
      cwd: parameters.cwd,
      sessionId: undefined,
      step: undefined,
      signal: parameters.signal,
      onUpdate: undefined,
      makeDetails: makeSingleDetails,
      complexity: parameters.complexity,
      settings: { subagentModels: buildSubagentModels(parameters.model) },
    })

    if (isFailedResult(result)) {
      return {
        voice: parameters.voice,
        output: '',
        result,
        error: getErrorOutput(result),
      }
    }

    // Voice agent completed successfully
    const output = getFinalOutput(result.messages)
    return {
      voice: parameters.voice,
      output: output.length > 0 ? output : '(no output)',
      result,
      error: undefined,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      voice: parameters.voice,
      output: '',
      result: {
        agent: parameters.agent.name,
        agentSource: 'unknown',
        task: parameters.userMessage,
        exitCode: 1,
        messages: [],
        stderr: errorMessage,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0,
          contextTokens: 0,
          turns: 0,
        },
      },
      error: errorMessage,
    }
  }
}

interface VoiceLaunchResult {
  voiceResults: VoiceResult[]
  error: string | undefined
}

async function launchCouncilVoices(parameters: {
  question: string
  context: string | undefined
  complexity: TaskComplexity
  cwd: string
  model: string | undefined
  signal: AbortSignal | undefined
}): Promise<VoiceLaunchResult> {
  const userMessage = buildVoiceUserMessage({
    question: parameters.question,
    context: parameters.context,
  })

  const voiceAgents: { agent: AgentConfig; voice: string }[] = [
    { agent: ARCHITECT_AGENT, voice: 'Architect' },
    { agent: SKEPTIC_AGENT, voice: 'Skeptic' },
    { agent: PRAGMATIST_AGENT, voice: 'Pragmatist' },
    { agent: CRITIC_AGENT, voice: 'Critic' },
  ]

  const voiceResults = await Promise.all(
    voiceAgents.map(({ agent, voice }) =>
      runVoiceAgent({
        agent,
        voice,
        userMessage,
        cwd: parameters.cwd,
        complexity: parameters.complexity,
        model: parameters.model,
        signal: parameters.signal,
      }),
    ),
  )

  const errors = voiceResults.filter((v) => v.error !== undefined)
  if (errors.length === voiceResults.length) {
    const errorMessages = errors
      .map((error) => `${error.voice}: ${error.error ?? 'unknown'}`)
      .join('; ')
    return {
      voiceResults,
      error: `All council voices failed: ${errorMessages}`,
    }
  }

  return { voiceResults, error: undefined }
}

function getVoiceText(voice: VoiceResult | undefined, name: string): string {
  if (voice === undefined) return `Error: ${name} voice produced no output`
  return voice.error === undefined ? voice.output : `Error: ${voice.error}`
}

async function runSynthesis(parameters: {
  question: string
  context: string | undefined
  voiceResults: VoiceResult[]
  complexity: TaskComplexity
  cwd: string
  model: string | undefined
  signal: AbortSignal | undefined
}): Promise<{ verdict: string; error: string | undefined }> {
  const architect = parameters.voiceResults[0]
  const skeptic = parameters.voiceResults[1]
  const pragmatist = parameters.voiceResults[2]
  const critic = parameters.voiceResults[3]

  const synthesisMessage = buildSynthesisUserMessage({
    question: parameters.question,
    context: parameters.context,
    architectResponse: getVoiceText(architect, 'Architect'),
    skepticResponse: getVoiceText(skeptic, 'Skeptic'),
    pragmatistResponse: getVoiceText(pragmatist, 'Pragmatist'),
    criticResponse: getVoiceText(critic, 'Critic'),
  })

  const synthesisSettings = {
    subagentModels: buildSubagentModels(parameters.model),
  }
  const synthesisResult = await runSingleAgent({
    defaultCwd: parameters.cwd,
    agents: [SYNTHESIS_AGENT],
    agentName: SYNTHESIS_AGENT.name,
    task: synthesisMessage,
    cwd: parameters.cwd,
    sessionId: undefined,
    step: undefined,
    signal: parameters.signal,
    onUpdate: undefined,
    makeDetails: makeSingleDetails,
    complexity: parameters.complexity,
    settings: synthesisSettings,
  })

  if (isFailedResult(synthesisResult)) {
    return {
      verdict: '',
      error: `Synthesis failed: ${getErrorOutput(synthesisResult)}`,
    }
  }

  const verdict = getFinalOutput(synthesisResult.messages)
  return {
    verdict: verdict.length > 0 ? verdict : '(no verdict produced)',
    error: undefined,
  }
}

export async function runCouncil(parameters: {
  question: string
  context: string | undefined
  complexity: TaskComplexity
  cwd: string
  signal: AbortSignal | undefined
}): Promise<CouncilOutput> {
  const settings = await loadCradleSettings(parameters.cwd)
  const model = resolveCouncilModel(settings, parameters.complexity)

  const voiceLaunch = await launchCouncilVoices({
    question: parameters.question,
    context: parameters.context,
    complexity: parameters.complexity,
    cwd: parameters.cwd,
    model,
    signal: parameters.signal,
  })

  if (voiceLaunch.error !== undefined) {
    return {
      verdict: '',
      voiceResults: voiceLaunch.voiceResults,
      error: voiceLaunch.error,
    }
  }

  try {
    const synthesis = await runSynthesis({
      question: parameters.question,
      context: parameters.context,
      voiceResults: voiceLaunch.voiceResults,
      complexity: parameters.complexity,
      cwd: parameters.cwd,
      model,
      signal: parameters.signal,
    })
    return {
      verdict: synthesis.verdict,
      voiceResults: voiceLaunch.voiceResults,
      error: synthesis.error,
    }
  } catch (error) {
    return {
      verdict: '',
      voiceResults: voiceLaunch.voiceResults,
      error: `Synthesis error: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
