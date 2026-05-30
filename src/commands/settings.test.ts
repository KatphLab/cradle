import type { ExtensionAPI, ThemeColor } from '@earendil-works/pi-coding-agent'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CradleSettingsEditor } from './settings-editor.js'
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

async function invokeRegisteredHandler(
  action: (editor: {
    onSave?: (result: {
      permissions: {
        path: string
        read: boolean
        write: boolean
        bash: boolean
      }[]
      reminderInterval: number
      subagentModels: {
        low?: string
        medium?: string
        high?: string
      }
    }) => void
    onCancel?: () => void
    tuiRequestRender?: () => void
  }) => unknown,
  notifySpy = vi.fn(),
): Promise<{ notifySpy: ReturnType<typeof vi.fn> }> {
  let registeredHandler: unknown

  const pi: Pick<ExtensionAPI, 'registerCommand'> = {
    registerCommand: (_name, options) => {
      registeredHandler = options.handler
    },
  }

  registerSettingsCommand(pi)
  expect(typeof registeredHandler === 'function').toBe(true)

  // @ts-expect-error minimal context mock
  await registeredHandler('', {
    cwd: tempRoot,
    ui: {
      custom: vi.fn(
        (
          factory: (...args: unknown[]) => {
            onSave?: (result: {
              permissions: {
                path: string
                read: boolean
                write: boolean
                bash: boolean
              }[]
              reminderInterval: number
              subagentModels: {
                low?: string
                medium?: string
                high?: string
              }
            }) => void
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
        reminderInterval: 5,
        subagentModels: {},
      })
      return {
        permissions: [
          { path: '/allowed-a', read: true, write: false, bash: false },
          { path: '/allowed-b', read: true, write: true, bash: false },
        ],
        reminderInterval: 5,
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
      reminderInterval: 5,
    })
    expect(notifySpy).toHaveBeenCalledWith(
      'Cradle settings saved: 2 permissions, 0 models, reminder interval 5 turns',
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

describe('CradleSettingsEditor — input', () => {
  it('navigates and deletes rows via keyboard', () => {
    const editor = new CradleSettingsEditor(
      {
        permissions: [
          {
            path: path.join(tempRoot, 'a'),
            read: true,
            write: false,
            bash: false,
          },
          {
            path: path.join(tempRoot, 'b'),
            read: true,
            write: false,
            bash: false,
          },
        ],
      },
      tempRoot,
      mockTheme,
    )

    // Initial state: on directory input row (row 2)
    expect(editor.getSelectedRow()).toBe(2)

    // Delete key does nothing when on directory input row
    editor.handleInput('\u001B[3~')
    expect(editor.getRows()).toHaveLength(2)

    // Navigate up to last data row (row 1)
    editor.handleInput('\u001B[A')
    expect(editor.getSelectedRow()).toBe(1)

    // Navigate up to first data row (row 0)
    editor.handleInput('\u001B[A')
    expect(editor.getSelectedRow()).toBe(0)

    // Stops at first row
    editor.handleInput('\u001B[A')
    expect(editor.getSelectedRow()).toBe(0)

    // Navigate down to row 1
    editor.handleInput('\u001B[B')
    expect(editor.getSelectedRow()).toBe(1)

    // Navigate down to directory input row (row 2)
    editor.handleInput('\u001B[B')
    expect(editor.getSelectedRow()).toBe(2)

    // Navigate down to interval row (row 3)
    editor.handleInput('\u001B[B')
    expect(editor.getSelectedRow()).toBe(3)

    // Navigate down to low model row (row 4)
    editor.handleInput('\u001B[B')
    expect(editor.getSelectedRow()).toBe(4)

    // Navigate down to medium model row (row 5)
    editor.handleInput('\u001B[B')
    expect(editor.getSelectedRow()).toBe(5)

    // Navigate down to high model row (row 6)
    editor.handleInput('\u001B[B')
    expect(editor.getSelectedRow()).toBe(6)

    // Stops at high model row
    editor.handleInput('\u001B[B')
    expect(editor.getSelectedRow()).toBe(6)

    // Navigate back up and delete row 1
    editor.handleInput('\u001B[A')
    expect(editor.getSelectedRow()).toBe(5)
    editor.handleInput('\u001B[A')
    expect(editor.getSelectedRow()).toBe(4)
    editor.handleInput('\u001B[A')
    expect(editor.getSelectedRow()).toBe(3)
    editor.handleInput('\u001B[A')
    expect(editor.getSelectedRow()).toBe(2)
    editor.handleInput('\u001B[A')
    expect(editor.getSelectedRow()).toBe(1)
    editor.handleInput('\u001B[3~')
    expect(editor.getRows()).toEqual([
      { path: path.join(tempRoot, 'a'), read: true, write: false, bash: false },
    ])
    expect(editor.isDirty()).toBe(true)
  })
})

describe('CradleSettingsEditor — permissions', () => {
  it('navigates permission columns and toggles values', () => {
    const editor = new CradleSettingsEditor(
      {
        permissions: [
          {
            path: path.join(tempRoot, 'a'),
            read: true,
            write: false,
            bash: false,
          },
        ],
      },
      tempRoot,
      mockTheme,
    )

    // Move up to first data row
    editor.handleInput('\u001B[A')

    // Navigate right to read column (1) and toggle off
    editor.handleInput('\u001B[C')
    expect(editor.getSelectedCol()).toBe(1)
    editor.handleInput(' ')
    expect(editor.getRows()[0]?.read).toBe(false)

    // Navigate right to write column (2) and toggle on
    editor.handleInput('\u001B[C')
    expect(editor.getSelectedCol()).toBe(2)
    editor.handleInput(' ')
    expect(editor.getRows()[0]?.write).toBe(true)

    // Navigate right to bash column (3), then beyond (clamped)
    editor.handleInput('\u001B[C')
    expect(editor.getSelectedCol()).toBe(3)
    editor.handleInput('\u001B[C')
    expect(editor.getSelectedCol()).toBe(3) // clamped

    // Navigate left
    editor.handleInput('\u001B[D')
    expect(editor.getSelectedCol()).toBe(2)
  })
})

describe('CradleSettingsEditor — suggestions', () => {
  it('accepts and dismisses suggestions', async () => {
    await mkdir(path.join(tempRoot, 'testdir'))

    const editor = new CradleSettingsEditor(
      { permissions: [] },
      tempRoot,
      mockTheme,
    )
    editor.tuiRequestRender = vi.fn()

    // Set up suggestions
    editor.getDirInput().setValue('te')
    await editor.updateSuggestions()
    expect(editor.getSuggestions().length).toBeGreaterThan(0)

    // Accept with enter — adds a row and clears input
    editor.handleInput('\r')
    expect(editor.getSuggestions()).toEqual([])
    expect(editor.getRows()).toEqual([
      {
        path: path.join(tempRoot, 'testdir'),
        read: true,
        write: false,
        bash: false,
      },
    ])
    expect(editor.getDirInput().getValue()).toBe('')

    // Set up again
    editor.getDirInput().setValue('te')
    await editor.updateSuggestions()
    expect(editor.getSuggestions().length).toBeGreaterThan(0)

    // Render shows indicator while suggestions are open
    editor.focused = true
    const linesBefore = editor.render(80)
    expect(linesBefore.some((line) => line.includes('▸'))).toBe(true)

    // Dismiss with escape
    editor.handleInput('\u001B')
    expect(editor.getSuggestions()).toEqual([])

    const linesAfter = editor.render(80)
    expect(linesAfter.some((line) => line.includes('▸'))).toBe(false)
  })
})

describe('CradleSettingsEditor — keys', () => {
  it('handles save, cancel, and ignores printable keys when list focused', () => {
    const saveSpy = vi.fn()
    const cancelSpy = vi.fn()
    const editor = new CradleSettingsEditor(
      { permissions: [] },
      tempRoot,
      mockTheme,
    )
    editor.onSave = saveSpy
    editor.onCancel = cancelSpy

    editor.handleInput('\u0013') // ctrl+s
    expect(saveSpy).toHaveBeenCalledWith({
      permissions: [],
      reminderInterval: 3,
      subagentModels: {},
    })

    editor.handleInput('\u001B') // escape
    expect(cancelSpy).toHaveBeenCalled()

    // Printable char ignored when on a data row
    const editorWithItems = new CradleSettingsEditor(
      {
        permissions: [
          {
            path: path.join(tempRoot, 'a'),
            read: true,
            write: false,
            bash: false,
          },
        ],
      },
      tempRoot,
      mockTheme,
    )
    editorWithItems.handleInput('\u001B[A') // move up to data row
    expect(editorWithItems.getSelectedRow()).toBe(0)
    editorWithItems.handleInput('x')
    expect(editorWithItems.getSelectedRow()).toBe(0)
  })
})

describe('CradleSettingsEditor — rendering', () => {
  it('renders in various states and edge cases', () => {
    // With items
    const editor = new CradleSettingsEditor(
      {
        permissions: [
          {
            path: path.join(tempRoot, 'a'),
            read: true,
            write: false,
            bash: false,
          },
        ],
      },
      tempRoot,
      mockTheme,
    )
    editor.focused = true
    const lines = editor.render(80)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.some((line) => line.includes('Cradle Settings'))).toBe(true)
    expect(lines.some((line) => line.includes('a'))).toBe(true)

    // Empty state
    const emptyEditor = new CradleSettingsEditor(
      { permissions: [] },
      tempRoot,
      mockTheme,
    )
    emptyEditor.focused = true
    const emptyLines = emptyEditor.render(80)
    expect(
      emptyLines.some((line) => line.includes('no extra directories')),
    ).toBe(true)

    // Dirty state from permission change
    const dirtyEditor = new CradleSettingsEditor(
      { permissions: [] },
      tempRoot,
      mockTheme,
    )
    dirtyEditor.getDirInput().setValue('x')
    dirtyEditor.addCurrentInput()
    dirtyEditor.focused = true
    const dirtyLines = dirtyEditor.render(80)
    expect(dirtyLines.some((line) => line.includes('Unsaved changes'))).toBe(
      true,
    )

    // Dirty state from interval change
    const intervalDirtyEditor = new CradleSettingsEditor(
      { permissions: [], reminderInterval: 3 },
      tempRoot,
      mockTheme,
    )
    intervalDirtyEditor.handleInput('\u001B[B') // move to interval row
    intervalDirtyEditor.handleInput('5')
    const intervalDirtyLines = intervalDirtyEditor.render(80)
    expect(
      intervalDirtyLines.some((line) => line.includes('Unsaved changes')),
    ).toBe(true)

    // Narrow width
    const narrowLines = emptyEditor.render(1)
    expect(narrowLines.length).toBeGreaterThan(0)

    // Invalidation does not throw
    expect(() => {
      editor.invalidate()
    }).not.toThrow()
  })
})

describe('CradleSettingsEditor — interval', () => {
  it('defaults to 3, reads initial value, and clamps on save', () => {
    // Default when no interval provided
    const editor = new CradleSettingsEditor(
      { permissions: [] },
      tempRoot,
      mockTheme,
    )
    expect(editor.getReminderInterval()).toBe(3)

    // Reads custom initial value from settings
    const customEditor = new CradleSettingsEditor(
      { permissions: [], reminderInterval: 7 },
      tempRoot,
      mockTheme,
    )
    expect(customEditor.getReminderInterval()).toBe(7)

    // Clamps on save (50 → 20)
    const saveSpy = vi.fn()
    editor.onSave = saveSpy
    editor.handleInput('\u001B[B') // move to interval row
    editor.handleInput('5')
    editor.handleInput('0')
    editor.handleInput('\u0013') // ctrl+s

    expect(saveSpy).toHaveBeenCalledWith({
      permissions: [],
      reminderInterval: 20,
      subagentModels: {},
    })
  })
})
