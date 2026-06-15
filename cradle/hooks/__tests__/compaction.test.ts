import {
  compact as runCompaction,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@earendil-works/pi-coding-agent', () => ({
  compact: vi.fn(),
}))

vi.mock('../../config/settings.js', () => ({
  loadGlobalSettings: vi.fn(),
}))

import { loadGlobalSettings } from '../../config/settings.js'
import { registerCompactionHook } from '../compaction.js'

const mockedLoadGlobalSettings = vi.mocked(loadGlobalSettings)
const mockedRunCompaction = vi.mocked(runCompaction)

function makeModel(provider: string, id: string) {
  return { provider, id, name: `${provider}/${id}` } as never
}

function makePi() {
  const handlers: { event: string; fn: unknown }[] = []

  const pi: Pick<ExtensionAPI, 'getThinkingLevel' | 'on'> = {
    on: (event, handler) => {
      handlers.push({ event, fn: handler })
    },
    getThinkingLevel: vi.fn().mockReturnValue('medium'),
  }

  registerCompactionHook(pi)

  return {
    pi,
    handlers,
    findHandler: (event: string) => handlers.find((h) => h.event === event)?.fn,
  }
}

function makeContext(options: {
  currentModel?: { provider: string; id: string }
  findResult?: { provider: string; id: string } | undefined
  authOk?: boolean
  authApiKey?: string
}) {
  const findResult = options.findResult
  const notifySpy = vi.fn()

  return {
    model: options.currentModel
      ? makeModel(options.currentModel.provider, options.currentModel.id)
      : undefined,
    modelRegistry: {
      find: vi.fn().mockReturnValue(findResult ?? undefined),
      getApiKeyAndHeaders: vi.fn().mockResolvedValue({
        ok: options.authOk ?? true,
        apiKey: options.authApiKey ?? 'test-key',
        headers: { 'x-test': 'header' },
      }),
    },
    ui: { notify: notifySpy },
  }
}

function makeEvent(options: { customInstructions?: string } = {}) {
  const event = {
    preparation: { firstKeptEntryId: 'entry-kept' },
    signal: new AbortController().signal,
  }

  if (options.customInstructions === undefined) return event

  return { ...event, customInstructions: options.customInstructions }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedRunCompaction.mockResolvedValue({
    summary: 'summary',
    firstKeptEntryId: 'entry-kept',
    tokensBefore: 123,
  })
})

