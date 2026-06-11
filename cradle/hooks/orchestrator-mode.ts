import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'

import { ORCHESTRATOR_MODE_SYSTEM_PROMPT } from '../prompts/orchestrator.js'
import {
  registerBeforeAgentStartPrompt,
  restoreToolMode,
  type ModeState,
} from '../utils/mode-helpers.js'
import {
  ORCHESTRATOR_MODE_TOOLS,
  restoreOrchestratorModeEnabled,
  type OrchestratorModeState,
} from '../utils/orchestrator-state.js'

const MUTATION_TOOLS = new Set(['bash', 'edit', 'write'])
const MAX_CONTINUATION_CYCLES = 2
const REVIEW_TAG_START = '<cradle-orchestrator-review id="'
const CONTINUE_TAG_START = '<cradle-orchestrator-continue id="'
const REVIEW_TAG_END = '</cradle-orchestrator-review>'
const CONTINUE_TAG_END = '</cradle-orchestrator-continue>'
const DECISION_STOP_LINE = 'CRADLE_ORCHESTRATOR_DECISION: STOP'
const DECISION_CONTINUE_LINE = 'CRADLE_ORCHESTRATOR_DECISION: CONTINUE'

type ReviewPhase = 'idle' | 'awaitingReviewDecision' | 'awaitingContinueTurn'
type InjectedPromptKind = 'review' | 'continue'
type ReviewDecision = 'stop' | 'continue'

interface ReviewLoopState {
  phase: ReviewPhase
  promptId: string
  promptSequence: number
  continuationCycles: number
  lastProcessedAgentEndKey: string
}

interface MessageLike {
  role?: unknown
  content?: unknown
}

interface InjectedPrompt {
  kind: InjectedPromptKind
  id: string
}

function createReviewLoopState(): ReviewLoopState {
  return {
    phase: 'idle',
    promptId: '',
    promptSequence: 0,
    continuationCycles: 0,
    lastProcessedAgentEndKey: '',
  }
}

function resetReviewLoop(state: ReviewLoopState): void {
  state.phase = 'idle'
  state.promptId = ''
  state.continuationCycles = 0
}

function resetReviewLoopSession(state: ReviewLoopState): void {
  resetReviewLoop(state)
  state.promptSequence = 0
  state.lastProcessedAgentEndKey = ''
}

function updateOrchestratorStatus(
  context: ExtensionContext,
  enabled: boolean,
): void {
  context.ui.setStatus(
    'orchestrator-mode',
    enabled ? context.ui.theme.fg('accent', 'orch') : undefined,
  )
}

function restoreTools(
  pi: Pick<ExtensionAPI, 'getAllTools' | 'setActiveTools'>,
  context: ExtensionContext,
  state: ModeState,
): void {
  restoreToolMode(
    pi,
    context,
    state,
    ORCHESTRATOR_MODE_TOOLS,
    updateOrchestratorStatus,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isMessageLike(value: unknown): value is MessageLike {
  return isRecord(value)
}

function getLastMessageByRole(
  messages: readonly unknown[],
  role: string,
): MessageLike | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!isMessageLike(message)) continue
    if (message.role === role) return message
  }
  return undefined
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  const parts: string[] = []
  for (const part of content) {
    if (!isRecord(part)) continue
    if (part['type'] !== 'text') continue
    const text = part['text']
    if (typeof text === 'string') parts.push(text)
  }
  return parts.join('\n')
}

function getLastMessageText(
  messages: readonly unknown[],
  role: string,
): string {
  const message = getLastMessageByRole(messages, role)
  if (message === undefined) return ''
  return textFromContent(message.content)
}

function getAgentEndKey(messages: readonly unknown[]): string {
  return [
    String(messages.length),
    getLastMessageText(messages, 'user'),
    getLastMessageText(messages, 'assistant'),
  ].join('\u0000')
}

function extractPromptId(text: string, tagStart: string): string | undefined {
  if (!text.startsWith(tagStart)) return undefined

  const remainder = text.slice(tagStart.length)
  const tagEndIndex = remainder.indexOf('">')
  if (tagEndIndex <= 0) return undefined

  return remainder.slice(0, tagEndIndex)
}

function getInjectedPrompt(text: string): InjectedPrompt | undefined {
  const reviewId = extractPromptId(text, REVIEW_TAG_START)
  if (reviewId !== undefined) {
    return { kind: 'review', id: reviewId }
  }

  const continueId = extractPromptId(text, CONTINUE_TAG_START)
  if (continueId !== undefined) {
    return { kind: 'continue', id: continueId }
  }

  return undefined
}

function getFinalNonEmptyLine(text: string): string | undefined {
  const lines = text.split(/\r?\n/u)
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]
    if (line === undefined) continue
    const trimmedLine = line.trim()
    if (trimmedLine.length > 0) return trimmedLine
  }
  return undefined
}

function parseReviewDecision(text: string): ReviewDecision | undefined {
  const finalLine = getFinalNonEmptyLine(text)
  if (finalLine === DECISION_STOP_LINE) return 'stop'
  if (finalLine === DECISION_CONTINUE_LINE) return 'continue'
  return undefined
}

function createPromptId(state: ReviewLoopState): string {
  state.promptSequence += 1
  return `orch-review-${state.promptSequence}`
}

