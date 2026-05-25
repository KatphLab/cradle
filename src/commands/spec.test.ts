import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { registerSpecCommand, setSpecModeEnabled } from './spec.js'

const NORMAL_MODE_TOOLS = [
  'read',
  'ls',
  'grep',
  'glob',
  'edit',
  'write',
  'bash',
  'todo',
]
const SPEC_MODE_TOOLS = ['read', 'glob', 'grep', 'ls', 'edit', 'write', 'todo']

function createMockSpecModeState(): {
  isEnabled: () => boolean
  setEnabled: (enabled: boolean) => void
  getPreviousActiveTools: () => string[] | undefined
  setPreviousActiveTools: (tools: string[] | undefined) => void
} {
  let enabled = false
  let previousTools: string[] | undefined
  return {
    isEnabled: () => enabled,
    setEnabled: (v: boolean) => {
      enabled = v
    },
    getPreviousActiveTools: () => previousTools,
    setPreviousActiveTools: (tools: string[] | undefined) => {
      previousTools = tools
    },
  }
}

function setupCommand() {
  let handler:
    | ((args: string, context: ExtensionCommandContext) => Promise<void>)
    | undefined
  const getActiveTools = vi.fn(() => ['read', 'write'])
  const setActiveTools = vi.fn()
  const appendEntry = vi.fn()
  const pi: Pick<
    ExtensionAPI,
    'registerCommand' | 'getActiveTools' | 'setActiveTools' | 'appendEntry'
  > = {
    registerCommand: (_name, options) => {
      handler = options.handler
    },
    getActiveTools,
    setActiveTools,
    appendEntry,
  }
  const state = createMockSpecModeState()

  registerSpecCommand(pi, state)

  return { appendEntry, getActiveTools, handler, setActiveTools, state }
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

  it('enables spec mode and stores previous active tools', async () => {
    const { appendEntry, getActiveTools, handler, setActiveTools, state } =
      setupCommand()
    const context = createContext()

    // @ts-expect-error minimal command context mock
    await handler?.('', context)

    expect(state.isEnabled()).toBe(true)
    expect(getActiveTools).toHaveBeenCalledOnce()
    expect(setActiveTools).toHaveBeenCalledWith(SPEC_MODE_TOOLS)
    expect(appendEntry).toHaveBeenCalledWith('cradle-spec-mode', {
      enabled: true,
    })
    expect(context.ui.setStatus).toHaveBeenCalledWith('spec-mode', 'spec')
  })

  it('disables spec mode and restores previous active tools', async () => {
    const { appendEntry, handler, setActiveTools, state } = setupCommand()
    const context = createContext()

    // @ts-expect-error minimal command context mock
    await handler?.('', context)
    // @ts-expect-error minimal command context mock
    await handler?.('', context)

    expect(state.isEnabled()).toBe(false)
    expect(setActiveTools).toHaveBeenLastCalledWith(['read', 'write'])
    expect(appendEntry).toHaveBeenLastCalledWith('cradle-spec-mode', {
      enabled: false,
    })
    const lastStatusCall = context.ui.setStatus.mock.calls.at(-1)
    expect(lastStatusCall?.[0]).toBe('spec-mode')
    expect(lastStatusCall).toHaveLength(2)
    expect(lastStatusCall?.[1]).toBeUndefined()
  })

  it('disables spec mode to normal tools when no previous tools exist', () => {
    const setActiveTools = vi.fn()
    const appendEntry = vi.fn()
    const state = createMockSpecModeState()
    const context = createContext()

    setSpecModeEnabled(
      {
        appendEntry,
        getActiveTools: () => [],
        setActiveTools,
      },
      // @ts-expect-error minimal command context mock
      context,
      state,
      false,
    )

    expect(setActiveTools).toHaveBeenCalledWith(NORMAL_MODE_TOOLS)
  })

  it('does not replace previous active tools when enabling twice', () => {
    const setActiveTools = vi.fn()
    const appendEntry = vi.fn()
    const getActiveTools = vi
      .fn()
      .mockReturnValueOnce(['read'])
      .mockReturnValueOnce(['write'])
    const state = createMockSpecModeState()
    const context = createContext()

    const pi = { appendEntry, getActiveTools, setActiveTools }
    // @ts-expect-error minimal command context mock
    setSpecModeEnabled(pi, context, state, true)
    // @ts-expect-error minimal command context mock
    setSpecModeEnabled(pi, context, state, true)
    // @ts-expect-error minimal command context mock
    setSpecModeEnabled(pi, context, state, false)

    expect(getActiveTools).toHaveBeenCalledOnce()
    expect(setActiveTools).toHaveBeenLastCalledWith(['read'])
  })
})
