import type { ExtensionAPI, ThemeColor } from '@earendil-works/pi-coding-agent'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadCradleSettings } from '../config/settings.js'
import {
  DirectoryPermissionsEditor,
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
    onSave?: (
      rows: { path: string; read: boolean; write: boolean; bash: boolean }[],
    ) => void
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
            onSave?: (
              rows: {
                path: string
                read: boolean
                write: boolean
                bash: boolean
              }[],
            ) => void
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
      editor.onSave?.([
        { path: '/allowed-a', read: true, write: false, bash: false },
        { path: '/allowed-b', read: true, write: true, bash: false },
      ])
      return [
        { path: '/allowed-a', read: true, write: false, bash: false },
        { path: '/allowed-b', read: true, write: true, bash: false },
      ]
    })

    await expect(loadCradleSettings(tempRoot)).resolves.toEqual({
      permissions: [
        { path: '/allowed-a', read: true, write: false, bash: false },
        { path: '/allowed-b', read: true, write: true, bash: false },
      ],
    })
    expect(notifySpy).toHaveBeenCalledWith(
      'Cradle settings saved: 2 directory permissions',
      'info',
    )
  })

  it('leaves settings unchanged when editing is cancelled', async () => {
    const { notifySpy } = await invokeRegisteredHandler((editor) => {
      editor.onCancel?.()
    })

    await expect(loadCradleSettings(tempRoot)).resolves.toEqual({})
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

describe('DirectoryPermissionsEditor — input', () => {
  it('manages rows and tracks dirty state', () => {
    const editor = new DirectoryPermissionsEditor([], tempRoot, mockTheme)

    editor.getInput().setValue('my-dir')
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
    editor.getInput().setValue('my-dir')
    editor.addCurrentInput()
    expect(editor.getRows()).toHaveLength(1)

    // Printable chars go to input when on input row
    const freshEditor = new DirectoryPermissionsEditor([], tempRoot, mockTheme)
    freshEditor.handleInput('a')
    expect(freshEditor.getInput().getValue()).toBe('a')
  })

  it('navigates and deletes rows via keyboard', () => {
    const editor = new DirectoryPermissionsEditor(
      [
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
      tempRoot,
      mockTheme,
    )

    // Initial state: on input row
    expect(editor.getSelectedRow()).toBe(2)

    // Delete key does nothing when on input row
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

    // Navigate down to input row
    editor.handleInput('\u001B[B')
    expect(editor.getSelectedRow()).toBe(2)

    // Stops at input row
    editor.handleInput('\u001B[B')
    expect(editor.getSelectedRow()).toBe(2)

    // Navigate back up and delete row 1
    editor.handleInput('\u001B[A')
    expect(editor.getSelectedRow()).toBe(1)
    editor.handleInput('\u001B[3~')
    expect(editor.getRows()).toEqual([
      { path: path.join(tempRoot, 'a'), read: true, write: false, bash: false },
    ])
    expect(editor.isDirty()).toBe(true)
  })
})

describe('DirectoryPermissionsEditor — edge cases', () => {
  it('ignores toggle for invalid indices', () => {
    const editor = new DirectoryPermissionsEditor(
      [
        {
          path: path.join(tempRoot, 'a'),
          read: true,
          write: false,
          bash: false,
        },
      ],
      tempRoot,
      mockTheme,
    )

    // Invalid colIndex (0 = path column, not a permission toggle)
    editor.togglePermission(0, 0)
    expect(editor.getRows()[0]?.read).toBe(true)

    // Invalid colIndex out of range
    editor.togglePermission(0, 5)
    expect(editor.getRows()[0]?.read).toBe(true)

    // Invalid rowIndex
    editor.togglePermission(5, 1)
    expect(editor.getRows()).toHaveLength(1)
  })

  it('ignores space/enter when on path column', () => {
    const editor = new DirectoryPermissionsEditor(
      [
        {
          path: path.join(tempRoot, 'a'),
          read: true,
          write: false,
          bash: false,
        },
      ],
      tempRoot,
      mockTheme,
    )

    // Move up to data row (col defaults to 0 = path column)
    editor.handleInput('\u001B[A')
    expect(editor.getSelectedRow()).toBe(0)
    expect(editor.getSelectedCol()).toBe(0)

    // Space on path column does nothing
    editor.handleInput(' ')
    expect(editor.getRows()[0]?.read).toBe(true)

    // Enter on path column does nothing
    editor.handleInput('\r')
    expect(editor.getRows()[0]?.read).toBe(true)
  })
})

describe('DirectoryPermissionsEditor — permissions', () => {
  it('toggles permissions with space', () => {
    const editor = new DirectoryPermissionsEditor(
      [
        {
          path: path.join(tempRoot, 'a'),
          read: true,
          write: false,
          bash: false,
        },
      ],
      tempRoot,
      mockTheme,
    )

    // Start on input row; move up to first data row
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
    const editor = new DirectoryPermissionsEditor(
      [
        {
          path: path.join(tempRoot, 'a'),
          read: true,
          write: false,
          bash: false,
        },
      ],
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

describe('DirectoryPermissionsEditor — suggestions', () => {
  it('accepts and completes suggestions via enter and tab', async () => {
    await mkdir(path.join(tempRoot, 'testdir'))

    const editor = new DirectoryPermissionsEditor([], tempRoot, mockTheme)
    editor.tuiRequestRender = vi.fn()

    editor.getInput().setValue('te')
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
    expect(editor.getInput().getValue()).toBe('')
  })

  it('dismisses suggestions on escape and renders them', async () => {
    await mkdir(path.join(tempRoot, 'testdir'))

    const editor = new DirectoryPermissionsEditor([], tempRoot, mockTheme)
    editor.tuiRequestRender = vi.fn()

    editor.getInput().setValue('te')
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

describe('DirectoryPermissionsEditor — keys', () => {
  it('handles save, cancel, and ignores printable keys when list focused', () => {
    const saveSpy = vi.fn()
    const cancelSpy = vi.fn()
    const editor = new DirectoryPermissionsEditor([], tempRoot, mockTheme)
    editor.onSave = saveSpy
    editor.onCancel = cancelSpy

    editor.handleInput('\u0013') // ctrl+s
    expect(saveSpy).toHaveBeenCalledWith([])

    editor.handleInput('\u001B') // escape
    expect(cancelSpy).toHaveBeenCalled()

    // Printable char ignored when on a data row
    const editorWithItems = new DirectoryPermissionsEditor(
      [
        {
          path: path.join(tempRoot, 'a'),
          read: true,
          write: false,
          bash: false,
        },
      ],
      tempRoot,
      mockTheme,
    )
    editorWithItems.handleInput('\u001B[A') // move up to data row
    expect(editorWithItems.getSelectedRow()).toBe(0)
    editorWithItems.handleInput('x')
    expect(editorWithItems.getSelectedRow()).toBe(0)
  })
})

describe('DirectoryPermissionsEditor — rendering', () => {
  it('renders in various states and edge cases', () => {
    // With items
    const editor = new DirectoryPermissionsEditor(
      [
        {
          path: path.join(tempRoot, 'a'),
          read: true,
          write: false,
          bash: false,
        },
      ],
      tempRoot,
      mockTheme,
    )
    editor.focused = true
    const lines = editor.render(80)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.some((line) => line.includes('Directory Permissions'))).toBe(
      true,
    )
    expect(lines.some((line) => line.includes('a'))).toBe(true)

    // Empty state
    const emptyEditor = new DirectoryPermissionsEditor([], tempRoot, mockTheme)
    emptyEditor.focused = true
    const emptyLines = emptyEditor.render(80)
    expect(
      emptyLines.some((line) => line.includes('no extra directories')),
    ).toBe(true)

    // Dirty state
    const dirtyEditor = new DirectoryPermissionsEditor([], tempRoot, mockTheme)
    dirtyEditor.getInput().setValue('x')
    dirtyEditor.addCurrentInput()
    dirtyEditor.focused = true
    const dirtyLines = dirtyEditor.render(80)
    expect(dirtyLines.some((line) => line.includes('Unsaved changes'))).toBe(
      true,
    )

    // Narrow width
    const narrowLines = emptyEditor.render(1)
    expect(narrowLines.length).toBeGreaterThan(0)

    // Invalidation does not throw
    expect(() => {
      editor.invalidate()
    }).not.toThrow()
  })
})
