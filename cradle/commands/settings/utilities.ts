import { readdir } from 'node:fs/promises'
import path from 'node:path'

/** @public */
export async function scanDirectorySuggestions(
  inputPath: string,
  cwd: string,
): Promise<string[]> {
  if (!inputPath.trim()) return []

  const resolved = path.resolve(cwd, inputPath)

  // When input ends with a path separator, browse inside that directory
  if (/[/\\]$/.test(inputPath)) {
    try {
      const entries = await readdir(resolved, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(resolved, entry.name))
        .slice(0, 8)
    } catch {
      return []
    }
  }

  const directory = path.dirname(resolved)
  const base = path.basename(resolved)

  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(base))
      .map((entry) => path.join(directory, entry.name))
      .slice(0, 8)
  } catch {
    return []
  }
}

/** @public */
export function formatDirectoryPath(directory: string, cwd: string): string {
  const relative = path.relative(cwd, directory)
  return relative.startsWith('..') || path.isAbsolute(relative)
    ? directory
    : relative || '.'
}
