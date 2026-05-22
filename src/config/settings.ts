import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CONFIG_FILE_PATH = path.join('.pi', 'cradle', 'settings.json')

interface ReadSettings {
  extraAllowedDirectories?: string[]
}

interface CradleSettings {
  read?: ReadSettings
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && Boolean(value) && !Array.isArray(value)
}

function normalizeSettings(value: unknown): CradleSettings {
  if (!isRecord(value)) return {}

  const read = isRecord(value['read']) ? value['read'] : undefined
  const extraAllowedDirectories = Array.isArray(
    read?.['extraAllowedDirectories'],
  )
    ? read['extraAllowedDirectories'].filter(
        (entry) => typeof entry === 'string',
      )
    : undefined

  return {
    ...(extraAllowedDirectories && {
      read: { extraAllowedDirectories },
    }),
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

function resolveDirectory(directory: string, cwd: string): string {
  return path.resolve(cwd, directory)
}

function uniqueDirectories(directories: string[]): string[] {
  return [...new Set(directories)]
}

function isPathInDirectory(filePath: string, directory: string): boolean {
  const relativePath = path.relative(directory, filePath)
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  )
}

/** @public */
export async function loadCradleSettings(cwd: string): Promise<CradleSettings> {
  try {
    const content = await readFile(getConfigFilePath(cwd), 'utf8')
    return normalizeSettings(JSON.parse(content))
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
    `${JSON.stringify(normalizeSettings(settings), undefined, 2)}\n`,
  )
}

/** @public */
export function parseDirectoryList(input: string): string[] {
  return [
    ...new Set(
      input
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ]
}

/** @public */
export async function getAllowedReadDirectories(
  cwd: string,
): Promise<string[]> {
  const settings = await loadCradleSettings(cwd)
  const extraDirectories = settings.read?.extraAllowedDirectories ?? []

  return uniqueDirectories([
    path.resolve(cwd),
    ...getEarendilWorksDirectories(),
    ...extraDirectories.map((directory) => resolveDirectory(directory, cwd)),
  ])
}

/** @public */
export async function assertReadAllowed(
  filePath: string,
  cwd: string,
): Promise<void> {
  const resolvedFilePath = path.resolve(cwd, filePath)
  const allowedDirectories = await getAllowedReadDirectories(cwd)

  if (
    allowedDirectories.some((directory) =>
      isPathInDirectory(resolvedFilePath, directory),
    )
  ) {
    return
  }

  throw new Error(
    `read denied: ${filePath} is outside allowed directories. Configure extra directories with /cradle-settings.`,
  )
}
