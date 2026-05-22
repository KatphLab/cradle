import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { saveCradleSettings } from '@config/settings.js'
import { readTool } from './read.js'

const cwd = process.cwd()

async function execRead(
  filePath: string,
  offset?: number,
  limit?: number,
  workingDirectory = cwd,
) {
  return readTool.execute(
    'test-call',
    {
      path: filePath,
      ...(offset !== undefined && { offset }),
      ...(limit !== undefined && { limit }),
    },
    undefined,
    undefined,
    // @ts-expect-error minimal context mock
    { cwd: workingDirectory },
  )
}

let tempRoot: string
let extraRoot: string
let deniedRoot: string
let tempPng: string
let tempBig: string
let tempLong: string
let extraFile: string
let deniedFile: string

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'pi-read-test-'))
  extraRoot = await mkdtemp(path.join(tmpdir(), 'pi-read-extra-'))
  deniedRoot = await mkdtemp(path.join(tmpdir(), 'pi-read-denied-'))
  tempPng = path.join(tempRoot, 'image.png')
  tempBig = path.join(tempRoot, 'big.txt')
  tempLong = path.join(tempRoot, 'long.txt')
  extraFile = path.join(extraRoot, 'extra.txt')
  deniedFile = path.join(deniedRoot, 'denied.txt')

  await writeFile(tempPng, Buffer.from('fake-png-data'))
  await writeFile(tempBig, 'x'.repeat(60_000))
  await writeFile(
    tempLong,
    Array.from({ length: 2001 }, () => 'line').join('\n'),
  )
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
    expect(result.details).toMatchObject({
      path: 'package.json',
      type: 'text',
      truncated: false,
    })
  })

  it('reads text with offset and limit', async () => {
    const result = await execRead('package.json', 1, 5)
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect(result.details).toMatchObject({ type: 'text' })
  })

  it('strips leading @ from path', async () => {
    const result = await execRead('@package.json')
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })
  })

  it('reads an image file as base64 attachment', async () => {
    const result = await execRead(tempPng, undefined, undefined, tempRoot)
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'image' })
    expect(result.details).toMatchObject({ type: 'image' })
  })

  it('truncates text exceeding 50KB', async () => {
    const result = await execRead(tempBig, undefined, undefined, tempRoot)
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect(result.details).toMatchObject({
      type: 'text',
      truncated: true,
    })
  })

  it('truncates text exceeding 2000 lines', async () => {
    const result = await execRead(tempLong, undefined, undefined, tempRoot)
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect(result.details).toMatchObject({
      type: 'text',
      truncated: true,
    })
  })

  it('throws for non-existent file', async () => {
    await expect(execRead('does-not-exist-12345.txt')).rejects.toThrow()
  })

  it('throws for a directory', async () => {
    await expect(execRead('src')).rejects.toThrow('not a file')
  })

  it('reads from configured extra directories', async () => {
    await saveCradleSettings(tempRoot, {
      read: { extraAllowedDirectories: [extraRoot] },
    })

    const result = await execRead(extraFile, undefined, undefined, tempRoot)
    expect(result.content).toEqual([{ type: 'text', text: 'extra' }])
  })

  it('denies reads outside allowed directories', async () => {
    await expect(
      execRead(deniedFile, undefined, undefined, tempRoot),
    ).rejects.toThrow('read denied')
  })
})
