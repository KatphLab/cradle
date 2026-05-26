import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'

import { registerAskUserAbortHook } from './ask-user-abort.js'

describe('registerAskUserAbortHook', () => {
  it('registers a tool_execution_end handler', () => {
    const handlers: { event: string; fn: unknown }[] = []

    const pi: Pick<ExtensionAPI, 'on'> = {
      on: (event, handler) => {
        handlers.push({ event, fn: handler })
      },
    }

    registerAskUserAbortHook(pi)

    expect(handlers).toHaveLength(1)
    expect(handlers[0]?.event).toBe('tool_execution_end')
  })

  it('aborts when ask_user tool execution ends', () => {
    const handlers: { event: string; fn: unknown }[] = []
    const abortSpy = vi.fn()

    const pi: Pick<ExtensionAPI, 'on'> = {
      on: (event, handler) => {
        handlers.push({ event, fn: handler })
      },
    }

    registerAskUserAbortHook(pi)

    const event = {
      type: 'tool_execution_end' as const,
      toolCallId: 'call_123',
      toolName: 'ask_user',
      result: {},
      isError: false,
    }

    expect(handlers[0]).toBeDefined()
    // @ts-expect-error minimal context mock
    handlers[0]?.fn(event, { abort: abortSpy })

    expect(abortSpy).toHaveBeenCalledTimes(1)
  })

  it('does not abort for other tools', () => {
    const handlers: { event: string; fn: unknown }[] = []
    const abortSpy = vi.fn()

    const pi: Pick<ExtensionAPI, 'on'> = {
      on: (event, handler) => {
        handlers.push({ event, fn: handler })
      },
    }

    registerAskUserAbortHook(pi)

    const event = {
      type: 'tool_execution_end' as const,
      toolCallId: 'call_456',
      toolName: 'bash',
      result: {},
      isError: false,
    }

    expect(handlers[0]).toBeDefined()
    // @ts-expect-error minimal context mock
    handlers[0]?.fn(event, { abort: abortSpy })

    expect(abortSpy).not.toHaveBeenCalled()
  })
})
