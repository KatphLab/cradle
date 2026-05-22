import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadCradleSettings } from '@config/settings.js'
import { registerSettingsCommand } from './settings.js'

let tempRoot: string

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'pi-settings-test-'))
})

afterEach(async () => {
  await rm(tempRoot, { force: true, recursive: true })
})

describe('registerSettingsCommand', () => {
  it('registers settings command and saves edited directories', async () => {
    let registeredHandler: unknown

    const pi: Pick<ExtensionAPI, 'registerCommand'> = {
      registerCommand: (_name, options) => {
        registeredHandler = options.handler
      },
    }

    registerSettingsCommand(pi)
    expect(typeof registeredHandler === 'function').toBe(true)

    const editorSpy = vi.fn(() =>
      Promise.resolve('allowed-a\n\nallowed-b\nallowed-a'),
    )
    const notifySpy = vi.fn()

    // @ts-expect-error minimal context mock
    await registeredHandler('', {
      cwd: tempRoot,
      ui: { editor: editorSpy, notify: notifySpy },
    })

    await expect(loadCradleSettings(tempRoot)).resolves.toEqual({
      read: { extraAllowedDirectories: ['allowed-a', 'allowed-b'] },
    })
    expect(notifySpy).toHaveBeenCalledWith(
      'Cradle settings saved: 2 extra read directories',
      'info',
    )
  })

  it('leaves settings unchanged when editing is cancelled', async () => {
    let registeredHandler: unknown

    const pi: Pick<ExtensionAPI, 'registerCommand'> = {
      registerCommand: (_name, options) => {
        registeredHandler = options.handler
      },
    }

    registerSettingsCommand(pi)

    let cancelled: string | undefined
    const editorSpy = vi.fn(() => Promise.resolve(cancelled))
    const notifySpy = vi.fn()

    // @ts-expect-error minimal context mock
    await registeredHandler('', {
      cwd: tempRoot,
      ui: { editor: editorSpy, notify: notifySpy },
    })

    await expect(loadCradleSettings(tempRoot)).resolves.toEqual({})
    expect(notifySpy).toHaveBeenCalledWith('Cradle settings unchanged', 'info')
  })
})
