import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createSpecModeState,
  NORMAL_MODE_TOOLS,
  SPEC_MODE_TOOLS,
} from '../utils/spec-state.js'
import { registerSpecModeHook } from './spec-mode.js'

function registerHook() {
  const handlers: { event: string; fn: unknown }[] = []
  const setActiveTools = vi.fn()
  const pi: Pick<ExtensionAPI, 'on' | 'setActiveTools'> = {
    on: (event, handler) => {
      handlers.push({ event, fn: handler })
    },
    setActiveTools,
  }
  const state = createSpecModeState()

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

  it('restores normal tools on session start when spec mode is disabled', async () => {
    const { handlers, setActiveTools } = registerHook()
    const sessionStart = getHandler(handlers, 'session_start')
    const context = createContext([])

    // @ts-expect-error minimal handler mock
    await sessionStart?.({}, context)

    expect(setActiveTools).toHaveBeenCalledWith(NORMAL_MODE_TOOLS)
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
})
