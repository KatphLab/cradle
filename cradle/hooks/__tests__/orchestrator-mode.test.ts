import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { registerOrchestratorModeHook } from '../orchestrator-mode.js'

const ALL_TOOL_NAMES = ['read', 'write', 'bash']
const ORCHESTRATOR_MODE_TOOLS = [
  'read',
  'glob',
  'grep',
  'ls',
  'discover-agents',
  'subagent',
  'todo',
]

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
  const pi: Pick<ExtensionAPI, 'on' | 'getAllTools' | 'setActiveTools'> = {
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
  }
  const state = createMockOrchestratorModeState()

  registerOrchestratorModeHook(pi, state)

  return { handlers, setActiveTools, state }
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
    const piWithWebFetch: Pick<
      ExtensionAPI,
      'on' | 'getAllTools' | 'setActiveTools'
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
