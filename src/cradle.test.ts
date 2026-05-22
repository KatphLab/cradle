import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import configureExtension from './index.js'

describe('configureExtension', () => {
  it('registers tool, command, and hooks', () => {
    const registeredTools: unknown[] = []
    const handlers: { event: string; fn: unknown }[] = []
    const commandNames: string[] = []

    const pi: Pick<ExtensionAPI, 'registerTool' | 'registerCommand' | 'on'> = {
      registerTool: (tool) => {
        registeredTools.push(tool)
      },
      registerCommand: (name) => {
        commandNames.push(name)
      },
      on: (event, handler) => {
        handlers.push({ event, fn: handler })
      },
    }

    configureExtension(pi)

    expect(registeredTools).toHaveLength(1)
    expect(commandNames).toEqual(['cradle-settings', 'stats'])
    expect(handlers).toHaveLength(3)
    expect(handlers.map((h) => h.event)).toEqual([
      'session_start',
      'tool_call',
      'agent_end',
    ])
  })
})
