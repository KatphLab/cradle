import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config/settings.js', () => ({
  loadGlobalSettings: vi.fn(),
}))

import { loadGlobalSettings } from '../../config/settings.js'
import { registerCompactionHook } from '../compaction.js'

const mockedLoadGlobalSettings = vi.mocked(loadGlobalSettings)

function makeModel(provider: string, id: string) {
  return { provider, id, name: `${provider}/${id}` } as never
}

function makePi() {
  const handlers: { event: string; fn: unknown }[] = []

  const pi: Pick<ExtensionAPI, 'on' | 'setModel'> = {
    on: (event, handler) => {
      handlers.push({ event, fn: handler })
    },
    setModel: vi.fn().mockResolvedValue(true),
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
        headers: {},
      }),
    },
    ui: { notify: notifySpy },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('registerCompactionHook', () => {
  describe('session_before_compact', () => {
    it('does nothing when no compaction model is configured', async () => {
      mockedLoadGlobalSettings.mockResolvedValue({})
      const { findHandler } = makePi()
      const compact = findHandler('session_before_compact')
      const context = makeContext({
        currentModel: { provider: 'anthropic', id: 'claude-sonnet-4' },
      })

      // @ts-expect-error minimal context mock
      await compact?.({}, context)

      expect(context.modelRegistry.find).not.toHaveBeenCalled()
      expect(context.ui.notify).not.toHaveBeenCalled()
    })

    it('does nothing when current model matches compaction model', async () => {
      mockedLoadGlobalSettings.mockResolvedValue({
        compactionModel: 'google/gemini-2.5-flash',
      })
      const { findHandler } = makePi()
      const compact = findHandler('session_before_compact')
      const context = makeContext({
        currentModel: { provider: 'google', id: 'gemini-2.5-flash' },
      })

      // @ts-expect-error minimal context mock
      await compact?.({}, context)

      expect(context.modelRegistry.find).not.toHaveBeenCalled()
      expect(context.ui.notify).not.toHaveBeenCalled()
    })

    it('notifies when compaction model has invalid format', async () => {
      mockedLoadGlobalSettings.mockResolvedValue({
        compactionModel: 'invalid-format',
      })
      const { findHandler } = makePi()
      const compact = findHandler('session_before_compact')
      const context = makeContext({
        currentModel: { provider: 'anthropic', id: 'claude-sonnet-4' },
      })

      // @ts-expect-error minimal context mock
      await compact?.({}, context)

      expect(context.ui.notify).toHaveBeenCalledWith(
        'Invalid compaction model format: invalid-format',
        'warning',
      )
      expect(context.modelRegistry.find).not.toHaveBeenCalled()
    })

    it('notifies when compaction model not found in registry', async () => {
      mockedLoadGlobalSettings.mockResolvedValue({
        compactionModel: 'google/gemini-2.5-flash',
      })
      const { findHandler } = makePi()
      const compact = findHandler('session_before_compact')
      const context = makeContext({
        currentModel: { provider: 'anthropic', id: 'claude-sonnet-4' },
        findResult: undefined,
      })

      // @ts-expect-error minimal context mock
      await compact?.({}, context)

      expect(context.ui.notify).toHaveBeenCalledWith(
        'Compaction model not found: google/gemini-2.5-flash',
        'warning',
      )
    })

    it('notifies when no API key is available', async () => {
      mockedLoadGlobalSettings.mockResolvedValue({
        compactionModel: 'google/gemini-2.5-flash',
      })
      const { findHandler } = makePi()
      const compact = findHandler('session_before_compact')
      const context = makeContext({
        currentModel: { provider: 'anthropic', id: 'claude-sonnet-4' },
        findResult: { provider: 'google', id: 'gemini-2.5-flash' },
        authOk: false,
      })

      // @ts-expect-error minimal context mock
      await compact?.({}, context)

      expect(context.ui.notify).toHaveBeenCalledWith(
        'No API key for compaction model google/gemini-2.5-flash',
        'warning',
      )
    })

    it('switches to compaction model and saves previous model ref', async () => {
      mockedLoadGlobalSettings.mockResolvedValue({
        compactionModel: 'google/gemini-2.5-flash',
      })
      const { pi, findHandler } = makePi()
      const compact = findHandler('session_before_compact')
      const compactionModel = makeModel('google', 'gemini-2.5-flash')
      const context = makeContext({
        currentModel: { provider: 'anthropic', id: 'claude-sonnet-4' },
        findResult: compactionModel,
      })

      // @ts-expect-error minimal context mock
      await compact?.({}, context)

      expect(pi.setModel).toHaveBeenCalledWith(compactionModel)
      expect(pi.setModel).toHaveResolved()
    })

    it('notifies and clears ref when setModel fails', async () => {
      mockedLoadGlobalSettings.mockResolvedValue({
        compactionModel: 'google/gemini-2.5-flash',
      })
      const { pi, findHandler } = makePi()
      vi.mocked(pi.setModel).mockResolvedValue(false)
      const compact = findHandler('session_before_compact')
      const context = makeContext({
        currentModel: { provider: 'anthropic', id: 'claude-sonnet-4' },
        findResult: makeModel('google', 'gemini-2.5-flash'),
      })

      // @ts-expect-error minimal context mock
      await compact?.({}, context)

      expect(context.ui.notify).toHaveBeenCalledWith(
        'Failed to switch to compaction model',
        'warning',
      )
    })

    it('handles undefined current model', async () => {
      mockedLoadGlobalSettings.mockResolvedValue({
        compactionModel: 'google/gemini-2.5-flash',
      })
      const { pi, findHandler } = makePi()
      const compact = findHandler('session_before_compact')
      const compactionModel = makeModel('google', 'gemini-2.5-flash')
      const context = makeContext({
        currentModel: undefined as unknown as { provider: string; id: string },
        findResult: compactionModel,
      })

      // @ts-expect-error minimal context mock
      await compact?.({}, context)

      expect(pi.setModel).toHaveBeenCalledWith(compactionModel)
    })
  })

  describe('session_compact', () => {
    it('does nothing when no previous model was saved', async () => {
      mockedLoadGlobalSettings.mockResolvedValue({})
      const { pi, findHandler } = makePi()
      const compact = findHandler('session_compact')
      const context = makeContext({})

      // @ts-expect-error minimal context mock
      await compact?.({}, context)

      expect(pi.setModel).not.toHaveBeenCalled()
    })

    it('restores previous model after compaction', async () => {
      const previousModel = makeModel('anthropic', 'claude-sonnet-4')
      mockedLoadGlobalSettings.mockResolvedValueOnce({
        compactionModel: 'google/gemini-2.5-flash',
      })
      const { pi, findHandler } = makePi()

      // First compact: save previous model, switch to compaction model
      const beforeCompact = findHandler('session_before_compact')
      const contextBefore = makeContext({
        currentModel: previousModel,
        findResult: makeModel('google', 'gemini-2.5-flash'),
      })
      // @ts-expect-error minimal context mock
      await beforeCompact?.({}, contextBefore)

      // Then compact: restore previous model
      const compact = findHandler('session_compact')
      const contextAfter = makeContext({
        findResult: previousModel,
      })
      // @ts-expect-error minimal context mock
      await compact?.({}, contextAfter)

      expect(pi.setModel).toHaveBeenCalledTimes(2)
      // Second call restores the previous model
      expect(pi.setModel).toHaveBeenNthCalledWith(2, previousModel)
    })

    it('does nothing when restored model not found in registry', async () => {
      const previousModel = makeModel('anthropic', 'claude-sonnet-4')
      mockedLoadGlobalSettings.mockResolvedValueOnce({
        compactionModel: 'google/gemini-2.5-flash',
      })
      const { pi, findHandler } = makePi()

      // First compact: save previous model
      const beforeCompact = findHandler('session_before_compact')
      const contextBefore = makeContext({
        currentModel: previousModel,
        findResult: makeModel('google', 'gemini-2.5-flash'),
      })
      // @ts-expect-error minimal context mock
      await beforeCompact?.({}, contextBefore)

      // Second compact: model not found in registry
      const compact = findHandler('session_compact')
      const contextAfter = makeContext({
        findResult: undefined,
      })
      // @ts-expect-error minimal context mock
      await compact?.({}, contextAfter)

      // setModel called once (for switch), not called for restore
      expect(pi.setModel).toHaveBeenCalledTimes(1)
    })
  })
})
