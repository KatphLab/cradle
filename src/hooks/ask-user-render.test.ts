import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import { describe, expect, it, vi } from 'vitest'

import { createAskUserRenderHook } from './ask-user-render.js'

type OverlayFactory = (
  tui: { requestRender: () => void },
  theme: {
    fg: (color: string, text: string) => string
    bold: (text: string) => string
  },
  keybindings: unknown,
  done: (result: string) => void,
) => Component

function registerHandlers(): { event: string; fn: unknown }[] {
  const handlers: { event: string; fn: unknown }[] = []

  const pi: Pick<ExtensionAPI, 'on'> = {
    on: (event, handler) => {
      handlers.push({ event, fn: handler })
    },
  }

  const register = createAskUserRenderHook()
  register(pi)

  return handlers
}

function createAskUserEvent(text: string) {
  return {
    type: 'tool_execution_end' as const,
    toolCallId: 'call_123',
    toolName: 'ask_user',
    result: {
      content: [{ type: 'text', text }],
    },
    isError: false,
  }
}

function createValidPayload(): string {
  return JSON.stringify({
    preamble: 'Context',
    questions: [
      {
        id: 'q1',
        question: 'Which?',
        options: [{ label: 'A', value: 'a' }],
      },
    ],
  })
}

describe('createAskUserRenderHook', () => {
  it('registers tool_execution_end and turn_start handlers', () => {
    const handlers = registerHandlers()

    expect(handlers).toHaveLength(2)
    expect(handlers.map((h) => h.event)).toContain('tool_execution_end')
    expect(handlers.map((h) => h.event)).toContain('turn_start')
  })

  it('shows overlay when ask_user executes with TUI', async () => {
    const customSpy = vi.fn(
      (_factory: unknown, _options: unknown): Promise<void> =>
        Promise.resolve(),
    )
    const handlers = registerHandlers()
    const toolEndHandler = handlers.find(
      (h) => h.event === 'tool_execution_end',
    )
    expect(toolEndHandler).toBeDefined()

    // @ts-expect-error minimal context mock
    await toolEndHandler?.fn(createAskUserEvent(createValidPayload()), {
      hasUI: true,
      ui: { custom: customSpy },
    })

    expect(customSpy).toHaveBeenCalledTimes(1)
    expect(customSpy.mock.calls[0]?.[1]).toMatchObject({ overlay: true })
  })

  it('returns an overlay component that can render, request renders, and dismiss', async () => {
    const requestRender = vi.fn()
    const done = vi.fn()
    const customSpy = vi
      .fn()
      .mockImplementation(
        (factory: OverlayFactory, _options: unknown): Promise<string> => {
          const component = factory(
            { requestRender },
            {
              fg: vi.fn((_color: string, text: string): string => text),
              bold: vi.fn((text: string): string => text),
            },
            {},
            done,
          )

          expect(component.render(80).length).toBeGreaterThan(0)
          component.handleInput?.('x')
          component.handleInput?.('\u001B')

          return Promise.resolve('dismissed')
        },
      )
    const handlers = registerHandlers()
    const toolEndHandler = handlers.find(
      (h) => h.event === 'tool_execution_end',
    )

    // @ts-expect-error minimal context mock
    await toolEndHandler?.fn(createAskUserEvent(createValidPayload()), {
      hasUI: true,
      ui: { custom: customSpy },
    })

    expect(customSpy).toHaveBeenCalledTimes(1)
    expect(requestRender).toHaveBeenCalledTimes(2)
    expect(done).toHaveBeenCalledWith('dismissed')
  })

  it('does nothing when TUI is not available', async () => {
    const customSpy = vi.fn()
    const handlers = registerHandlers()
    const toolEndHandler = handlers.find(
      (h) => h.event === 'tool_execution_end',
    )

    // @ts-expect-error minimal context mock
    await toolEndHandler?.fn(createAskUserEvent(createValidPayload()), {
      hasUI: false,
      ui: { custom: customSpy },
    })

    expect(customSpy).not.toHaveBeenCalled()
  })

  it('does nothing for other tools', async () => {
    const customSpy = vi.fn()
    const handlers = registerHandlers()
    const toolEndHandler = handlers.find(
      (h) => h.event === 'tool_execution_end',
    )

    const event = {
      type: 'tool_execution_end' as const,
      toolCallId: 'call_456',
      toolName: 'bash',
      result: { content: [] },
      isError: false,
    }

    // @ts-expect-error minimal context mock
    await toolEndHandler?.fn(event, {
      hasUI: true,
      ui: { custom: customSpy },
    })

    expect(customSpy).not.toHaveBeenCalled()
  })

  it('does nothing on error', async () => {
    const customSpy = vi.fn()
    const handlers = registerHandlers()
    const toolEndHandler = handlers.find(
      (h) => h.event === 'tool_execution_end',
    )

    const event = {
      type: 'tool_execution_end' as const,
      toolCallId: 'call_123',
      toolName: 'ask_user',
      result: { content: [] },
      isError: true,
    }

    // @ts-expect-error minimal context mock
    await toolEndHandler?.fn(event, {
      hasUI: true,
      ui: { custom: customSpy },
    })

    expect(customSpy).not.toHaveBeenCalled()
  })

  it('does nothing when result content is not text', async () => {
    const customSpy = vi.fn()
    const handlers = registerHandlers()
    const toolEndHandler = handlers.find(
      (h) => h.event === 'tool_execution_end',
    )

    const event = {
      type: 'tool_execution_end' as const,
      toolCallId: 'call_123',
      toolName: 'ask_user',
      result: {
        content: [{ type: 'image', text: 'ignored' }],
      },
      isError: false,
    }

    // @ts-expect-error minimal context mock
    await toolEndHandler?.fn(event, {
      hasUI: true,
      ui: { custom: customSpy },
    })

    expect(customSpy).not.toHaveBeenCalled()
  })

  it('does nothing when result text is invalid JSON', async () => {
    const customSpy = vi.fn()
    const handlers = registerHandlers()
    const toolEndHandler = handlers.find(
      (h) => h.event === 'tool_execution_end',
    )

    // @ts-expect-error minimal context mock
    await toolEndHandler?.fn(createAskUserEvent('not json'), {
      hasUI: true,
      ui: { custom: customSpy },
    })

    expect(customSpy).not.toHaveBeenCalled()
  })

  it('does nothing when parsed JSON is not an ask_user payload', async () => {
    const customSpy = vi.fn()
    const handlers = registerHandlers()
    const toolEndHandler = handlers.find(
      (h) => h.event === 'tool_execution_end',
    )

    // @ts-expect-error minimal context mock
    await toolEndHandler?.fn(
      createAskUserEvent(JSON.stringify({ notQuestions: [] })),
      {
        hasUI: true,
        ui: { custom: customSpy },
      },
    )

    expect(customSpy).not.toHaveBeenCalled()
  })

  it('does nothing when result content is malformed', async () => {
    const customSpy = vi.fn()
    const handlers = registerHandlers()
    const toolEndHandler = handlers.find(
      (h) => h.event === 'tool_execution_end',
    )

    const event = {
      type: 'tool_execution_end' as const,
      toolCallId: 'call_123',
      toolName: 'ask_user',
      result: { content: 'not an array' },
      isError: false,
    }

    // @ts-expect-error minimal context mock
    await toolEndHandler?.fn(event, {
      hasUI: true,
      ui: { custom: customSpy },
    })

    expect(customSpy).not.toHaveBeenCalled()
  })

  it('swallows errors from custom overlay rendering', async () => {
    const customSpy = vi.fn(
      (_factory: unknown, _options: unknown): Promise<string> =>
        Promise.reject(new Error('fail')),
    )
    const handlers = registerHandlers()
    const toolEndHandler = handlers.find(
      (h) => h.event === 'tool_execution_end',
    )

    // @ts-expect-error minimal context mock
    await toolEndHandler?.fn(createAskUserEvent(createValidPayload()), {
      hasUI: true,
      ui: { custom: customSpy },
    })

    expect(customSpy).toHaveBeenCalledTimes(1)
    await Promise.resolve()
  })

  it('closes overlay on turn_start', async () => {
    const done = vi.fn()
    const customSpy = vi
      .fn()
      .mockImplementation(
        (factory: OverlayFactory, _options: unknown): Promise<string> => {
          factory(
            { requestRender: vi.fn() },
            {
              fg: vi.fn((_color: string, text: string): string => text),
              bold: vi.fn((text: string): string => text),
            },
            {},
            done,
          )
          return Promise.resolve('dismissed')
        },
      )
    const handlers = registerHandlers()
    const toolEndHandler = handlers.find(
      (h) => h.event === 'tool_execution_end',
    )
    const turnStartHandler = handlers.find((h) => h.event === 'turn_start')

    // @ts-expect-error minimal context mock
    await toolEndHandler?.fn(createAskUserEvent(createValidPayload()), {
      hasUI: true,
      ui: { custom: customSpy },
    })

    expect(done).toHaveBeenCalledTimes(0)
    expect(turnStartHandler).toBeDefined()

    // @ts-expect-error minimal context mock
    await turnStartHandler?.fn({}, {})

    expect(done).toHaveBeenCalledWith('dismissed')
  })
})
