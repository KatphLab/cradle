import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { registerSpecModeHook } from '../spec-mode.js'

const ALL_TOOL_NAMES = ['read', 'write']
const SPEC_MODE_TOOLS = ['read', 'glob', 'grep', 'ls', 'edit', 'write', 'todo']

function createMockSpecModeState(): {
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
  const state = createMockSpecModeState()

  registerSpecModeHook(pi, state)

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

describe('registerSpecModeHook', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('restores spec mode on session start', async () => {
    const { handlers, setActiveTools } = registerHook()
    const sessionStart = getHandler(handlers, 'session_start')
    const context = createContext([
      {
        type: 'custom',
        customType: 'cradle-spec-mode',
        data: { enabled: true },
      },
    ])

    // @ts-expect-error minimal handler mock
    await sessionStart?.({}, context)

    expect(setActiveTools).toHaveBeenCalledWith(SPEC_MODE_TOOLS)
    expect(context.ui.setStatus).toHaveBeenCalledWith('spec-mode', 'spec')
  })

  it('enables all registered tools on session start when spec mode is disabled', async () => {
    const { handlers, setActiveTools } = registerHook()
    const sessionStart = getHandler(handlers, 'session_start')
    const context = createContext([])

    // @ts-expect-error minimal handler mock
    await sessionStart?.({}, context)

    expect(setActiveTools).toHaveBeenCalledWith(ALL_TOOL_NAMES)
    expect(context.ui.setStatus).toHaveBeenCalledWith('spec-mode', undefined)
  })

  it('appends the spec system prompt only while enabled', () => {
    const { handlers, state } = registerHook()
    const beforeAgentStart = getHandler(handlers, 'before_agent_start')

    // @ts-expect-error minimal handler mock
    expect(beforeAgentStart?.({ systemPrompt: 'base' }, {})).toBeUndefined()

    state.setEnabled(true)
    // @ts-expect-error minimal handler mock
    const result = beforeAgentStart?.({ systemPrompt: 'base' }, {})

    expect(result).toEqual({
      systemPrompt: expect.stringContaining(
        'You are operating in a planning-focused specification mode.',
      ),
    })
  })

  it('blocks mutation tools while enabled', () => {
    const { handlers, state } = registerHook()
    const toolCall = getHandler(handlers, 'tool_call')

    state.setEnabled(true)
    // @ts-expect-error minimal handler mock
    const result = toolCall?.({ toolName: 'write' }, {})

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('Spec mode blocks bash, edit, and write'),
    })
  })

  it('allows read tools while enabled', () => {
    const { handlers, state } = registerHook()
    const toolCall = getHandler(handlers, 'tool_call')

    state.setEnabled(true)
    // @ts-expect-error minimal handler mock
    expect(toolCall?.({ toolName: 'read' }, {})).toBeUndefined()
  })

  it('returns early for tool_call when spec mode is disabled', () => {
    const { handlers } = registerHook()
    const toolCall = getHandler(handlers, 'tool_call')

    // @ts-expect-error minimal handler mock
    const result = toolCall?.({ toolName: 'bash' }, {})
    expect(result).toBeUndefined()
  })

  it('allows edit and write for .pi/specs/*.md files while enabled', () => {
    const { handlers, state } = registerHook()
    const toolCall = getHandler(handlers, 'tool_call')

    state.setEnabled(true)
    // @ts-expect-error minimal handler mock
    const allowedResult = toolCall?.(
      { toolName: 'edit', input: { path: '.pi/specs/test.md' } },
      { cwd: '/test' },
    )
    expect(allowedResult).toBeUndefined()
  })

  it('excludes web_fetch from restored tools when spec mode is disabled', async () => {
    const { handlers, setActiveTools } = registerHook()
    const sessionStart = getHandler(handlers, 'session_start')

    // Override getAllTools to include web_fetch
    const piWithWebFetch: Pick<
      ExtensionAPI,
      'on' | 'getAllTools' | 'setActiveTools'
    > = {
      on: (_event, _handler) => {
        // already registered
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
    const state = createMockSpecModeState()
    registerSpecModeHook(piWithWebFetch, state)

    const context = createContext([])
    // @ts-expect-error minimal handler mock
    await sessionStart?.({}, context)

    expect(setActiveTools).toHaveBeenCalledWith(['read', 'write'])
  })

  it('blocks edit and write outside .pi/specs while enabled', () => {
    const { handlers, state } = registerHook()
    const toolCall = getHandler(handlers, 'tool_call')

    state.setEnabled(true)
    // @ts-expect-error minimal handler mock
    const result = toolCall?.(
      { toolName: 'edit', input: { path: 'src/index.ts' } },
      { cwd: '/test' },
    )

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('Spec mode blocks bash, edit, and write'),
    })
  })
})
