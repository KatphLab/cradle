import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_CONFIG_FILE_PATH = path.join('.pi', 'cradle', 'settings.json')
function getGlobalConfigPath(): string {
  return path.join(homedir(), '.pi', 'cradle', 'settings.json')
}

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

export interface ProjectSettings {
  permissions?: DirectoryPermission[]
}

export interface GlobalSettings {
  reminderTokenThreshold?: number
  subagentModels?: SubagentModels
  advisorModel?: string
  compactionModel?: string
  firecrawlApiKey?: string
  tavilyApiKey?: string
  exaApiKey?: string
  jinaApiKey?: string
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

function normalizeAdvisorModel(raw: unknown): string | undefined {
  if (typeof raw === 'string' && raw.length > 0) return raw
  return undefined
}

function normalizeCompactionModel(raw: unknown): string | undefined {
  if (typeof raw === 'string' && raw.length > 0) return raw
  return undefined
}

function normalizeFirecrawlApiKey(raw: unknown): string | undefined {
  if (typeof raw === 'string' && raw.length > 0) return raw
  return undefined
}

function normalizeTavilyApiKey(raw: unknown): string | undefined {
  if (typeof raw === 'string' && raw.length > 0) return raw
  return undefined
}

function normalizeExaApiKey(raw: unknown): string | undefined {
  if (typeof raw === 'string' && raw.length > 0) return raw
  return undefined
}

function normalizeJinaApiKey(raw: unknown): string | undefined {
  if (typeof raw === 'string' && raw.length > 0) return raw
  return undefined
}

function normalizeProjectSettings(
  value: unknown,
  cwd: string,
): ProjectSettings {
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

  return {
    ...(permissions !== undefined && { permissions }),
  }
}

function getProjectConfigFilePath(cwd: string): string {
  return path.join(cwd, PROJECT_CONFIG_FILE_PATH)
}

/** @public */
export async function loadProjectSettings(
  cwd: string,
): Promise<ProjectSettings> {
  try {
    const content = await readFile(getProjectConfigFilePath(cwd), 'utf8')
    return normalizeProjectSettings(JSON.parse(content), cwd)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {}
    }
    throw error
  }
}

/** @public */
export async function saveProjectSettings(
  cwd: string,
  settings: ProjectSettings,
): Promise<void> {
  const configFilePath = getProjectConfigFilePath(cwd)
  await mkdir(path.dirname(configFilePath), { recursive: true })
  await writeFile(
    configFilePath,
    `${JSON.stringify(normalizeProjectSettings(settings, cwd), undefined, 2)}\n`,
  )
}

function normalizeApiKeys(value: unknown) {
  if (!isRecord(value)) return {}
  const firecrawlApiKey = normalizeFirecrawlApiKey(value['firecrawlApiKey'])
  const tavilyApiKey = normalizeTavilyApiKey(value['tavilyApiKey'])
  const exaApiKey = normalizeExaApiKey(value['exaApiKey'])
  const jinaApiKey = normalizeJinaApiKey(value['jinaApiKey'])
  return {
    ...(firecrawlApiKey !== undefined && { firecrawlApiKey }),
    ...(tavilyApiKey !== undefined && { tavilyApiKey }),
    ...(exaApiKey !== undefined && { exaApiKey }),
    ...(jinaApiKey !== undefined && { jinaApiKey }),
  }
}

function normalizeGlobalSettings(value: unknown): GlobalSettings {
  if (!isRecord(value)) return {}

  const reminderTokenThreshold = normalizeReminderTokenThreshold(
    value['reminderTokenThreshold'],
  )

  const rawSubagentModels = value['subagentModels']
  const subagentModels = isSubagentModels(rawSubagentModels)
    ? rawSubagentModels
    : undefined

  const advisorModel = normalizeAdvisorModel(value['advisorModel'])
  const compactionModel = normalizeCompactionModel(value['compactionModel'])
  const apiKeys = normalizeApiKeys(value)

  return {
    ...(reminderTokenThreshold !== undefined && { reminderTokenThreshold }),
    ...(subagentModels !== undefined && { subagentModels }),
    ...(advisorModel !== undefined && { advisorModel }),
    ...(compactionModel !== undefined && { compactionModel }),
    ...apiKeys,
  }
}

/** @public */
export async function loadGlobalSettings(): Promise<GlobalSettings> {
  try {
    const content = await readFile(getGlobalConfigPath(), 'utf8')
    return normalizeGlobalSettings(JSON.parse(content))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {}
    }
    throw error
  }
}

/** @public */
export async function saveGlobalSettings(
  settings: GlobalSettings,
): Promise<void> {
  await mkdir(path.dirname(getGlobalConfigPath()), { recursive: true })
  await writeFile(
    getGlobalConfigPath(),
    `${JSON.stringify(normalizeGlobalSettings(settings), undefined, 2)}\n`,
  )
}

/** @public */
export async function loadCradleSettings(
  cwd: string,
): Promise<ProjectSettings & GlobalSettings> {
  const [project, global] = await Promise.all([
    loadProjectSettings(cwd),
    loadGlobalSettings(),
  ])
  return { ...global, ...project }
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

function getCradleProjectDirectory(): string {
  // This file is at cradle/config/settings.ts inside the extension.
  // Navigate up two levels to reach the extension root (cradle/),
  // then one more to reach the package/project root.
  const thisFile = fileURLToPath(import.meta.url)
  return path.resolve(path.dirname(thisFile), '..', '..')
}

function getDefaultReadDirectories(): string[] {
  return [
    path.join(homedir(), '.agents'),
    path.join(homedir(), '.pi'),
    path.join(homedir(), '.cache', 'cradle'),
  ]
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

  // Implicit read directories (SDK packages + cradle extension + defaults + /tmp)
  if (operation === 'read') {
    const implicitDirectories = [
      '/tmp',
      getCradleProjectDirectory(),
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

  const settings = await loadProjectSettings(cwd)
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
