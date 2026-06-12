import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ORCHESTRATOR_MODE_TOOLS } from '../../utils/orchestrator-state.js'
import { registerOrchestratorModeHook } from '../orchestrator-mode.js'

const ALL_TOOL_NAMES = ['read', 'write', 'bash']
const DECISION_STOP_LINE = 'CRADLE_ORCHESTRATOR_DECISION: STOP'
const DECISION_CONTINUE_LINE = 'CRADLE_ORCHESTRATOR_DECISION: CONTINUE'

function createMockOrchestratorModeState(): {
  isEnabled: () => boolean
  setEnabled: (enabled: boolean) => void
} {
  let enabled = false
  return {
    isEnabled: () => enabled,
    setEnabled: (v: boolean) => {
      enabled = v
    },
  }
}

function registerHook() {
  const handlers: { event: string; fn: unknown }[] = []
  const setActiveTools = vi.fn()
  const sendUserMessage = vi.fn()
  const pi: Pick<
    ExtensionAPI,
    'on' | 'getAllTools' | 'setActiveTools' | 'sendUserMessage'
  > = {
    on: (event, handler) => {
      handlers.push({ event, fn: handler })
    },
    getAllTools: () =>
      ALL_TOOL_NAMES.map((name) => ({
        name,
        description: `${name} description`,
        parameters: { type: 'object', properties: {} },
        sourceInfo: {
          path: `<test:${name}>`,
          source: 'builtin',
          scope: 'temporary',
          origin: 'top-level',
        },
      })),
    setActiveTools,
    sendUserMessage,
  }
  const state = createMockOrchestratorModeState()

  registerOrchestratorModeHook(pi, state)

  return { handlers, sendUserMessage, setActiveTools, state }
}

function getHandler(handlers: { event: string; fn: unknown }[], event: string) {
  const handler = handlers.find((entry) => entry.event === event)
  expect(handler).toBeDefined()
  return handler?.fn
}

function createContext(entries: unknown[]) {
  return {
    sessionManager: { getEntries: () => entries },
    ui: {
      setStatus: vi.fn(),
      theme: { fg: (_color: string, text: string) => text },
    },
  }
}

function userText(text: string) {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
  }
}

function assistantText(text: string) {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
  }
}

function getSentPrompt(sendUserMessage: ReturnType<typeof vi.fn>): string {
  const call = sendUserMessage.mock.calls.at(-1)
  expect(call).toBeDefined()
  const prompt = call?.[0]
  expect(typeof prompt).toBe('string')
  return typeof prompt === 'string' ? prompt : ''
}

function getPromptId(prompt: string): string {
  const match = /<cradle-orchestrator-(?:review|continue) id="([^"]+)">/u.exec(
    prompt,
  )
  expect(match).not.toBeNull()
  const promptId = match?.[1]
  expect(promptId).toBeDefined()
  return promptId ?? ''
}

