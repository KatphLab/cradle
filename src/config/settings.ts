import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CONFIG_FILE_PATH = path.join('.pi', 'cradle', 'settings.json')

export interface DirectoryPermission {
  path: string
  read: boolean
  write: boolean
  bash: boolean
}

export interface SubagentModels {
  low?: string
  medium?: string
  high?: string
}

export const DEFAULT_REMINDER_TOKEN_THRESHOLD = 6000
export const MIN_REMINDER_TOKEN_THRESHOLD = 500
export const MAX_REMINDER_TOKEN_THRESHOLD = 50_000

export interface CradleSettings {
  permissions?: DirectoryPermission[]
  reminderTokenThreshold?: number
  subagentModels?: SubagentModels
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && Boolean(value) && !Array.isArray(value)
}

function isDirectoryPermission(value: unknown): value is DirectoryPermission {
  if (!isRecord(value)) return false
  if (typeof value['path'] !== 'string') return false
  if (typeof value['read'] !== 'boolean') return false
  if (typeof value['write'] !== 'boolean') return false
  if (typeof value['bash'] !== 'boolean') return false
  return true
}

function isSubagentModels(value: unknown): value is SubagentModels {
  if (!isRecord(value)) return false
  const allowedKeys = new Set(['low', 'medium', 'high'])
  const keys = Object.keys(value)
  if (keys.length === 0) return false
  for (const key of keys) {
    if (!allowedKeys.has(key)) return false
    const value_ = value[key]
    if (value_ !== undefined && typeof value_ !== 'string') return false
  }
  return true
}

function normalizeReminderTokenThreshold(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  return Math.max(
    MIN_REMINDER_TOKEN_THRESHOLD,
    Math.min(MAX_REMINDER_TOKEN_THRESHOLD, Math.round(raw)),
  )
}

function normalizeSettings(value: unknown, cwd: string): CradleSettings {
  if (!isRecord(value)) return {}

  const rawPermissions = Array.isArray(value['permissions'])
    ? value['permissions']
    : undefined

  const permissions =
    rawPermissions?.filter(isDirectoryPermission).map((permission) => ({
      path: path.resolve(cwd, permission.path),
      read: permission.read,
      write: permission.write,
      bash: permission.bash,
    })) ?? undefined

  const reminderTokenThreshold = normalizeReminderTokenThreshold(
    value['reminderTokenThreshold'],
  )

  const rawSubagentModels = value['subagentModels']
  const subagentModels = isSubagentModels(rawSubagentModels)
    ? rawSubagentModels
    : undefined

  return {
    ...(permissions !== undefined && { permissions }),
    ...(reminderTokenThreshold !== undefined && { reminderTokenThreshold }),
    ...(subagentModels !== undefined && { subagentModels }),
  }
}

function getConfigFilePath(cwd: string): string {
  return path.join(cwd, CONFIG_FILE_PATH)
}

function getEarendilWorksDirectories(): string[] {
  const packages = [
    '@earendil-works/pi-coding-agent',
    '@earendil-works/pi-agent-core',
    '@earendil-works/pi-ai',
    '@earendil-works/pi-tui',
  ]

  const directories = new Set<string>()

  for (const package_ of packages) {
    try {
      const packageDirectory = path.dirname(
        fileURLToPath(import.meta.resolve(package_)),
      )
      directories.add(path.resolve(packageDirectory, '..'))
    } catch {
      // Package not resolvable, skip
    }
  }

  return [...directories]
}

function getDefaultReadDirectories(): string[] {
  return [path.join(homedir(), '.agents'), path.join(homedir(), '.pi')]
}

function isPathInDirectory(filePath: string, directory: string): boolean {
  const relativePath = path.relative(directory, filePath)
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  )
}

function resolveClosestDirectoryPermission(
  filePath: string,
  permissions: readonly DirectoryPermission[],
): DirectoryPermission | undefined {
  let closest: DirectoryPermission | undefined
  let closestDepth = -1

  for (const permission of permissions) {
    if (!isPathInDirectory(filePath, permission.path)) continue
    const depth = permission.path.split(path.sep).length
    if (depth > closestDepth) {
      closest = permission
      closestDepth = depth
    }
  }

  return closest
}

/** @public */
export async function loadCradleSettings(cwd: string): Promise<CradleSettings> {
  try {
    const content = await readFile(getConfigFilePath(cwd), 'utf8')
    return normalizeSettings(JSON.parse(content), cwd)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {}
    }
    throw error
  }
}

/** @public */
export async function saveCradleSettings(
  cwd: string,
  settings: CradleSettings,
): Promise<void> {
  const configFilePath = getConfigFilePath(cwd)
  await mkdir(path.dirname(configFilePath), { recursive: true })
  await writeFile(
    configFilePath,
    `${JSON.stringify(normalizeSettings(settings, cwd), undefined, 2)}\n`,
  )
}

/** @public */
export async function assertPermission(
  filePath: string,
  cwd: string,
  operation: 'read' | 'write' | 'bash',
): Promise<void> {
  const resolvedFilePath = path.resolve(cwd, filePath)
  const resolvedCwd = path.resolve(cwd)

  // CWD always has all permissions
  if (isPathInDirectory(resolvedFilePath, resolvedCwd)) {
    return
  }

  // Implicit read directories (SDK packages + defaults)
  if (operation === 'read') {
    const implicitDirectories = [
      ...getEarendilWorksDirectories(),
      ...getDefaultReadDirectories(),
    ]
    if (
      implicitDirectories.some((directory) =>
        isPathInDirectory(resolvedFilePath, directory),
      )
    ) {
      return
    }
  }

  const settings = await loadCradleSettings(cwd)
  const permissions = settings.permissions ?? []
  const closest = resolveClosestDirectoryPermission(
    resolvedFilePath,
    permissions,
  )

  if (closest?.[operation] === true) {
    return
  }

  throw new Error(
    `${operation} denied: ${filePath} is outside allowed directories. Configure permissions with /cradle-settings.`,
  )
}
