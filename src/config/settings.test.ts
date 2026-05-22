import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadCradleSettings, parseDirectoryList } from '@config/settings.js'

let tempRoot: string

async function writeSettingsJson(content: string): Promise<void> {
  const configDirectory = path.join(tempRoot, '.pi', 'cradle')
  await mkdir(configDirectory, { recursive: true })
  await writeFile(path.join(configDirectory, 'settings.json'), content)
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'pi-config-test-'))
})

afterEach(async () => {
  await rm(tempRoot, { force: true, recursive: true })
})

describe('settings config', () => {
  it('parses unique non-empty directory lines', () => {
    expect(parseDirectoryList('one\n\n two \none')).toEqual(['one', 'two'])
  })

  it('throws for malformed config JSON', async () => {
    await writeSettingsJson('{bad json')

    await expect(loadCradleSettings(tempRoot)).rejects.toThrow()
  })

  it('normalizes unsupported config shapes', async () => {
    await writeSettingsJson('[]')
    await expect(loadCradleSettings(tempRoot)).resolves.toEqual({})

    await writeSettingsJson('{"read":"invalid"}')
    await expect(loadCradleSettings(tempRoot)).resolves.toEqual({})

    await writeSettingsJson('{"read":{"extraAllowedDirectories":"invalid"}}')
    await expect(loadCradleSettings(tempRoot)).resolves.toEqual({})

    await writeSettingsJson(
      '{"read":{"extraAllowedDirectories":["one",1,"two"]}}',
    )
    await expect(loadCradleSettings(tempRoot)).resolves.toEqual({
      read: { extraAllowedDirectories: ['one', 'two'] },
    })
  })
})
