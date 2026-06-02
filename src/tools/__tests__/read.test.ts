import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readTool } from '../read.js'

const cwd = process.cwd()

async function execRead(filePath: string, workingDirectory = cwd) {
  return readTool.execute(
    'test-call',
    { path: filePath },
    undefined,
    undefined,
    // @ts-expect-error minimal context mock
    { cwd: workingDirectory },
  )
}

let tempRoot: string
let extraRoot: string
let deniedRoot: string
let extraFile: string
let deniedFile: string

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'pi-read-test-'))
  extraRoot = await mkdtemp(path.join(tmpdir(), 'pi-read-extra-'))
  deniedRoot = await mkdtemp(path.join(tmpdir(), 'pi-read-denied-'))
  extraFile = path.join(extraRoot, 'extra.txt')
  deniedFile = path.join(deniedRoot, 'denied.txt')

  await writeFile(extraFile, 'extra')
  await writeFile(deniedFile, 'denied')
})

afterAll(async () => {
  await rm(tempRoot, { force: true, recursive: true })
  await rm(extraRoot, { force: true, recursive: true })
  await rm(deniedRoot, { force: true, recursive: true })
})

describe('readTool', () => {
  it('reads a text file with cwd resolution', async () => {
    const result = await execRead('package.json')
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect(result.details).toBeUndefined()
  })

  it('strips leading @ from path', async () => {
    const result = await execRead('@package.json')
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })
  })

  it('throws for non-existent file', async () => {
    await expect(execRead('does-not-exist-12345.txt')).rejects.toThrow()
  })

  it('throws for a directory', async () => {
    await expect(execRead('src')).rejects.toThrow()
  })

  it('reads from configured directories with read permission', async () => {
    await mkdir(path.join(tempRoot, '.pi', 'cradle'), { recursive: true })
    await writeFile(
      path.join(tempRoot, '.pi', 'cradle', 'settings.json'),
      JSON.stringify({
        permissions: [
          { path: extraRoot, read: true, write: false, bash: false },
        ],
      }),
    )

    const result = await execRead(extraFile, tempRoot)
    expect(result.content).toEqual([{ type: 'text', text: 'extra' }])
  })

  it('denies reads outside allowed directories', async () => {
    await expect(execRead(deniedFile, tempRoot)).rejects.toThrow('read denied')
  })
})
