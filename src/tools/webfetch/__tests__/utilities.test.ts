import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createTemporaryDirectory,
  formatSize,
  validateUrl,
  writeFetchResult,
} from '../utilities.js'

let tempRoot: string
let createdDirectory: string | undefined

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'pi-webfetch-utils-test-'))
})

afterAll(async () => {
  await rm(tempRoot, { force: true, recursive: true })
  if (createdDirectory !== undefined) {
    await rm(createdDirectory, { force: true, recursive: true })
  }
})

describe('webfetch utilities', () => {
  it('validates supported URL schemes', () => {
    expect(validateUrl('https://example.com')).toBeUndefined()
    expect(validateUrl('http://example.com')).toBeUndefined()
    expect(validateUrl('ftp://example.com')).toBe(
      'Invalid URL: must start with http:// or https://',
    )
  })

  it('creates temporary directories with the webfetch prefix', async () => {
    createdDirectory = await createTemporaryDirectory()
    expect(path.basename(createdDirectory)).toMatch(/^pi-webfetch-/)
  })

  it('writes fetch results using sanitized URL file names', async () => {
    const filePath = await writeFetchResult(
      tempRoot,
      2,
      'https://example.com/a path?q=1',
      'content',
    )

    expect(path.basename(filePath)).toMatch(
      /^web-fetch-2-https___example_com_a_path_q_1\.md$/,
    )
    await expect(readFile(filePath, 'utf8')).resolves.toBe('content')
  })

  it('formats byte counts with binary units', () => {
    expect(formatSize(512)).toBe('512.0 B')
    expect(formatSize(1536)).toBe('1.5 KB')
    expect(formatSize(2 * 1024 * 1024)).toBe('2.0 MB')
  })
})
