import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const TEMP_DIR_PREFIX = 'pi-webfetch-'
const FILE_PREFIX = 'web-fetch-'

export function validateUrl(url: string): string | undefined {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return 'Invalid URL: must start with http:// or https://'
  }
  return undefined
}

function sanitizeUrlForFilename(url: string): string {
  return url.replaceAll(/[^\da-z]/gi, '_').slice(0, 40)
}

export async function createTemporaryDirectory(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), TEMP_DIR_PREFIX))
}

export async function writeFetchResult(
  tempDirectory: string,
  index: number,
  url: string,
  content: string,
): Promise<string> {
  const safeName = sanitizeUrlForFilename(url)
  const fileName = `${FILE_PREFIX}${String(index)}-${safeName}.md`
  const filePath = path.join(tempDirectory, fileName)
  await writeFile(filePath, content, 'utf8')
  return filePath
}

export function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB'] as const
  const divisor = 1024
  let size = bytes
  let unitIndex = 0
  while (size >= divisor && unitIndex < units.length - 1) {
    size /= divisor
    unitIndex++
  }
  const unit = units[unitIndex] ?? 'B'
  return `${size.toFixed(1)} ${unit}`
}
