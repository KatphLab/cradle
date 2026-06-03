import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import type { CacheMetadata } from './types.js'

const CACHE_SUBDIR = 'cradle/webfetch'
const METADATA_SUFFIX = '-metadata.json'

function cacheDirectoryPath(): string {
  return path.join(homedir(), '.cache', CACHE_SUBDIR)
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim()
  return new URL(trimmed).toString()
}

function urlHash(normalizedUrl: string): string {
  return createHash('sha256').update(normalizedUrl).digest('hex').slice(0, 32)
}

function artifactPath(cacheDirectory: string, hash: string): string {
  return path.join(cacheDirectory, `${hash}.md`)
}

function metadataPath(cacheDirectory: string, hash: string): string {
  return path.join(cacheDirectory, `${hash}${METADATA_SUFFIX}`)
}

async function ensureCacheDirectoryPath(): Promise<string> {
  const cacheDirectory = cacheDirectoryPath()
  await mkdir(cacheDirectory, { recursive: true })
  return cacheDirectory
}

function parseMetadata(raw: string): CacheMetadata | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('url' in parsed) ||
    !('normalizedUrl' in parsed)
  ) {
    return undefined
  }
  const meta = parsed as Record<string, unknown>
  return {
    url: stringValue(meta['url']),
    normalizedUrl: stringValue(meta['normalizedUrl']),
    provider: stringValue(meta['provider']),
    status: Number(meta['status'] ?? 0),
    contentType: stringValue(meta['contentType']),
    size: Number(meta['size'] ?? 0),
    fetchedAt: Number(meta['fetchedAt'] ?? 0),
    artifactPath: stringValue(meta['artifactPath']),
    metadataPath: stringValue(meta['metadataPath']),
    urlHash: stringValue(meta['urlHash']),
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

async function readMetadata(
  metadataFile: string,
): Promise<CacheMetadata | undefined> {
  let raw: string
  try {
    raw = await readFile(metadataFile, 'utf8')
  } catch {
    return undefined
  }
  try {
    return parseMetadata(raw)
  } catch {
    return undefined
  }
}

async function writeMetadata(meta: CacheMetadata): Promise<void> {
  await writeFile(meta.metadataPath, JSON.stringify(meta, undefined, 2), 'utf8')
}

interface CacheResult {
  content: string
  metadata: CacheMetadata
  cacheStatus: 'hit' | 'refresh'
}

async function readFromCache(
  url: string,
  maxAgeSeconds: number,
): Promise<CacheResult | undefined> {
  const cacheDirectory = await ensureCacheDirectoryPath()
  const normalized = normalizeUrl(url)
  const hash = urlHash(normalized)
  const artifact = artifactPath(cacheDirectory, hash)
  const metaFile = metadataPath(cacheDirectory, hash)

  const metadata = await readMetadata(metaFile)
  if (metadata === undefined) return undefined

  const age = Date.now() - metadata.fetchedAt
  if (age > maxAgeSeconds * 1000) return undefined

  let content: string
  try {
    content = await readFile(artifact, 'utf8')
  } catch {
    return undefined
  }

  return { content, metadata, cacheStatus: 'hit' }
}

async function writeToCache(
  url: string,
  provider: string,
  status: number,
  contentType: string,
  content: string,
): Promise<CacheMetadata> {
  const cacheDirectory = await ensureCacheDirectoryPath()
  const normalized = normalizeUrl(url)
  const hash = urlHash(normalized)
  const artifact = artifactPath(cacheDirectory, hash)
  const metaFile = metadataPath(cacheDirectory, hash)

  const metadata: CacheMetadata = {
    url,
    normalizedUrl: normalized,
    provider,
    status,
    contentType,
    size: Buffer.byteLength(content, 'utf8'),
    fetchedAt: Date.now(),
    artifactPath: artifact,
    metadataPath: metaFile,
    urlHash: hash,
  }

  await writeFile(artifact, content, 'utf8')
  await writeMetadata(metadata)
  return metadata
}

export {
  artifactPath,
  cacheDirectoryPath,
  ensureCacheDirectoryPath,
  metadataPath,
  normalizeUrl,
  readFromCache,
  urlHash,
  writeToCache,
}

export function validateUrl(url: string): string | undefined {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return 'Invalid URL: must start with http:// or https://'
  }
  return undefined
}

export function isStale(
  metadata: CacheMetadata,
  maxAgeSeconds: number,
): boolean {
  const age = Date.now() - metadata.fetchedAt
  return age > maxAgeSeconds * 1000
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
