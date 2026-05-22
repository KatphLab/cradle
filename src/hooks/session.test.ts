import type {
  ExtensionAPI,
  ToolCallEvent,
} from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSessions, registerSessionHooks } from './session.js'

describe('registerSessionHooks', () => {
  beforeEach(() => {
    clearSessions()
  })

  it('registers hooks and handlers work', async () => {
    const handlers: { event: string; fn: unknown }[] = []

    const pi: Pick<ExtensionAPI, 'on'> = {
      on: (event, handler) => {
        handlers.push({ event, fn: handler })
      },
    }

    registerSessionHooks(pi)

    expect(handlers).toHaveLength(3)
    expect(handlers.map((h) => h.event)).toEqual([
      'session_start',
      'tool_call',
      'agent_end',
    ])

    // tool_call handler before any session - lastId undefined
    const confirmSpy = vi.fn()
    expect(handlers[1]).toBeDefined()
    const readEvent: ToolCallEvent = {
      type: 'tool_call',
      toolCallId: '1',
      toolName: 'read',
      input: { path: '/tmp' },
    }
    expect(
      // @ts-expect-error minimal context mock
      await handlers[1]?.fn(readEvent, { ui: { confirm: confirmSpy } }),
    ).toEqual({})
    expect(confirmSpy).not.toHaveBeenCalled()

    // session_start handler
    const notifySpy = vi.fn()
    expect(handlers[0]).toBeDefined()
    // @ts-expect-error minimal context mock
    handlers[0]?.fn({}, { ui: { notify: notifySpy } })
    expect(notifySpy).toHaveBeenCalledWith('Session s1 started', 'info')

    // tool_call handler with session now - lastId exists
    const bashEvent: ToolCallEvent = {
      type: 'tool_call',
      toolCallId: '2',
      toolName: 'bash',
      input: { command: 'ls' },
    }
    expect(
      // @ts-expect-error minimal context mock
      await handlers[1]?.fn(bashEvent, { ui: { confirm: confirmSpy } }),
    ).toEqual({})
    expect(confirmSpy).not.toHaveBeenCalled()

    // tool_call handler - bash with rm -rf, denied
    const dangerousEvent: ToolCallEvent = {
      type: 'tool_call',
      toolCallId: '3',
      toolName: 'bash',
      input: { command: 'rm -rf /' },
    }
    confirmSpy.mockResolvedValueOnce(false)
    expect(
      // @ts-expect-error minimal context mock
      await handlers[1]?.fn(dangerousEvent, { ui: { confirm: confirmSpy } }),
    ).toEqual({
      block: true,
      reason: 'Blocked by user',
    })
    expect(confirmSpy).toHaveBeenCalledWith('Dangerous!', 'Allow rm -rf?')

    // tool_call handler - bash with rm -rf, allowed
    confirmSpy.mockResolvedValueOnce(true)
    expect(
      // @ts-expect-error minimal context mock
      await handlers[1]?.fn(dangerousEvent, { ui: { confirm: confirmSpy } }),
    ).toEqual({})
    expect(confirmSpy).toHaveBeenCalledTimes(2)

    // agent_end handler
    const notifySpy2 = vi.fn()
    expect(handlers[2]).toBeDefined()
    // @ts-expect-error minimal context mock
    handlers[2]?.fn({}, { ui: { notify: notifySpy2 } })
    expect(notifySpy2).toHaveBeenCalledWith('1 sessions tracked', 'info')
  })
})
