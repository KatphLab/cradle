import type { ExtensionAPI, ThemeColor } from '@earendil-works/pi-coding-agent'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CradleSettingsEditor,
  formatDirectoryPath,
  registerSettingsCommand,
  scanDirectorySuggestions,
} from './settings.js'

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
      })
      return {
        permissions: [
          { path: '/allowed-a', read: true, write: false, bash: false },
          { path: '/allowed-b', read: true, write: true, bash: false },
        ],
        reminderInterval: 5,
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
      'Cradle settings saved: 2 permissions, reminder interval 5 turns',
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
  it('manages rows and tracks dirty state', () => {
    const editor = new CradleSettingsEditor(
      { permissions: [] },
      tempRoot,
      mockTheme,
    )

    editor.getDirInput().setValue('my-dir')
    editor.addCurrentInput()
    expect(editor.getRows()).toEqual([
      {
        path: path.resolve(tempRoot, 'my-dir'),
        read: true,
        write: false,
        bash: false,
      },
    ])
    expect(editor.isDirty()).toBe(true)

    // Duplicate ignored
    editor.getDirInput().setValue('my-dir')
    editor.addCurrentInput()
    expect(editor.getRows()).toHaveLength(1)

    // Printable chars go to input when on input row
    const freshEditor = new CradleSettingsEditor(
      { permissions: [] },
      tempRoot,
      mockTheme,
    )
    freshEditor.handleInput('a')
    expect(freshEditor.getDirInput().getValue()).toBe('a')
  })

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

    // Stops at interval row
    editor.handleInput('\u001B[B')
    expect(editor.getSelectedRow()).toBe(3)

    // Navigate back up and delete row 1
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
  it('toggles permissions with space', () => {
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

    // Start on directory input row; move up to first data row
    editor.handleInput('\u001B[A')
    expect(editor.getSelectedRow()).toBe(0)
    expect(editor.getSelectedCol()).toBe(0)

    // Move to read column
    editor.handleInput('\u001B[C')
    expect(editor.getSelectedCol()).toBe(1)

    // Toggle read off
    editor.handleInput(' ')
    expect(editor.getRows()[0]?.read).toBe(false)

    // Move to write column
    editor.handleInput('\u001B[C')
    expect(editor.getSelectedCol()).toBe(2)

    // Toggle write on
    editor.handleInput(' ')
    expect(editor.getRows()[0]?.write).toBe(true)
  })

  it('navigates between permission columns', () => {
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

    // Move up to data row
    editor.handleInput('\u001B[A')
    editor.handleInput('\u001B[C')
    expect(editor.getSelectedCol()).toBe(1)
    editor.handleInput('\u001B[C')
    expect(editor.getSelectedCol()).toBe(2)
    editor.handleInput('\u001B[C')
    expect(editor.getSelectedCol()).toBe(3)
    editor.handleInput('\u001B[C')
    expect(editor.getSelectedCol()).toBe(3) // clamped
    editor.handleInput('\u001B[D')
    expect(editor.getSelectedCol()).toBe(2)
  })
})

describe('CradleSettingsEditor — suggestions', () => {
  it('accepts and completes suggestions via enter and tab', async () => {
    await mkdir(path.join(tempRoot, 'testdir'))

    const editor = new CradleSettingsEditor(
      { permissions: [] },
      tempRoot,
      mockTheme,
    )
    editor.tuiRequestRender = vi.fn()

    editor.getDirInput().setValue('te')
    await editor.updateSuggestions()
    expect(editor.getSuggestions().length).toBeGreaterThan(0)
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
  })

  it('dismisses suggestions on escape and renders them', async () => {
    await mkdir(path.join(tempRoot, 'testdir'))

    const editor = new CradleSettingsEditor(
      { permissions: [] },
      tempRoot,
      mockTheme,
    )
    editor.tuiRequestRender = vi.fn()

    editor.getDirInput().setValue('te')
    await editor.updateSuggestions()
    expect(editor.getSuggestions().length).toBeGreaterThan(0)

    // Render shows indicator while suggestions are open
    editor.focused = true
    const linesBefore = editor.render(80)
    expect(linesBefore.some((line) => line.includes('▸'))).toBe(true)

    // Escape dismisses
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
  it('defaults to 3 when no interval is provided', () => {
    const editor = new CradleSettingsEditor(
      { permissions: [] },
      tempRoot,
      mockTheme,
    )
    expect(editor.getReminderInterval()).toBe(3)
  })

  it('reads the initial interval from settings', () => {
    const editor = new CradleSettingsEditor(
      { permissions: [], reminderInterval: 7 },
      tempRoot,
      mockTheme,
    )
    expect(editor.getReminderInterval()).toBe(7)
  })

  it('clamps interval on save', () => {
    const saveSpy = vi.fn()
    const editor = new CradleSettingsEditor(
      { permissions: [] },
      tempRoot,
      mockTheme,
    )
    editor.onSave = saveSpy

    editor.handleInput('\u001B[B') // move to interval row
    // Type 50
    editor.handleInput('5')
    editor.handleInput('0')
    editor.handleInput('\u0013') // ctrl+s

    expect(saveSpy).toHaveBeenCalledWith({
      permissions: [],
      reminderInterval: 20,
    })
  })
})