describe('registerCompactionHook', () => {
  describe('session_before_compact', () => {
    it('does nothing when no compaction model is configured', async () => {
      mockedLoadGlobalSettings.mockResolvedValue({})
      const { findHandler } = makePi()
      const handler = findHandler('session_before_compact')
      const context = makeContext({
        currentModel: { provider: 'anthropic', id: 'claude-sonnet-4' },
      })

      // @ts-expect-error minimal event and context mock
      const result = await handler?.(makeEvent(), context)

      expect(result).toBeUndefined()
      expect(context.modelRegistry.find).not.toHaveBeenCalled()
      expect(context.ui.notify).not.toHaveBeenCalled()
      expect(mockedRunCompaction).not.toHaveBeenCalled()
    })

    it('does nothing when current model matches compaction model', async () => {
      mockedLoadGlobalSettings.mockResolvedValue({
        compactionModel: 'google/gemini-2.5-flash',
      })
      const { findHandler } = makePi()
      const handler = findHandler('session_before_compact')
      const context = makeContext({
        currentModel: { provider: 'google', id: 'gemini-2.5-flash' },
      })

      // @ts-expect-error minimal event and context mock
      const result = await handler?.(makeEvent(), context)

      expect(result).toBeUndefined()
      expect(context.modelRegistry.find).not.toHaveBeenCalled()
      expect(context.ui.notify).not.toHaveBeenCalled()
      expect(mockedRunCompaction).not.toHaveBeenCalled()
    })

    it('notifies when compaction model has invalid format', async () => {
      mockedLoadGlobalSettings.mockResolvedValue({
        compactionModel: 'invalid-format',
      })
      const { findHandler } = makePi()
      const handler = findHandler('session_before_compact')
      const context = makeContext({
        currentModel: { provider: 'anthropic', id: 'claude-sonnet-4' },
      })

      // @ts-expect-error minimal event and context mock
      const result = await handler?.(makeEvent(), context)

      expect(result).toBeUndefined()
      expect(context.ui.notify).toHaveBeenCalledWith(
        'Invalid compaction model format: invalid-format',
        'warning',
      )
      expect(context.modelRegistry.find).not.toHaveBeenCalled()
      expect(mockedRunCompaction).not.toHaveBeenCalled()
    })

    it('notifies when compaction model not found in registry', async () => {
      mockedLoadGlobalSettings.mockResolvedValue({
        compactionModel: 'google/gemini-2.5-flash',
      })
      const { findHandler } = makePi()
      const handler = findHandler('session_before_compact')
      const context = makeContext({
        currentModel: { provider: 'anthropic', id: 'claude-sonnet-4' },
        findResult: undefined,
      })

      // @ts-expect-error minimal event and context mock
      const result = await handler?.(makeEvent(), context)

      expect(result).toBeUndefined()
      expect(context.ui.notify).toHaveBeenCalledWith(
        'Compaction model not found: google/gemini-2.5-flash',
        'warning',
      )
      expect(mockedRunCompaction).not.toHaveBeenCalled()
    })

    it('notifies when no API key is available', async () => {
      mockedLoadGlobalSettings.mockResolvedValue({
        compactionModel: 'google/gemini-2.5-flash',
      })
      const { findHandler } = makePi()
      const handler = findHandler('session_before_compact')
      const context = makeContext({
        currentModel: { provider: 'anthropic', id: 'claude-sonnet-4' },
        findResult: { provider: 'google', id: 'gemini-2.5-flash' },
        authOk: false,
      })

      // @ts-expect-error minimal event and context mock
      const result = await handler?.(makeEvent(), context)

      expect(result).toBeUndefined()
      expect(context.ui.notify).toHaveBeenCalledWith(
        'No API key for compaction model google/gemini-2.5-flash',
        'warning',
      )
      expect(mockedRunCompaction).not.toHaveBeenCalled()
    })

    it('returns a custom compaction generated with the configured model', async () => {
      const compactionResult = {
        summary: 'custom summary',
        firstKeptEntryId: 'entry-kept',
        tokensBefore: 456,
      }
      mockedRunCompaction.mockResolvedValue(compactionResult)
      mockedLoadGlobalSettings.mockResolvedValue({
        compactionModel: 'google/gemini-2.5-flash',
      })
      const { findHandler } = makePi()
      const handler = findHandler('session_before_compact')
      const compactionModel = makeModel('google', 'gemini-2.5-flash')
      const event = makeEvent({ customInstructions: 'focus on code changes' })
      const context = makeContext({
        currentModel: { provider: 'anthropic', id: 'claude-sonnet-4' },
        findResult: compactionModel,
      })

      // @ts-expect-error minimal event and context mock
      const result = await handler?.(event, context)

      expect(result).toEqual({ compaction: compactionResult })
      expect(context.ui.notify).toHaveBeenCalledWith(
        'Compacting with model: gemini-2.5-flash',
        'info',
      )
      expect(mockedRunCompaction).toHaveBeenCalledWith(
        event.preparation,
        compactionModel,
        'test-key',
        { 'x-test': 'header' },
        'focus on code changes',
        event.signal,
        'off',
      )
    })

    it('handles undefined current model', async () => {
      mockedLoadGlobalSettings.mockResolvedValue({
        compactionModel: 'google/gemini-2.5-flash',
      })
      const { findHandler } = makePi()
      const handler = findHandler('session_before_compact')
      const compactionModel = makeModel('google', 'gemini-2.5-flash')
      const context = makeContext({
        findResult: compactionModel,
      })

      // @ts-expect-error minimal event and context mock
      const result = await handler?.(makeEvent(), context)

      expect(result).toEqual({
        compaction: {
          summary: 'summary',
          firstKeptEntryId: 'entry-kept',
          tokensBefore: 123,
        },
      })
      expect(mockedRunCompaction).toHaveBeenCalledOnce()
    })
  })

  it('does not register a session_compact restore handler', () => {
    const { handlers } = makePi()

    expect(handlers.map((handler) => handler.event)).toEqual([
      'session_before_compact',
    ])
  })
})
