import path from 'node:path'

export const SPEC_MODE_STATE_TYPE = 'cradle-spec-mode'
export const NORMAL_MODE_TOOLS = [
  'read',
  'ls',
  'grep',
  'glob',
  'edit',
  'write',
  'bash',
  'todo',
]
export const SPEC_MODE_TOOLS = [
  'read',
  'glob',
  'grep',
  'ls',
  'edit',
  'write',
  'todo',
]

interface SpecModeEntryData {
  enabled: boolean
}

export interface SpecModeState {
  isEnabled: () => boolean
  setEnabled: (enabled: boolean) => void
  getPreviousActiveTools: () => string[] | undefined
  setPreviousActiveTools: (tools: string[] | undefined) => void
}

interface SessionEntryLike {
  type?: unknown
  customType?: unknown
  data?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSessionEntryLike(value: unknown): value is SessionEntryLike {
  return isRecord(value)
}

function isSpecModeEntryData(value: unknown): value is SpecModeEntryData {
  return isRecord(value) && typeof value['enabled'] === 'boolean'
}

function toDatePrefix(date: Date): string {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function createSpecModeState(): SpecModeState {
  let enabled = false
  let previousActiveTools: string[] | undefined

  return {
    isEnabled: () => enabled,
    setEnabled: (nextEnabled) => {
      enabled = nextEnabled
    },
    getPreviousActiveTools: () => previousActiveTools,
    setPreviousActiveTools: (tools) => {
      previousActiveTools = tools
    },
  }
}

export function restoreSpecModeEnabled(entries: readonly unknown[]): boolean {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (!isSessionEntryLike(entry)) continue
    if (entry.type !== 'custom') continue
    if (entry.customType !== SPEC_MODE_STATE_TYPE) continue
    if (isSpecModeEntryData(entry.data)) return entry.data.enabled
  }

  return false
}

export function kebabCase(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .split('-')
    .filter(Boolean)
    .join('-')

  return normalized.length > 0 ? normalized : 'spec'
}

export function generateSpecFilename(title: string, date = new Date()): string {
  return `${toDatePrefix(date)}-${kebabCase(title)}.md`
}

export function getSpecFilePath(
  cwd: string,
  title: string,
  slug?: string,
  date = new Date(),
): string {
  const filename = generateSpecFilename(slug ?? title, date)
  return path.join(cwd, '.pi', 'specs', filename)
}
