import type { ExtensionAPI, ThemeColor } from '@earendil-works/pi-coding-agent'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  formatDirectoryPath,
  scanDirectorySuggestions,
} from './settings-utilities.js'
import { registerSettingsCommand } from './settings.js'

let tempRoot: string

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'pi-settings-test-'))
})

afterEach(async () => {
  await rm(tempRoot, { force: true, recursive: true })
})

const mockTheme = {
  fg: (_color: ThemeColor, text: string) => text,
  bold: (text: string) => text,
}

interface SR {
  permissions: { path: string; read: boolean; write: boolean; bash: boolean }[]
  reminderTokenThreshold: number
  subagentModels: { low?: string; medium?: string; high?: string }
  advisorModel?: string
}

async function invokeRegisteredHandler(
  action: (editor: {
    onSave?: (r: SR) => void
    onCancel?: () => void
    tuiRequestRender?: () => void
  }) => unknown,
  notifySpy = vi.fn(),
): Promise<{ notifySpy: ReturnType<typeof vi.fn> }> {
  let handler: unknown
  const pi: Pick<ExtensionAPI, 'registerCommand'> = {
    registerCommand: (_n, o) => {
      handler = o.handler
    },
  }
  registerSettingsCommand(pi)
  expect(typeof handler === 'function').toBe(true)
  // @ts-expect-error minimal context mock
  await handler('', {
    cwd: tempRoot,
    ui: {
      custom: vi.fn(
        (
          factory: (...a: unknown[]) => {
            onSave?: (r: SR) => void
            onCancel?: () => void
            tuiRequestRender?: () => void
          },
        ) => {
          const editor = factory(
            { requestRender: vi.fn() },
            mockTheme,
            {},
            vi.fn(),
          )
          const result = action(editor)
          editor.tuiRequestRender?.()
          return Promise.resolve(result)
        },
      ),
      notify: notifySpy,
    },
  })
  return { notifySpy }
}

describe('registerSettingsCommand', () => {
  it('saves edited permissions and notifies', async () => {
    const { notifySpy } = await invokeRegisteredHandler((editor) => {
      editor.onSave?.({
        permissions: [
          { path: '/allowed-a', read: true, write: false, bash: false },
          { path: '/allowed-b', read: true, write: true, bash: false },
        ],
        reminderTokenThreshold: 5000,
        subagentModels: {},
      })
      return {
        permissions: [
          { path: '/allowed-a', read: true, write: false, bash: false },
          { path: '/allowed-b', read: true, write: true, bash: false },
        ],
        reminderTokenThreshold: 5000,
        subagentModels: {},
      }
    })

    const settingsPath = path.join(tempRoot, '.pi', 'cradle', 'settings.json')
    const saved = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(saved).toEqual({
      permissions: [
        { path: '/allowed-a', read: true, write: false, bash: false },
        { path: '/allowed-b', read: true, write: true, bash: false },
      ],
      reminderTokenThreshold: 5000,
    })
    expect(notifySpy).toHaveBeenCalledWith(
      'Cradle settings saved: 2 permissions, 0 models, reminder token threshold 5000',
      'info',
    )
  })

  it('saves with advisor model and notifies', async () => {
    const { notifySpy } = await invokeRegisteredHandler((editor) => {
      editor.onSave?.({
        permissions: [],
        reminderTokenThreshold: 5000,
        subagentModels: {},
        advisorModel: 'gpt-4',
      })
      return {
        permissions: [],
        reminderTokenThreshold: 5000,
        subagentModels: {},
        advisorModel: 'gpt-4',
      }
    })

    const settingsPath = path.join(tempRoot, '.pi', 'cradle', 'settings.json')
    const saved = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(saved).toEqual({
      permissions: [],
      reminderTokenThreshold: 5000,
      advisorModel: 'gpt-4',
    })
    expect(notifySpy).toHaveBeenCalledWith(
      'Cradle settings saved: 0 permissions, 1 models, reminder token threshold 5000',
      'info',
    )
  })

  it('leaves settings unchanged when editing is cancelled', async () => {
    const { notifySpy } = await invokeRegisteredHandler((editor) => {
      editor.onCancel?.()
    })

    const settingsPath = path.join(tempRoot, '.pi', 'cradle', 'settings.json')
    await expect(readFile(settingsPath, 'utf8')).rejects.toThrow()
    expect(notifySpy).toHaveBeenCalledWith('Cradle settings unchanged', 'info')
  })
})

describe('scanDirectorySuggestions', () => {
  it('returns matching directories and browses inside trailing-slash paths', async () => {
    await mkdir(path.join(tempRoot, 'foo'))
    await mkdir(path.join(tempRoot, 'foobar'))
    await mkdir(path.join(tempRoot, 'bar'))
    await mkdir(path.join(tempRoot, 'parent'))
    await mkdir(path.join(tempRoot, 'parent', 'child-a'))
    await mkdir(path.join(tempRoot, 'parent', 'child-b'))

    const matching = await scanDirectorySuggestions('fo', tempRoot)
    expect(matching).toContain(path.join(tempRoot, 'foo'))
    expect(matching).toContain(path.join(tempRoot, 'foobar'))
    expect(matching).not.toContain(path.join(tempRoot, 'bar'))

    const browsing = await scanDirectorySuggestions('parent/', tempRoot)
    expect(browsing).toEqual([
      path.join(tempRoot, 'parent', 'child-a'),
      path.join(tempRoot, 'parent', 'child-b'),
    ])
  })

  it('returns empty array for edge-case inputs', async () => {
    expect(await scanDirectorySuggestions('', tempRoot)).toEqual([])
    expect(
      await scanDirectorySuggestions('/nonexistent/path', tempRoot),
    ).toEqual([])
  })
})

describe('formatDirectoryPath', () => {
  it('formats paths relative to cwd or keeps them absolute', () => {
    expect(formatDirectoryPath('/a/b/c', '/a/b')).toBe('c')
    expect(formatDirectoryPath('/x/y', '/a/b')).toBe('/x/y')
    expect(formatDirectoryPath('/a/b', '/a/b')).toBe('.')
  })
})
