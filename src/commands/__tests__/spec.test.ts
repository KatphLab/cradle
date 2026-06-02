import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { registerSpecCommand, setSpecModeEnabled } from '../spec.js'

type ToolInfo = ReturnType<ExtensionAPI['getAllTools']>[number]

const ALL_TOOL_NAMES = ['read', 'write']
const SPEC_MODE_TOOLS = ['read', 'glob', 'grep', 'ls', 'edit', 'write', 'todo']

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
  const state = createMockSpecModeState()

  registerSpecCommand(pi, state)

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

describe('registerSpecCommand', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('enables spec mode', async () => {
    const { appendEntry, getAllTools, handler, setActiveTools, state } =
      setupCommand()
    const context = createContext()

    // @ts-expect-error minimal command context mock
    await handler?.('', context)

    expect(state.isEnabled()).toBe(true)
    expect(getAllTools).not.toHaveBeenCalled()
    expect(setActiveTools).toHaveBeenCalledWith(SPEC_MODE_TOOLS)
    expect(appendEntry).toHaveBeenCalledWith('cradle-spec-mode', {
      enabled: true,
    })
    expect(context.ui.setStatus).toHaveBeenCalledWith('spec-mode', 'spec')
  })

  it('disables spec mode and enables all registered tools', async () => {
    const { appendEntry, handler, setActiveTools, state } = setupCommand()
    const context = createContext()

    // @ts-expect-error minimal command context mock
    await handler?.('', context)
    // @ts-expect-error minimal command context mock
    await handler?.('', context)

    expect(state.isEnabled()).toBe(false)
    expect(setActiveTools).toHaveBeenLastCalledWith(ALL_TOOL_NAMES)
    expect(appendEntry).toHaveBeenLastCalledWith('cradle-spec-mode', {
      enabled: false,
    })
    const lastStatusCall = context.ui.setStatus.mock.calls.at(-1)
    expect(lastStatusCall?.[0]).toBe('spec-mode')
    expect(lastStatusCall).toHaveLength(2)
    expect(lastStatusCall?.[1]).toBeUndefined()
  })

  it('enables all registered tools when disabling spec mode directly', () => {
    const setActiveTools = vi.fn()
    const appendEntry = vi.fn()
    const state = createMockSpecModeState()
    const context = createContext()

    setSpecModeEnabled(
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

  it('does not query all tools while enabling spec mode repeatedly', () => {
    const setActiveTools = vi.fn()
    const appendEntry = vi.fn()
    const getAllTools = vi.fn(() => [])
    const state = createMockSpecModeState()
    const context = createContext()

    const pi = { appendEntry, getAllTools, setActiveTools }
    // @ts-expect-error minimal command context mock
    setSpecModeEnabled(pi, context, state, true)
    // @ts-expect-error minimal command context mock
    setSpecModeEnabled(pi, context, state, true)

    expect(getAllTools).not.toHaveBeenCalled()
    expect(setActiveTools).toHaveBeenLastCalledWith(SPEC_MODE_TOOLS)
  })
})
