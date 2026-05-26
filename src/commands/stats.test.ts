import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerStatsCommand, resetStatsCount } from './stats.js'

describe('registerStatsCommand', () => {
  beforeEach(() => {
    resetStatsCount()
  })

  it('registers stats command and accumulates counter', async () => {
    let registeredHandler: unknown

    const pi: Pick<ExtensionAPI, 'registerCommand'> = {
      registerCommand: (_name, options) => {
        registeredHandler = options.handler
      },
    }

    registerStatsCommand(pi)

    const getEntriesSpy = vi.fn(() => [{}, {}, {}])
    const notifySpy = vi.fn()

    // @ts-expect-error minimal context mock
    await registeredHandler('', {
      sessionManager: { getEntries: getEntriesSpy },
      ui: { notify: notifySpy },
    })
    expect(notifySpy.mock.calls[0]).toEqual([
      'Stats: 1 checks, 3 entries',
      'info',
    ])

    getEntriesSpy.mockReturnValue([{}, {}])

    // @ts-expect-error minimal context mock
    await registeredHandler('', {
      sessionManager: { getEntries: getEntriesSpy },
      ui: { notify: notifySpy },
    })
    expect(notifySpy.mock.calls[1]).toEqual([
      'Stats: 2 checks, 2 entries',
      'info',
    ])
  })
})
