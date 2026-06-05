import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  registerOrchestratorCommand,
  setOrchestratorModeEnabled,
} from '../orchestrator.js'

type ToolInfo = ReturnType<ExtensionAPI['getAllTools']>[number]

const ALL_TOOL_NAMES = ['read', 'write']
const ORCHESTRATOR_MODE_TOOLS = [
  'read',
  'glob',
  'grep',
  'ls',
  'discover-agents',
  'subagent',
  'todo',
]

function createToolInfo(name: string): ToolInfo {
  return {
    name,
    description: `${name} description`,
    parameters: { type: 'object', properties: {} },
    sourceInfo: {
      path: `<test:${name}>`,
      source: 'builtin',
      scope: 'temporary',
      origin: 'top-level',
    },
  }
}

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

function setupCommand() {
  let handler:
    | ((args: string, context: ExtensionCommandContext) => Promise<void>)
    | undefined
  const getAllTools = vi.fn(() =>
    ALL_TOOL_NAMES.map((name) => createToolInfo(name)),
  )
  const setActiveTools = vi.fn()
  const appendEntry = vi.fn()
  const pi: Pick<
    ExtensionAPI,
    'registerCommand' | 'getAllTools' | 'setActiveTools' | 'appendEntry'
  > = {
    registerCommand: (_name, options) => {
      handler = options.handler
    },
    getAllTools,
    setActiveTools,
    appendEntry,
  }
  const state = createMockOrchestratorModeState()

  registerOrchestratorCommand(pi, state)

  return { appendEntry, getAllTools, handler, setActiveTools, state }
}

function createContext() {
  return {
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      theme: { fg: (_color: string, text: string) => text },
    },
  }
}

describe('registerOrchestratorCommand', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('enables orchestrator mode', async () => {
    const { appendEntry, getAllTools, handler, setActiveTools, state } =
      setupCommand()
    const context = createContext()

    // @ts-expect-error minimal command context mock
    await handler?.('', context)

    expect(state.isEnabled()).toBe(true)
    expect(getAllTools).not.toHaveBeenCalled()
    expect(setActiveTools).toHaveBeenCalledWith(ORCHESTRATOR_MODE_TOOLS)
    expect(appendEntry).toHaveBeenCalledWith('cradle-orchestrator-mode', {
      enabled: true,
    })
    expect(context.ui.setStatus).toHaveBeenCalledWith(
      'orchestrator-mode',
      'orch',
    )
  })

  it('disables orchestrator mode and enables all registered tools', async () => {
    const { appendEntry, handler, setActiveTools, state } = setupCommand()
    const context = createContext()

    // @ts-expect-error minimal command context mock
    await handler?.('', context)
    // @ts-expect-error minimal command context mock
    await handler?.('', context)

    expect(state.isEnabled()).toBe(false)
    expect(setActiveTools).toHaveBeenLastCalledWith(ALL_TOOL_NAMES)
    expect(appendEntry).toHaveBeenLastCalledWith('cradle-orchestrator-mode', {
      enabled: false,
    })
    const lastStatusCall = context.ui.setStatus.mock.calls.at(-1)
    expect(lastStatusCall?.[0]).toBe('orchestrator-mode')
    expect(lastStatusCall).toHaveLength(2)
    expect(lastStatusCall?.[1]).toBeUndefined()
  })

  it('enables all registered tools when disabling orchestrator mode directly', () => {
    const setActiveTools = vi.fn()
    const appendEntry = vi.fn()
    const state = createMockOrchestratorModeState()
    const context = createContext()

    setOrchestratorModeEnabled(
      {
        appendEntry,
        getAllTools: () => ALL_TOOL_NAMES.map((name) => createToolInfo(name)),
        setActiveTools,
      },
      // @ts-expect-error minimal command context mock
      context,
      state,
      false,
    )

    expect(setActiveTools).toHaveBeenCalledWith(ALL_TOOL_NAMES)
  })

  it('excludes web_fetch when disabling orchestrator mode', () => {
    const setActiveTools = vi.fn()
    const appendEntry = vi.fn()
    const state = createMockOrchestratorModeState()
    const context = createContext()

    setOrchestratorModeEnabled(
      {
        appendEntry,
        getAllTools: () =>
          ['read', 'write', 'web_fetch_internal'].map((name) =>
            createToolInfo(name),
          ),
        setActiveTools,
      },
      // @ts-expect-error minimal command context mock
      context,
      state,
      false,
    )

    expect(setActiveTools).toHaveBeenCalledWith(['read', 'write'])
  })

  it('does not query all tools while enabling orchestrator mode repeatedly', () => {
    const setActiveTools = vi.fn()
    const appendEntry = vi.fn()
    const getAllTools = vi.fn(() => [])
    const state = createMockOrchestratorModeState()
    const context = createContext()

    const pi = { appendEntry, getAllTools, setActiveTools }
    // @ts-expect-error minimal command context mock
    setOrchestratorModeEnabled(pi, context, state, true)
    // @ts-expect-error minimal command context mock
    setOrchestratorModeEnabled(pi, context, state, true)

    expect(getAllTools).not.toHaveBeenCalled()
    expect(setActiveTools).toHaveBeenLastCalledWith(ORCHESTRATOR_MODE_TOOLS)
  })
})
