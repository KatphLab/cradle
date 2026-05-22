import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readTool } from './read.js'

const cwd = process.cwd()

async function execRead(filePath: string, offset?: number, limit?: number) {
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
    { cwd },
  )
}

const tempPng = path.join(tmpdir(), 'pi-read-test.png')
const tempBig = path.join(tmpdir(), 'pi-read-test-big.txt')
const tempLong = path.join(tmpdir(), 'pi-read-test-long.txt')

beforeAll(async () => {
  await writeFile(tempPng, Buffer.from('fake-png-data'))
  await writeFile(tempBig, 'x'.repeat(60_000))
  await writeFile(
    tempLong,
    Array.from({ length: 2001 }, () => 'line').join('\n'),
  )
})

afterAll(async () => {
  await rm(tempPng, { force: true })
  await rm(tempBig, { force: true })
  await rm(tempLong, { force: true })
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
    const result = await execRead(tempPng)
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'image' })
    expect(result.details).toMatchObject({ type: 'image' })
  })

  it('truncates text exceeding 50KB', async () => {
    const result = await execRead(tempBig)
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect(result.details).toMatchObject({
      type: 'text',
      truncated: true,
    })
  })

  it('truncates text exceeding 2000 lines', async () => {
    const result = await execRead(tempLong)
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
})
