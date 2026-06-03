import type { ThemeColor } from '@earendil-works/pi-coding-agent'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GlobalSettings, ProjectSettings } from '../../config/settings.js'
import { CradleSettingsEditor } from '../settings/editor.js'

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

function makeEditor(
  project: ProjectSettings = {},
  global: GlobalSettings = {},
  models?: { id: string; name: string; provider: string }[],
): CradleSettingsEditor {
  return new CradleSettingsEditor(project, global, tempRoot, mockTheme, models)
}

describe('CradleSettingsEditor — input', () => {
  it('navigates and deletes rows via keyboard', () => {
    const editor = makeEditor({
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
    })
    const down = () => {
      editor.handleInput('\u001B[B')
    }
    const up = () => {
      editor.handleInput('\u001B[A')
    }

    expect(editor.getSelectedRow()).toBe(2) // initial: directory input
    editor.handleInput('\u001B[3~')
    expect(editor.getRows()).toHaveLength(2) // delete ignored on input row

    up()
    expect(editor.getSelectedRow()).toBe(1)
    up()
    expect(editor.getSelectedRow()).toBe(0)
    up()
    expect(editor.getSelectedRow()).toBe(0) // stops at top

    down()
    expect(editor.getSelectedRow()).toBe(1)
    down()
    expect(editor.getSelectedRow()).toBe(2) // directory input
    down()
    expect(editor.getSelectedRow()).toBe(3) // token threshold
    down()
    expect(editor.getSelectedRow()).toBe(4) // low model
    down()
    expect(editor.getSelectedRow()).toBe(5) // medium
    down()
    expect(editor.getSelectedRow()).toBe(6) // high
    down()
    expect(editor.getSelectedRow()).toBe(7) // advisor
    down()
    expect(editor.getSelectedRow()).toBe(8) // firecrawl API key
    down()
    expect(editor.getSelectedRow()).toBe(9) // tavily API key
    down()
    expect(editor.getSelectedRow()).toBe(9) // stops at bottom

    up()
    up()
    up()
    up()
    up()
    up()
    up()
    up()
    expect(editor.getSelectedRow()).toBe(1) // back to row 1
    editor.handleInput('\u001B[3~')
    expect(editor.getRows()).toEqual([
      { path: path.join(tempRoot, 'a'), read: true, write: false, bash: false },
    ])
    expect(editor.isDirty()).toBe(true)
  })
})

describe('CradleSettingsEditor — permissions', () => {
  it('navigates permission columns and toggles values', () => {
    const editor = makeEditor({
      permissions: [
        {
          path: path.join(tempRoot, 'a'),
          read: true,
          write: false,
          bash: false,
        },
      ],
    })

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

    const editor = makeEditor()
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
    const editor = makeEditor()
    editor.onSave = saveSpy
    editor.onCancel = cancelSpy

    editor.handleInput('\u0013') // ctrl+s
    expect(saveSpy).toHaveBeenCalledWith({
      permissions: [],
      reminderTokenThreshold: 6000,
      subagentModels: {},
      advisorModel: undefined,
      firecrawlApiKey: undefined,
    })

    editor.handleInput('\u001B') // escape
    expect(cancelSpy).toHaveBeenCalled()

    // Printable char ignored when on a data row
    const editorWithItems = makeEditor({
      permissions: [
        {
          path: path.join(tempRoot, 'a'),
          read: true,
          write: false,
          bash: false,
        },
      ],
    })
    editorWithItems.handleInput('\u001B[A') // move up to data row
    expect(editorWithItems.getSelectedRow()).toBe(0)
    editorWithItems.handleInput('x')
    expect(editorWithItems.getSelectedRow()).toBe(0)
  })
})

