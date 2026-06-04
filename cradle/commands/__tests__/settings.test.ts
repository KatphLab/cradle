// Mock homedir before any imports to isolate global settings per test suite.
// The settings module computes GLOBAL_CONFIG_FILE_PATH at import time
// using homedir(), so this mock must be hoisted before that import.
import path from 'node:path'
import { vi } from 'vitest'

vi.mock('node:os', async () => {
  const actual = await vi.importActual('node:os')
  const home = path.join(
    ((actual as Record<string, unknown>)['tmpdir'] as () => string)(),
    'pi-settings-global-test-home',
  )
  return { ...actual, homedir: () => home }
})

import type { ExtensionAPI, ThemeColor } from '@earendil-works/pi-coding-agent'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registerSettingsCommand } from '../settings.js'
import {
  formatDirectoryPath,
  scanDirectorySuggestions,
} from '../settings/utilities.js'

let tempRoot: string
// The vi.mock above replaced homedir() with one pointing to this directory.
const globalSettingsHome = path.join(tmpdir(), 'pi-settings-global-test-home')
const globalSettingsPath = path.join(
  globalSettingsHome,
  '.pi',
  'cradle',
  'settings.json',
)

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'pi-settings-test-'))
  await mkdir(path.dirname(globalSettingsPath), { recursive: true })
  await writeFile(globalSettingsPath, '{}')
})

afterEach(async () => {
  await rm(tempRoot, { force: true, recursive: true })
  try {
    await rm(globalSettingsPath, { force: true })
  } catch {
    // ignore
  }
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
  compactionModel?: string
  firecrawlApiKey?: string
  tavilyApiKey?: string
  exaApiKey?: string
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readSettings(
  filePath: string,
): Promise<Record<string, unknown>> {
  const raw: unknown = JSON.parse(await readFile(filePath, 'utf8'))
  if (!isRecord(raw)) {
    throw new Error(`Expected JSON object at ${filePath}`)
  }
  return raw
}

function projectSettingsPath(): string {
  return path.join(tempRoot, '.pi', 'cradle', 'settings.json')
}

describe('registerSettingsCommand', () => {
  it('saves edited permissions to project settings and notifies', async () => {
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

    const saved = await readSettings(projectSettingsPath())
    expect(saved).toEqual({
      permissions: [
        { path: '/allowed-a', read: true, write: false, bash: false },
        { path: '/allowed-b', read: true, write: true, bash: false },
      ],
    })
    const globalSaved = await readSettings(globalSettingsPath)
    expect(globalSaved['reminderTokenThreshold']).toBe(5000)
    expect(notifySpy).toHaveBeenCalledWith(
      'Cradle settings saved: 2 permissions, 0 models, reminder token threshold 5000',
      'info',
    )
  })

  it('saves advisor model to global settings and notifies', async () => {
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

    const saved = await readSettings(projectSettingsPath())
    expect(saved).toEqual({ permissions: [] })
    const globalSaved = await readSettings(globalSettingsPath)
    expect(globalSaved['advisorModel']).toBe('gpt-4')
    expect(globalSaved['reminderTokenThreshold']).toBe(5000)
    expect(notifySpy).toHaveBeenCalledWith(
      'Cradle settings saved: 0 permissions, 1 models, reminder token threshold 5000',
      'info',
    )
  })

  it('saves compaction model to global settings and notifies', async () => {
    const { notifySpy } = await invokeRegisteredHandler((editor) => {
      editor.onSave?.({
        permissions: [],
        reminderTokenThreshold: 5000,
        subagentModels: {},
        compactionModel: 'google/gemini-2.5-flash',
      })
      return {
        permissions: [],
        reminderTokenThreshold: 5000,
        subagentModels: {},
        compactionModel: 'google/gemini-2.5-flash',
      }
    })

    const saved = await readSettings(projectSettingsPath())
    expect(saved).toEqual({ permissions: [] })
    const globalSaved = await readSettings(globalSettingsPath)
    expect(globalSaved['compactionModel']).toBe('google/gemini-2.5-flash')
    expect(globalSaved['reminderTokenThreshold']).toBe(5000)
    expect(notifySpy).toHaveBeenCalledWith(
      'Cradle settings saved: 0 permissions, 1 models, reminder token threshold 5000',
      'info',
    )
  })

  it('saves firecrawl API key to global settings', async () => {
    const { notifySpy } = await invokeRegisteredHandler((editor) => {
      editor.onSave?.({
        permissions: [],
        reminderTokenThreshold: 6000,
        subagentModels: {},
        firecrawlApiKey: 'test-fc-key',
      })
      return {
        permissions: [],
        reminderTokenThreshold: 6000,
        subagentModels: {},
        firecrawlApiKey: 'test-fc-key',
      }
    })

    const globalSaved = await readSettings(globalSettingsPath)
    expect(globalSaved['firecrawlApiKey']).toBe('test-fc-key')
    expect(notifySpy).toHaveBeenCalledWith(
      'Cradle settings saved: 0 permissions, 0 models, reminder token threshold 6000 firecrawl',
      'info',
    )
  })

  it('saves tavily API key to global settings', async () => {
    const { notifySpy } = await invokeRegisteredHandler((editor) => {
      editor.onSave?.({
        permissions: [],
        reminderTokenThreshold: 6000,
        subagentModels: {},
        tavilyApiKey: 'test-tvly-key',
      })
      return {
        permissions: [],
        reminderTokenThreshold: 6000,
        subagentModels: {},
        tavilyApiKey: 'test-tvly-key',
      }
    })

    const globalSaved = await readSettings(globalSettingsPath)
    expect(globalSaved['tavilyApiKey']).toBe('test-tvly-key')
    expect(notifySpy).toHaveBeenCalledWith(
      'Cradle settings saved: 0 permissions, 0 models, reminder token threshold 6000 tavily',
      'info',
    )
  })

  it('saves exa API key to global settings', async () => {
    const { notifySpy } = await invokeRegisteredHandler((editor) => {
      editor.onSave?.({
        permissions: [],
        reminderTokenThreshold: 6000,
        subagentModels: {},
        exaApiKey: 'test-exa-key',
      })
      return {
        permissions: [],
        reminderTokenThreshold: 6000,
        subagentModels: {},
        exaApiKey: 'test-exa-key',
      }
    })

    const globalSaved = await readSettings(globalSettingsPath)
    expect(globalSaved['exaApiKey']).toBe('test-exa-key')
    expect(notifySpy).toHaveBeenCalledWith(
      'Cradle settings saved: 0 permissions, 0 models, reminder token threshold 6000 exa',
      'info',
    )
  })

  it('leaves settings unchanged when editing is cancelled', async () => {
    const { notifySpy } = await invokeRegisteredHandler((editor) => {
      editor.onCancel?.()
    })

    await expect(readFile(projectSettingsPath(), 'utf8')).rejects.toThrow()
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
