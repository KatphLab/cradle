import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'
import configureExtension from './index.js'

describe('configureExtension', () => {
  it('registers tool, command, and hooks', () => {
    const registeredTools: unknown[] = []
    const handlers: { event: string; fn: unknown }[] = []
    const commandNames: string[] = []

    const pi: Pick<
      ExtensionAPI,
      | 'registerTool'
      | 'registerCommand'
      | 'on'
      | 'appendEntry'
      | 'getActiveTools'
      | 'getAllTools'
      | 'setActiveTools'
    > = {
      registerTool: (tool) => {
        registeredTools.push(tool)
      },
      registerCommand: (name) => {
        commandNames.push(name)
      },
      on: (event, handler) => {
        handlers.push({ event, fn: handler })
      },
      appendEntry: vi.fn(),
      getActiveTools: () => [],
      getAllTools: () => [],
      setActiveTools: vi.fn(),
    }

    configureExtension(pi)

    expect(registeredTools).toHaveLength(10)
    expect(registeredTools).toEqual([
      expect.objectContaining({ name: 'read' }),
      expect.objectContaining({ name: 'ls' }),
      expect.objectContaining({ name: 'grep' }),
      expect.objectContaining({ name: 'glob' }),
      expect.objectContaining({ name: 'edit' }),
      expect.objectContaining({ name: 'write' }),
      expect.objectContaining({ name: 'apply_patch' }),
      expect.objectContaining({ name: 'bash' }),
      expect.objectContaining({ name: 'todo' }),
      expect.objectContaining({ name: 'ask_user' }),
    ])
    expect(commandNames).toEqual(['cradle-settings', 'stats', 'spec'])
    expect(handlers).toHaveLength(7)
    expect(handlers.map((h) => h.event)).toEqual([
      'tool_call',
      'session_start',
      'context',
      'session_start',
      'before_agent_start',
      'tool_call',
      'tool_execution_end',
    ])
  })
})
