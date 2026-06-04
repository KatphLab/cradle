import { readFile, writeFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { rm } from 'node:fs/promises'
import type { CacheMetadata } from '../types.js'
import {
  artifactPath,
  cacheDirectoryPath,
  ensureCacheDirectoryPath,
  formatSize,
  isStale,
  metadataPath,
  normalizeUrl,
  readFromCache,
  urlHash,
  validateUrl,
  writeToCache,
} from '../utilities.js'

let cacheDirectory: string

beforeAll(async () => {
  cacheDirectory = await ensureCacheDirectoryPath()
})

afterAll(async () => {
  await rm(cacheDirectory, { force: true, recursive: true })
})

describe('webfetch utilities', () => {
  it('validates supported URL schemes', () => {
    expect(validateUrl('https://example.com')).toBeUndefined()
    expect(validateUrl('http://example.com')).toBeUndefined()
    expect(validateUrl('ftp://example.com')).toBe(
      'Invalid URL: must start with http:// or https://',
    )
  })

  it('normalizes URLs', () => {
    const normalized = normalizeUrl('https://example.com/path?a=1')
    expect(normalized).toBe('https://example.com/path?a=1')
  })

  it('produces deterministic url hashes', () => {
    const hash1 = urlHash(normalizeUrl('https://example.com'))
    const hash2 = urlHash(normalizeUrl('https://example.com'))
    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(32)
  })

  it('produces different hashes for different URLs', () => {
    const hash1 = urlHash(normalizeUrl('https://example.com/a'))
    const hash2 = urlHash(normalizeUrl('https://example.com/b'))
    expect(hash1).not.toBe(hash2)
  })

  it('returns the correct cache directory', () => {
    const directory = cacheDirectoryPath()
    expect(directory).toContain('.cache')
    expect(directory).toContain('cradle')
    expect(directory).toContain('webfetch')
  })

  it('computes artifact and metadata paths', () => {
    const hash = urlHash(normalizeUrl('https://example.com'))
    const artifact = artifactPath(cacheDirectory, hash)
    const meta = metadataPath(cacheDirectory, hash)
    expect(artifact).toContain(`${hash}.md`)
    expect(artifact).not.toContain('-metadata.json')
    expect(meta).toContain(`${hash}-metadata.json`)
  })

  it('writes and reads from cache', async () => {
    const url = 'https://example.com/cache-test'
    const metadata = await writeToCache(
      url,
      'native',
      200,
      'text/plain',
      'cached content',
    )

    expect(metadata.url).toBe(url)
    expect(metadata.provider).toBe('native')
    expect(metadata.status).toBe(200)
    expect(metadata.size).toBe(14)
    expect(metadata.artifactPath).toContain('.md')
    expect(metadata.metadataPath).toContain('-metadata.json')

    await expect(readFile(metadata.artifactPath, 'utf8')).resolves.toBe(
      'cached content',
    )

    const cached = await readFromCache(url, 86_400)
    expect(cached).toBeDefined()
    expect(cached?.content).toBe('cached content')
    expect(cached?.cacheStatus).toBe('hit')
    expect(cached?.metadata.url).toBe(url)
  })

  it('returns undefined for a non-existent cache entry', async () => {
    const result = await readFromCache(
      'https://example.com/never-cached',
      86_400,
    )
    expect(result).toBeUndefined()
  })

  it('returns undefined for stale cache entries', async () => {
    const url = 'https://example.com/stale-test'
    await writeToCache(url, 'native', 200, 'text/plain', 'stale')

    // Write a metadata file with an old timestamp
    const normalized = normalizeUrl(url)
    const hash = urlHash(normalized)
    const metaFile = metadataPath(cacheDirectory, hash)
    const raw = await readFile(metaFile, 'utf8')
    const parsed = JSON.parse(raw) as CacheMetadata
    parsed.fetchedAt = Date.now() - 200_000 // 200 seconds ago
    await writeFile(metaFile, JSON.stringify(parsed), 'utf8')

    // maxAgeSeconds = 60 => should be stale
    const result = await readFromCache(url, 60)
    expect(result).toBeUndefined()
  })

  it('isStale returns true for old metadata', () => {
    const meta: CacheMetadata = {
      url: 'https://example.com',
      normalizedUrl: 'https://example.com/',
      provider: 'native',
      status: 200,
      contentType: 'text/plain',
      size: 100,
      fetchedAt: Date.now() - 200_000,
      artifactPath: '/var/cache/test/a.md',
      metadataPath: '/var/cache/test/a.json',
      urlHash: 'abc',
    }
    expect(isStale(meta, 60)).toBe(true)
    expect(isStale(meta, 86_400)).toBe(false)
  })

  it('formats byte counts with binary units', () => {
    expect(formatSize(512)).toBe('512.0 B')
    expect(formatSize(1536)).toBe('1.5 KB')
    expect(formatSize(2 * 1024 * 1024)).toBe('2.0 MB')
  })
})
