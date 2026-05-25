import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  assertPermission,
  loadCradleSettings,
  saveCradleSettings,
} from './settings.js'

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
  it('throws for malformed config JSON', async () => {
    await writeSettingsJson('{bad json')

    await expect(loadCradleSettings(tempRoot)).rejects.toThrow()
  })

  it('normalizes unsupported config shapes', async () => {
    await writeSettingsJson('[]')
    await expect(loadCradleSettings(tempRoot)).resolves.toEqual({})

    await writeSettingsJson('{"read":"invalid"}')
    await expect(loadCradleSettings(tempRoot)).resolves.toEqual({})

    await writeSettingsJson('{"permissions":"invalid"}')
    await expect(loadCradleSettings(tempRoot)).resolves.toEqual({})

    await writeSettingsJson(
      '{"permissions":[{"path":"/tmp","read":true,"write":false,"bash":false}]}',
    )
    await expect(loadCradleSettings(tempRoot)).resolves.toEqual({
      permissions: [{ path: '/tmp', read: true, write: false, bash: false }],
    })
  })

  it('filters out invalid permission entries', async () => {
    await writeSettingsJson(
      '{"permissions":[' +
        '{"path":"/ok","read":true,"write":false,"bash":false},' +
        '{"path":123,"read":true,"write":false,"bash":false},' +
        '{"path":"/bad-read","read":"yes","write":false,"bash":false},' +
        '{"path":"/bad-write","read":true,"write":"yes","bash":false},' +
        '{"path":"/bad-bash","read":true,"write":false,"bash":"yes"}' +
        ']}',
    )
    await expect(loadCradleSettings(tempRoot)).resolves.toEqual({
      permissions: [{ path: '/ok', read: true, write: false, bash: false }],
    })
  })

  it('resolves permission paths to absolute', async () => {
    await saveCradleSettings(tempRoot, {
      permissions: [
        { path: 'relative', read: true, write: false, bash: false },
      ],
    })

    const settings = await loadCradleSettings(tempRoot)
    expect(settings.permissions?.[0]?.path).toBe(
      path.resolve(tempRoot, 'relative'),
    )
  })
})

describe('assertPermission', () => {
  it('allows operations within cwd', async () => {
    await expect(
      assertPermission('package.json', tempRoot, 'read'),
    ).resolves.toBeUndefined()
    await expect(
      assertPermission('package.json', tempRoot, 'write'),
    ).resolves.toBeUndefined()
    await expect(
      assertPermission(tempRoot, tempRoot, 'bash'),
    ).resolves.toBeUndefined()
  })

  it('allows read in configured directories', async () => {
    const allowedDirectory = await mkdtemp(path.join(tmpdir(), 'pi-allowed-'))
    await saveCradleSettings(tempRoot, {
      permissions: [
        { path: allowedDirectory, read: true, write: false, bash: false },
      ],
    })

    await expect(
      assertPermission(
        path.join(allowedDirectory, 'file.txt'),
        tempRoot,
        'read',
      ),
    ).resolves.toBeUndefined()

    await rm(allowedDirectory, { force: true, recursive: true })
  })

  it('picks the deepest matching permission for overlapping directories', async () => {
    const shallowDirectory = await mkdtemp(path.join(tmpdir(), 'pi-shallow-'))
    const deepDirectory = await mkdtemp(path.join(shallowDirectory, 'pi-deep-'))

    // Deeper permission listed first so the shallow one is evaluated later
    await saveCradleSettings(tempRoot, {
      permissions: [
        { path: deepDirectory, read: true, write: true, bash: false },
        { path: shallowDirectory, read: true, write: false, bash: false },
      ],
    })

    // File inside deepDirectory should use deepDirectory's write permission
    await expect(
      assertPermission(path.join(deepDirectory, 'file.txt'), tempRoot, 'write'),
    ).resolves.toBeUndefined()

    // File in shallowDirectory but outside deepDirectory uses shallow permissions
    await expect(
      assertPermission(
        path.join(shallowDirectory, 'other.txt'),
        tempRoot,
        'write',
      ),
    ).rejects.toThrow('write denied')

    await rm(shallowDirectory, { force: true, recursive: true })
  })

  it('denies write in read-only directories', async () => {
    const allowedDirectory = await mkdtemp(path.join(tmpdir(), 'pi-readonly-'))
    await saveCradleSettings(tempRoot, {
      permissions: [
        { path: allowedDirectory, read: true, write: false, bash: false },
      ],
    })

    await expect(
      assertPermission(
        path.join(allowedDirectory, 'file.txt'),
        tempRoot,
        'write',
      ),
    ).rejects.toThrow('write denied')

    await rm(allowedDirectory, { force: true, recursive: true })
  })

  it('denies bash in non-bash directories', async () => {
    const allowedDirectory = await mkdtemp(path.join(tmpdir(), 'pi-nobash-'))
    await saveCradleSettings(tempRoot, {
      permissions: [
        { path: allowedDirectory, read: true, write: false, bash: false },
      ],
    })

    await expect(
      assertPermission(allowedDirectory, tempRoot, 'bash'),
    ).rejects.toThrow('bash denied')

    await rm(allowedDirectory, { force: true, recursive: true })
  })

  it('denies operations outside all allowed directories', async () => {
    const deniedDirectory = await mkdtemp(path.join(tmpdir(), 'pi-denied-'))

    await expect(
      assertPermission(
        path.join(deniedDirectory, 'file.txt'),
        tempRoot,
        'read',
      ),
    ).rejects.toThrow('read denied')

    await rm(deniedDirectory, { force: true, recursive: true })
  })

  it('allows read in SDK package directories', async () => {
    const sdkPackageMain = fileURLToPath(
      import.meta.resolve('@earendil-works/pi-coding-agent'),
    )
    const sdkDirectory = path.resolve(path.dirname(sdkPackageMain), '..')
    const sdkFile = path.join(sdkDirectory, 'package.json')

    await expect(
      assertPermission(sdkFile, tempRoot, 'read'),
    ).resolves.toBeUndefined()
  })

  it('throws for non-ENOENT config errors', async () => {
    // Create a directory where the config file should be, causing readFile to throw EISDIR
    await mkdir(path.join(tempRoot, '.pi', 'cradle', 'settings.json'), {
      recursive: true,
    })

    await expect(loadCradleSettings(tempRoot)).rejects.toThrow()
  })
})