describe('CradleSettingsEditor — rendering', () => {
  it('renders in various states and edge cases', () => {
    // With items
    const editor = makeEditor({
      permissions: [
        {
          path: path.join(tempRoot, 'a'),
          read: true,
          write: false,
          bash: false,
        },
      ],
    })
    editor.focused = true
    const lines = editor.render(80)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.some((line) => line.includes('Cradle Settings'))).toBe(true)
    expect(lines.some((line) => line.includes('a'))).toBe(true)

    // Empty state
    const emptyEditor = makeEditor()
    emptyEditor.focused = true
    const emptyLines = emptyEditor.render(80)
    expect(
      emptyLines.some((line) => line.includes('no extra directories')),
    ).toBe(true)

    // Dirty state from permission change
    const dirtyEditor = makeEditor()
    dirtyEditor.getDirInput().setValue('x')
    dirtyEditor.addCurrentInput()
    dirtyEditor.focused = true
    const dirtyLines = dirtyEditor.render(80)
    expect(dirtyLines.some((line) => line.includes('Unsaved changes'))).toBe(
      true,
    )

    // Dirty state from token threshold change
    const tokenThresholdDirtyEditor = makeEditor(
      {},
      { reminderTokenThreshold: 6000 },
    )
    tokenThresholdDirtyEditor.handleInput('\u001B[B') // move to threshold row
    tokenThresholdDirtyEditor.handleInput('5')
    const tokenThresholdDirtyLines = tokenThresholdDirtyEditor.render(80)
    expect(
      tokenThresholdDirtyLines.some((line) => line.includes('Unsaved changes')),
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

describe('CradleSettingsEditor — model select list', () => {
  it('opens select list when Enter is pressed', () => {
    const editor = makeEditor({}, {}, [
      { id: 'a', name: 'A', provider: 'test' },
      { id: 'b', name: 'B', provider: 'test' },
    ])
    editor.tuiRequestRender = vi.fn()
    editor.handleInput('\u001B[B')
    editor.handleInput('\u001B[B')
    editor.handleInput('\r')
    expect(editor.getSelectList()).toBeDefined()
  })

  it('selects model from list', () => {
    const editor = makeEditor({}, { subagentModels: { low: 'a' } }, [
      { id: 'a', name: 'A', provider: 'test' },
      { id: 'b', name: 'B', provider: 'test' },
    ])
    editor.tuiRequestRender = vi.fn()
    editor.handleInput('\u001B[B')
    editor.handleInput('\u001B[B')
    editor.handleInput('\r')
    editor.handleInput('\u001B[B')
    editor.handleInput('\r')
    expect(editor.getSubagentModels().low).toBe('b')
    expect(editor.isDirty()).toBe(true)
  })

  it('opens advisor model select list', () => {
    const editor = makeEditor({}, { advisorModel: 'a' }, [
      { id: 'a', name: 'A', provider: 'test' },
      { id: 'b', name: 'B', provider: 'test' },
    ])
    editor.tuiRequestRender = vi.fn()
    // Navigate down to advisor model row (row 5 with empty permissions)
    editor.handleInput('\u001B[B')
    editor.handleInput('\u001B[B')
    editor.handleInput('\u001B[B')
    editor.handleInput('\u001B[B')
    editor.handleInput('\u001B[B')
    editor.handleInput('\r')
    expect(editor.getSelectList()).toBeDefined()
  })

  it('selects advisor model from list', () => {
    const editor = makeEditor({}, { advisorModel: 'a' }, [
      { id: 'a', name: 'A', provider: 'test' },
      { id: 'b', name: 'B', provider: 'test' },
    ])
    editor.tuiRequestRender = vi.fn()
    // Navigate down to advisor model row (row 5 with empty permissions)
    editor.handleInput('\u001B[B')
    editor.handleInput('\u001B[B')
    editor.handleInput('\u001B[B')
    editor.handleInput('\u001B[B')
    editor.handleInput('\u001B[B')
    editor.handleInput('\r')
    editor.handleInput('\u001B[B')
    editor.handleInput('\r')
    expect(editor.advisorModel).toBe('b')
    expect(editor.isDirty()).toBe(true)
  })

  it('cancels model select', () => {
    const editor = makeEditor({}, { subagentModels: { low: 'a' } }, [
      { id: 'a', name: 'A', provider: 'test' },
      { id: 'b', name: 'B', provider: 'test' },
    ])
    editor.tuiRequestRender = vi.fn()
    editor.handleInput('\u001B[B')
    editor.handleInput('\u001B[B')
    editor.handleInput('\r')
    expect(editor.getSelectList()).toBeDefined()
    editor.handleInput('\u001B')
    expect(editor.getSelectList()).toBeUndefined()
    expect(editor.getSubagentModels().low).toBe('a')
  })

  it('cancels advisor model select', () => {
    const editor = makeEditor({}, { advisorModel: 'a' }, [
      { id: 'a', name: 'A', provider: 'test' },
      { id: 'b', name: 'B', provider: 'test' },
    ])
    editor.tuiRequestRender = vi.fn()
    editor.handleInput('\u001B[B')
    editor.handleInput('\u001B[B')
    editor.handleInput('\u001B[B')
    editor.handleInput('\u001B[B')
    editor.handleInput('\u001B[B')
    editor.handleInput('\r')
    expect(editor.getSelectList()).toBeDefined()
    editor.handleInput('\u001B')
    expect(editor.getSelectList()).toBeUndefined()
    expect(editor.advisorModel).toBe('a')
  })

  it('renders with subagent model select open', () => {
    const editor = makeEditor({}, { subagentModels: { low: 'a' } }, [
      { id: 'a', name: 'A', provider: 'test' },
      { id: 'b', name: 'B', provider: 'test' },
    ])
    editor.tuiRequestRender = vi.fn()
    editor.focused = true
    editor.handleInput('\u001B[B')
    editor.handleInput('\u001B[B')
    editor.handleInput('\r')
    const lines = editor.render(80)
    expect(lines.some((line) => line.includes('A') || line.includes('B'))).toBe(
      true,
    )
  })

  it('renders with advisor model select open', () => {
    const editor = makeEditor({}, { advisorModel: 'a' }, [
      { id: 'a', name: 'A', provider: 'test' },
      { id: 'b', name: 'B', provider: 'test' },
    ])
    editor.tuiRequestRender = vi.fn()
    editor.focused = true
    editor.handleInput('\u001B[B')
    editor.handleInput('\u001B[B')
    editor.handleInput('\u001B[B')
    editor.handleInput('\u001B[B')
    editor.handleInput('\u001B[B')
    editor.handleInput('\r')
    const lines = editor.render(80)
    expect(lines.some((line) => line.includes('A') || line.includes('B'))).toBe(
      true,
    )
  })
})

describe('CradleSettingsEditor — reminder token threshold', () => {
  it('defaults to 6000, reads initial value, and clamps on save', () => {
    const editor = makeEditor()
    expect(editor.getReminderTokenThreshold()).toBe(6000)

    const customEditor = makeEditor({}, { reminderTokenThreshold: 7000 })
    expect(customEditor.getReminderTokenThreshold()).toBe(7000)

    const saveSpy = vi.fn()
    editor.onSave = saveSpy
    editor.handleInput('\u001B[B') // move to token threshold row
    editor.handleInput('9')
    editor.handleInput('9')
    editor.handleInput('9')
    editor.handleInput('9')
    editor.handleInput('9')
    editor.handleInput('\u0013') // ctrl+s

    expect(saveSpy).toHaveBeenCalledWith({
      permissions: [],
      reminderTokenThreshold: 50_000,
      subagentModels: {},
      advisorModel: undefined,
      firecrawlApiKey: undefined,
      tavilyApiKey: undefined,
    })
  })
})

describe('CradleSettingsEditor — firecrawl API key', () => {
  it('reads initial value from global settings', () => {
    const editor = makeEditor({}, { firecrawlApiKey: 'test-key' })
    expect(editor.getFirecrawlApiKey()).toBe('test-key')
  })

  it('returns undefined when empty', () => {
    const editor = makeEditor()
    expect(editor.getFirecrawlApiKey()).toBeUndefined()
  })

  it('detects dirty on key change', () => {
    const editor = makeEditor({}, { firecrawlApiKey: 'old-key' })
    expect(editor.isDirty()).toBe(false)
    // Navigate to API key row (rows.length + 6 = 6)
    for (let index = 0; index < 6; index++) {
      editor.handleInput('\u001B[B')
    }
    editor.handleInput('n')
    expect(editor.isDirty()).toBe(true)
  })

  it('includes key in save result', () => {
    const saveSpy = vi.fn()
    const editor = makeEditor()
    editor.onSave = saveSpy
    // Navigate to API key row and type
    for (let index = 0; index < 6; index++) {
      editor.handleInput('\u001B[B')
    }
    editor.handleInput('f')
    editor.handleInput('c')
    editor.handleInput('-')
    editor.handleInput('k')
    editor.handleInput('e')
    editor.handleInput('y')
    editor.handleInput('\u0013')

    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ firecrawlApiKey: 'fc-key' }),
    )
  })
})

describe('CradleSettingsEditor — tavily API key', () => {
  it('reads initial value from global settings', () => {
    const editor = makeEditor({}, { tavilyApiKey: 'test-key' })
    expect(editor.getTavilyApiKey()).toBe('test-key')
  })

  it('returns undefined when empty', () => {
    const editor = makeEditor()
    expect(editor.getTavilyApiKey()).toBeUndefined()
  })

  it('detects dirty on key change', () => {
    const editor = makeEditor({}, { tavilyApiKey: 'old-key' })
    expect(editor.isDirty()).toBe(false)
    // Navigate to tavily API key row (rows.length + 7 = 7)
    for (let index = 0; index < 7; index++) {
      editor.handleInput('\u001B[B')
    }
    editor.handleInput('n')
    expect(editor.isDirty()).toBe(true)
  })

  it('includes key in save result', () => {
    const saveSpy = vi.fn()
    const editor = makeEditor()
    editor.onSave = saveSpy
    // Navigate to tavily API key row and type
    for (let index = 0; index < 7; index++) {
      editor.handleInput('\u001B[B')
    }
    editor.handleInput('t')
    editor.handleInput('v')
    editor.handleInput('l')
    editor.handleInput('y')
    editor.handleInput('-')
    editor.handleInput('k')
    editor.handleInput('e')
    editor.handleInput('y')
    editor.handleInput('\u0013')

    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tavilyApiKey: 'tvly-key' }),
    )
  })
})