function createReviewPrompt(promptId: string): string {
  return `${REVIEW_TAG_START}${promptId}">
Review your work against the user's request and decide whether to stop or continue.

Check whether the request is fully satisfied, whether any required tests/checks/docs remain, and whether there are concrete next actions you can take with orchestrator-mode tools or subagents.

Respond briefly with your assessment. Your final non-empty line must be exactly one of:
${DECISION_STOP_LINE}
${DECISION_CONTINUE_LINE}

Choose CONTINUE only when you can make concrete progress. Otherwise choose STOP.
${REVIEW_TAG_END}`
}

function createContinuePrompt(promptId: string): string {
  return `${CONTINUE_TAG_START}${promptId}">
Continue addressing the gaps you identified in your review. Use orchestrator-mode tools and subagents as needed. When this continuation is complete, stop normally; you will be asked to review again.
${CONTINUE_TAG_END}`
}

function sendReviewPrompt(
  pi: Pick<ExtensionAPI, 'sendUserMessage'>,
  state: ReviewLoopState,
): void {
  const promptId =
    state.promptId.length > 0 ? state.promptId : createPromptId(state)
  state.promptId = promptId
  state.phase = 'awaitingReviewDecision'
  pi.sendUserMessage(createReviewPrompt(promptId), { deliverAs: 'followUp' })
}

function sendInitialReviewPrompt(
  pi: Pick<ExtensionAPI, 'sendUserMessage'>,
  state: ReviewLoopState,
): void {
  resetReviewLoop(state)
  sendReviewPrompt(pi, state)
}

function sendContinuePrompt(
  pi: Pick<ExtensionAPI, 'sendUserMessage'>,
  state: ReviewLoopState,
): void {
  state.phase = 'awaitingContinueTurn'
  state.continuationCycles += 1
  pi.sendUserMessage(createContinuePrompt(state.promptId), {
    deliverAs: 'followUp',
  })
}

function isExpectedPrompt(
  state: ReviewLoopState,
  injectedPrompt: InjectedPrompt | undefined,
  kind: InjectedPromptKind,
): boolean {
  return injectedPrompt?.kind === kind && injectedPrompt.id === state.promptId
}

function handleReviewDecision(
  pi: Pick<ExtensionAPI, 'sendUserMessage'>,
  state: ReviewLoopState,
  assistantText: string,
): void {
  const decision = parseReviewDecision(assistantText)
  if (decision !== 'continue') {
    resetReviewLoop(state)
    return
  }

  if (state.continuationCycles >= MAX_CONTINUATION_CYCLES) {
    resetReviewLoop(state)
    return
  }

  sendContinuePrompt(pi, state)
}

function handleAgentEnd(
  pi: Pick<ExtensionAPI, 'sendUserMessage'>,
  state: OrchestratorModeState,
  reviewState: ReviewLoopState,
  messages: readonly unknown[],
): void {
  if (!state.isEnabled()) {
    resetReviewLoop(reviewState)
    return
  }

  const eventKey = getAgentEndKey(messages)
  if (eventKey === reviewState.lastProcessedAgentEndKey) return
  reviewState.lastProcessedAgentEndKey = eventKey

  const userText = getLastMessageText(messages, 'user')
  const assistantText = getLastMessageText(messages, 'assistant')
  if (userText.length === 0 || assistantText.length === 0) return

  const injectedPrompt = getInjectedPrompt(userText)
  if (reviewState.phase === 'awaitingReviewDecision') {
    if (isExpectedPrompt(reviewState, injectedPrompt, 'review')) {
      handleReviewDecision(pi, reviewState, assistantText)
      return
    }
    sendInitialReviewPrompt(pi, reviewState)
    return
  }

  if (reviewState.phase === 'awaitingContinueTurn') {
    if (isExpectedPrompt(reviewState, injectedPrompt, 'continue')) {
      sendReviewPrompt(pi, reviewState)
      return
    }
    sendInitialReviewPrompt(pi, reviewState)
    return
  }

  if (injectedPrompt !== undefined) return
  sendInitialReviewPrompt(pi, reviewState)
}

/** @public */
export function registerOrchestratorModeHook(
  pi: Pick<
    ExtensionAPI,
    'on' | 'getAllTools' | 'setActiveTools' | 'sendUserMessage'
  >,
  state: OrchestratorModeState,
): void {
  const reviewState = createReviewLoopState()

  pi.on('session_start', (_event, context) => {
    resetReviewLoopSession(reviewState)
    state.setEnabled(
      restoreOrchestratorModeEnabled(context.sessionManager.getEntries()),
    )
    restoreTools(pi, context, state)
  })

  registerBeforeAgentStartPrompt(pi, state, ORCHESTRATOR_MODE_SYSTEM_PROMPT)

  pi.on('agent_end', (event) => {
    handleAgentEnd(pi, state, reviewState, event.messages)
  })

  pi.on('tool_call', (event) => {
    if (!state.isEnabled()) return
    if (!MUTATION_TOOLS.has(event.toolName)) return

    return {
      block: true,
      reason:
        'Orchestrator mode blocks bash, edit, and write. Disable orchestrator mode to mutate implementation files.',
    }
  })
}