describe('registerOrchestratorModeHook', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('restores orchestrator mode on session start when enabled', async () => {
    const { handlers, setActiveTools } = registerHook()
    const sessionStart = getHandler(handlers, 'session_start')
    const context = createContext([
      {
        type: 'custom',
        customType: 'cradle-orchestrator-mode',
        data: { enabled: true },
      },
    ])

    // @ts-expect-error minimal handler mock
    await sessionStart?.({}, context)

    expect(setActiveTools).toHaveBeenCalledWith(ORCHESTRATOR_MODE_TOOLS)
    expect(context.ui.setStatus).toHaveBeenCalledWith(
      'orchestrator-mode',
      'orch',
    )
  })

  it('enables all registered tools on session start when orchestrator mode is disabled', async () => {
    const { handlers, setActiveTools } = registerHook()
    const sessionStart = getHandler(handlers, 'session_start')
    const context = createContext([])

    // @ts-expect-error minimal handler mock
    await sessionStart?.({}, context)

    expect(setActiveTools).toHaveBeenCalledWith(ALL_TOOL_NAMES)
    expect(context.ui.setStatus).toHaveBeenCalledWith(
      'orchestrator-mode',
      undefined,
    )
  })

  it('appends the orchestrator system prompt only while enabled', () => {
    const { handlers, state } = registerHook()
    const beforeAgentStart = getHandler(handlers, 'before_agent_start')

    // @ts-expect-error minimal handler mock
    expect(beforeAgentStart?.({ systemPrompt: 'base' }, {})).toBeUndefined()

    state.setEnabled(true)
    // @ts-expect-error minimal handler mock
    const result = beforeAgentStart?.({ systemPrompt: 'base' }, {})

    expect(result).toEqual({
      systemPrompt: expect.stringContaining(
        'You are operating in orchestrator mode.',
      ),
    })
  })

  it('asks for a self-review after an enabled orchestrator turn', () => {
    const { handlers, sendUserMessage, state } = registerHook()
    const agentEnd = getHandler(handlers, 'agent_end')

    state.setEnabled(true)
    // @ts-expect-error minimal handler mock
    agentEnd?.(
      { messages: [userText('Do the work'), assistantText('Done')] },
      {},
    )

    expect(sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining('Review your work against the user'),
      { deliverAs: 'followUp' },
    )
    expect(getSentPrompt(sendUserMessage)).toContain(DECISION_STOP_LINE)
    expect(getSentPrompt(sendUserMessage)).toContain(DECISION_CONTINUE_LINE)
  })

  it('does not ask for a self-review when orchestrator mode is disabled', () => {
    const { handlers, sendUserMessage } = registerHook()
    const agentEnd = getHandler(handlers, 'agent_end')

    // @ts-expect-error minimal handler mock
    agentEnd?.(
      { messages: [userText('Do the work'), assistantText('Done')] },
      {},
    )

    expect(sendUserMessage).not.toHaveBeenCalled()
  })

  it('stops after a valid self-review stop decision', () => {
    const { handlers, sendUserMessage, state } = registerHook()
    const agentEnd = getHandler(handlers, 'agent_end')

    state.setEnabled(true)
    // @ts-expect-error minimal handler mock
    agentEnd?.(
      { messages: [userText('Do the work'), assistantText('Done')] },
      {},
    )
    const reviewPrompt = getSentPrompt(sendUserMessage)

    // @ts-expect-error minimal handler mock
    agentEnd?.({
      messages: [
        userText(reviewPrompt),
        assistantText(`Looks complete.\n${DECISION_STOP_LINE}`),
      ],
    })

    expect(sendUserMessage).toHaveBeenCalledTimes(1)
  })

  it('continues after a valid self-review continue decision', () => {
    const { handlers, sendUserMessage, state } = registerHook()
    const agentEnd = getHandler(handlers, 'agent_end')

    state.setEnabled(true)
    // @ts-expect-error minimal handler mock
    agentEnd?.(
      { messages: [userText('Do the work'), assistantText('Done')] },
      {},
    )
    const reviewPrompt = getSentPrompt(sendUserMessage)

    // @ts-expect-error minimal handler mock
    agentEnd?.({
      messages: [
        userText(reviewPrompt),
        assistantText(`Need more review.\n${DECISION_CONTINUE_LINE}`),
      ],
    })

    expect(sendUserMessage).toHaveBeenCalledTimes(2)
    expect(getSentPrompt(sendUserMessage)).toContain(
      '<cradle-orchestrator-continue',
    )
  })

  it('asks for another self-review after a continuation turn', () => {
    const { handlers, sendUserMessage, state } = registerHook()
    const agentEnd = getHandler(handlers, 'agent_end')

    state.setEnabled(true)
    // @ts-expect-error minimal handler mock
    agentEnd?.(
      { messages: [userText('Do the work'), assistantText('Done')] },
      {},
    )
    const reviewPrompt = getSentPrompt(sendUserMessage)
    // @ts-expect-error minimal handler mock
    agentEnd?.({
      messages: [
        userText(reviewPrompt),
        assistantText(`Need more review.\n${DECISION_CONTINUE_LINE}`),
      ],
    })
    const continuePrompt = getSentPrompt(sendUserMessage)

    // @ts-expect-error minimal handler mock
    agentEnd?.({
      messages: [userText(continuePrompt), assistantText('Continued work')],
    })

    expect(sendUserMessage).toHaveBeenCalledTimes(3)
    expect(getSentPrompt(sendUserMessage)).toContain(
      '<cradle-orchestrator-review',
    )
  })

  it('caps continuation cycles to prevent infinite loops', () => {
    const { handlers, sendUserMessage, state } = registerHook()
    const agentEnd = getHandler(handlers, 'agent_end')

    state.setEnabled(true)
    // @ts-expect-error minimal handler mock
    agentEnd?.(
      { messages: [userText('Do the work'), assistantText('Done')] },
      {},
    )
    for (const step of [1, 2]) {
      const reviewPrompt = getSentPrompt(sendUserMessage)
      // @ts-expect-error minimal handler mock
      agentEnd?.({
        messages: [
          userText(reviewPrompt),
          assistantText(`Need more work ${step}.\n${DECISION_CONTINUE_LINE}`),
        ],
      })
      const continuePrompt = getSentPrompt(sendUserMessage)
      // @ts-expect-error minimal handler mock
      agentEnd?.({
        messages: [
          userText(continuePrompt),
          assistantText(`Continued work ${step}`),
        ],
      })
    }
    const finalReviewPrompt = getSentPrompt(sendUserMessage)

    // @ts-expect-error minimal handler mock
    agentEnd?.({
      messages: [
        userText(finalReviewPrompt),
        assistantText(`Still wants more.\n${DECISION_CONTINUE_LINE}`),
      ],
    })

    expect(sendUserMessage).toHaveBeenCalledTimes(5)
  })

  it('fails closed when the review decision format is invalid', () => {
    const { handlers, sendUserMessage, state } = registerHook()
    const agentEnd = getHandler(handlers, 'agent_end')

    state.setEnabled(true)
    // @ts-expect-error minimal handler mock
    agentEnd?.(
      { messages: [userText('Do the work'), assistantText('Done')] },
      {},
    )
    const reviewPrompt = getSentPrompt(sendUserMessage)

    // @ts-expect-error minimal handler mock
    agentEnd?.({
      messages: [userText(reviewPrompt), assistantText('I should continue')],
    })

    expect(sendUserMessage).toHaveBeenCalledTimes(1)
  })

  it('ignores stale injected prompts without matching runtime state', () => {
    const { handlers, sendUserMessage, state } = registerHook()
    const agentEnd = getHandler(handlers, 'agent_end')

    state.setEnabled(true)
    // @ts-expect-error minimal handler mock
    agentEnd?.({
      messages: [
        userText(
          '<cradle-orchestrator-review id="stale">old</cradle-orchestrator-review>',
        ),
        assistantText(`Looks complete.\n${DECISION_STOP_LINE}`),
      ],
    })

    expect(sendUserMessage).not.toHaveBeenCalled()
  })

  it('does not duplicate review prompts for the same agent_end event', () => {
    const { handlers, sendUserMessage, state } = registerHook()
    const agentEnd = getHandler(handlers, 'agent_end')
    const event = {
      messages: [userText('Do the work'), assistantText('Done')],
    }

    state.setEnabled(true)
    // @ts-expect-error minimal handler mock
    agentEnd?.(event, {})
    // @ts-expect-error minimal handler mock
    agentEnd?.(event, {})

    expect(sendUserMessage).toHaveBeenCalledTimes(1)
  })

  it('starts a fresh review when a human prompt interrupts a pending review', () => {
    const { handlers, sendUserMessage, state } = registerHook()
    const agentEnd = getHandler(handlers, 'agent_end')

    state.setEnabled(true)
    // @ts-expect-error minimal handler mock
    agentEnd?.(
      { messages: [userText('Do the work'), assistantText('Done')] },
      {},
    )
    const originalPromptId = getPromptId(getSentPrompt(sendUserMessage))

    // @ts-expect-error minimal handler mock
    agentEnd?.({
      messages: [userText('Actually, do another thing'), assistantText('Done')],
    })

    expect(sendUserMessage).toHaveBeenCalledTimes(2)
    expect(getPromptId(getSentPrompt(sendUserMessage))).not.toBe(
      originalPromptId,
    )
  })

  it('blocks mutation tools while enabled', () => {
    const { handlers, state } = registerHook()
    const toolCall = getHandler(handlers, 'tool_call')

    state.setEnabled(true)
    // @ts-expect-error minimal handler mock
    const result = toolCall?.({ toolName: 'bash' }, {})

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining(
        'Orchestrator mode blocks bash, edit, and write',
      ),
    })
  })

  it('blocks edit while enabled', () => {
    const { handlers, state } = registerHook()
    const toolCall = getHandler(handlers, 'tool_call')

    state.setEnabled(true)
    // @ts-expect-error minimal handler mock
    const result = toolCall?.({ toolName: 'edit' }, {})

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining(
        'Orchestrator mode blocks bash, edit, and write',
      ),
    })
  })

  it('blocks write while enabled', () => {
    const { handlers, state } = registerHook()
    const toolCall = getHandler(handlers, 'tool_call')

    state.setEnabled(true)
    // @ts-expect-error minimal handler mock
    const result = toolCall?.({ toolName: 'write' }, {})

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining(
        'Orchestrator mode blocks bash, edit, and write',
      ),
    })
  })

  it('allows read tools while enabled', () => {
    const { handlers, state } = registerHook()
    const toolCall = getHandler(handlers, 'tool_call')

    state.setEnabled(true)
    // @ts-expect-error minimal handler mock
    expect(toolCall?.({ toolName: 'read' }, {})).toBeUndefined()
  })

  it('allows subagent tool while enabled', () => {
    const { handlers, state } = registerHook()
    const toolCall = getHandler(handlers, 'tool_call')

    state.setEnabled(true)
    // @ts-expect-error minimal handler mock
    expect(toolCall?.({ toolName: 'subagent' }, {})).toBeUndefined()
  })

  it('allows discover-agents while enabled', () => {
    const { handlers, state } = registerHook()
    const toolCall = getHandler(handlers, 'tool_call')

    state.setEnabled(true)
    // @ts-expect-error minimal handler mock
    expect(toolCall?.({ toolName: 'discover-agents' }, {})).toBeUndefined()
  })

  it('returns early for tool_call when orchestrator mode is disabled', () => {
    const { handlers } = registerHook()
    const toolCall = getHandler(handlers, 'tool_call')

    // @ts-expect-error minimal handler mock
    const result = toolCall?.({ toolName: 'bash' }, {})
    expect(result).toBeUndefined()
  })

  it('excludes web_fetch from restored tools when orchestrator mode is disabled', async () => {
    const handlers: { event: string; fn: unknown }[] = []
    const setActiveTools = vi.fn()
    const sendUserMessage = vi.fn()
    const piWithWebFetch: Pick<
      ExtensionAPI,
      'on' | 'getAllTools' | 'setActiveTools' | 'sendUserMessage'
    > = {
      on: (event, handler) => {
        handlers.push({ event, fn: handler })
      },
      getAllTools: () =>
        ['read', 'write', 'web_fetch_internal'].map((name) => ({
          name,
          description: `${name} description`,
          parameters: { type: 'object', properties: {} },
          sourceInfo: {
            path: `<test:${name}>`,
            source: 'builtin',
            scope: 'temporary',
            origin: 'top-level',
          },
        })),
      setActiveTools,
      sendUserMessage,
    }
    const state = createMockOrchestratorModeState()
    registerOrchestratorModeHook(piWithWebFetch, state)

    const sessionStart = getHandler(handlers, 'session_start')
    const context = createContext([])
    // @ts-expect-error minimal handler mock
    await sessionStart?.({}, context)

    expect(setActiveTools).toHaveBeenCalledWith(['read', 'write'])
  })
})
