import type { ExtensionAPI, ThemeColor } from '@earendil-works/pi-coding-agent'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadCradleSettings } from '../config/settings.js'
import {
  DirectoryAllowlistEditor,
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
    onSave?: (directories: string[]) => void
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
            onSave?: (directories: string[]) => void
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
  it('saves edited directories and notifies', async () => {
    const { notifySpy } = await invokeRegisteredHandler((editor) => {
      editor.onSave?.(['allowed-a', 'allowed-b'])
      return ['allowed-a', 'allowed-b']
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

describe('DirectoryAllowlistEditor — input', () => {
  it('manages directory list and tracks dirty state', () => {
    const editor = new DirectoryAllowlistEditor([], tempRoot, mockTheme)

    // Add via input
    editor.getInput().setValue('my-dir')
    editor.addCurrentInput()
    expect(editor.getDirectories()).toEqual([path.resolve(tempRoot, 'my-dir')])
    expect(editor.isDirty()).toBe(true)

    // Duplicate ignored
    editor.getInput().setValue('my-dir')
    editor.addCurrentInput()
    expect(editor.getDirectories()).toHaveLength(1)

    // Printable chars go to input when no item selected
    const freshEditor = new DirectoryAllowlistEditor([], tempRoot, mockTheme)
    freshEditor.handleInput('a')
    expect(freshEditor.getInput().getValue()).toBe('a')
  })

  it('navigates and deletes items via keyboard', () => {
    const editor = new DirectoryAllowlistEditor(
      [path.join(tempRoot, 'a'), path.join(tempRoot, 'b')],
      tempRoot,
      mockTheme,
    )

    // Delete does nothing when nothing selected
    editor.deleteSelected()
    expect(editor.getDirectories()).toHaveLength(2)

    // Navigate down
    editor.handleInput('\u001B[B')
    expect(editor.getSelectedIndex()).toBe(0)
    editor.handleInput('\u001B[B')
    expect(editor.getSelectedIndex()).toBe(1)
    // Stops at last item
    editor.handleInput('\u001B[B')
    expect(editor.getSelectedIndex()).toBe(1)

    // Navigate up back to input
    editor.handleInput('\u001B[A')
    expect(editor.getSelectedIndex()).toBe(0)
    editor.handleInput('\u001B[A')
    expect(editor.getSelectedIndex()).toBe(-1)

    // Delete selected item via handleInput (delete key)
    editor.handleInput('\u001B[B')
    editor.handleInput('\u001B[3~')
    expect(editor.getDirectories()).toEqual([path.join(tempRoot, 'b')])
    expect(editor.isDirty()).toBe(true)
  })
})

describe('DirectoryAllowlistEditor — suggestions', () => {
  it('accepts and completes suggestions via enter and tab', async () => {
    await mkdir(path.join(tempRoot, 'testdir'))

    const editor = new DirectoryAllowlistEditor([], tempRoot, mockTheme)
    editor.tuiRequestRender = vi.fn()

    // Enter adds to list
    editor.getInput().setValue('te')
    await editor.updateSuggestions()
    expect(editor.getSuggestions().length).toBeGreaterThan(0)
    editor.handleInput('\r')
    expect(editor.getSuggestions()).toEqual([])
    expect(editor.getDirectories()).toEqual([path.join(tempRoot, 'testdir')])
    expect(editor.getInput().getValue()).toBe('')

    // Tab completes without adding, cursor at end
    const tabEditor = new DirectoryAllowlistEditor([], tempRoot, mockTheme)
    tabEditor.tuiRequestRender = vi.fn()
    tabEditor.getInput().setValue('te')
    await tabEditor.updateSuggestions()
    tabEditor.handleInput('\t')
    expect(tabEditor.getSuggestions()).toEqual([])
    expect(tabEditor.getDirectories()).toEqual([])
    expect(tabEditor.getInput().getValue()).toBe('testdir')
    tabEditor.handleInput('x')
    expect(tabEditor.getInput().getValue()).toBe('testdirx')
  })

  it('browses inside directories and completes nested paths', async () => {
    await mkdir(path.join(tempRoot, 'parent'))
    await mkdir(path.join(tempRoot, 'parent', 'child-a'))
    await mkdir(path.join(tempRoot, 'parent', 'child-b'))

    const editor = new DirectoryAllowlistEditor([], tempRoot, mockTheme)
    editor.tuiRequestRender = vi.fn()

    editor.getInput().setValue('parent/')
    await editor.updateSuggestions()
    expect(editor.getSuggestions()).toEqual([
      path.join(tempRoot, 'parent', 'child-a'),
      path.join(tempRoot, 'parent', 'child-b'),
    ])

    editor.handleInput('\t')
    expect(editor.getSuggestions()).toEqual([])
    expect(editor.getInput().getValue()).toBe('parent/child-a')
  })

  it('dismisses suggestions on escape and renders them', async () => {
    await mkdir(path.join(tempRoot, 'testdir'))

    const editor = new DirectoryAllowlistEditor([], tempRoot, mockTheme)
    editor.tuiRequestRender = vi.fn()

    editor.getInput().setValue('te')
    await editor.updateSuggestions()
    expect(editor.getSuggestions().length).toBeGreaterThan(0)

    // Render shows indicator while suggestions are open
    editor.focused = true
    const linesBefore = editor.render(80)
    expect(linesBefore.some((line) => line.includes('▸'))).toBe(true)

    // Press up arrow while suggestions open (covers suggestion navigation)
    editor.handleInput('\u001B[A')

    // Press an unhandled key while suggestions open (covers dismiss false branch)
    editor.handleInput('z')

    // Escape dismisses
    editor.handleInput('\u001B')
    expect(editor.getSuggestions()).toEqual([])

    const linesAfter = editor.render(80)
    expect(linesAfter.some((line) => line.includes('▸'))).toBe(false)
  })
})

describe('DirectoryAllowlistEditor — keys', () => {
  it('handles save, cancel, and ignores printable keys when list focused', () => {
    const saveSpy = vi.fn()
    const cancelSpy = vi.fn()
    const editor = new DirectoryAllowlistEditor([], tempRoot, mockTheme)
    editor.onSave = saveSpy
    editor.onCancel = cancelSpy

    editor.handleInput('\u0013') // ctrl+s
    expect(saveSpy).toHaveBeenCalledWith([])

    editor.handleInput('\u001B') // escape
    expect(cancelSpy).toHaveBeenCalled()

    // Printable char ignored when list is focused
    const editorWithItems = new DirectoryAllowlistEditor(
      [path.join(tempRoot, 'a')],
      tempRoot,
      mockTheme,
    )
    editorWithItems.handleInput('\u001B[B')
    expect(editorWithItems.getSelectedIndex()).toBe(0)
    editorWithItems.handleInput('x')
    expect(editorWithItems.getSelectedIndex()).toBe(0)
  })
})

describe('DirectoryAllowlistEditor — rendering', () => {
  it('renders in various states and edge cases', () => {
    // With items
    const editor = new DirectoryAllowlistEditor(
      [path.join(tempRoot, 'a')],
      tempRoot,
      mockTheme,
    )
    editor.focused = true
    const lines = editor.render(80)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.some((line) => line.includes('Extra Read Directories'))).toBe(
      true,
    )
    expect(lines.some((line) => line.includes('a'))).toBe(true)

    // Empty state
    const emptyEditor = new DirectoryAllowlistEditor([], tempRoot, mockTheme)
    emptyEditor.focused = true
    const emptyLines = emptyEditor.render(80)
    expect(
      emptyLines.some((line) => line.includes('no extra directories')),
    ).toBe(true)

    // Dirty state
    const dirtyEditor = new DirectoryAllowlistEditor([], tempRoot, mockTheme)
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

    // Empty input render (mocked)
    const mockedEditor = new DirectoryAllowlistEditor([], tempRoot, mockTheme)
    vi.spyOn(mockedEditor.getInput(), 'render').mockReturnValue([])
    mockedEditor.focused = true
    const mockedLines = mockedEditor.render(80)
    expect(
      mockedLines.some((line) => line.includes('Extra Read Directories')),
    ).toBe(true)

    // Invalidation does not throw
    expect(() => {
      editor.invalidate()
    }).not.toThrow()
  })
})
