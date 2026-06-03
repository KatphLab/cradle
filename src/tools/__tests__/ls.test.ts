import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { lsTool } from '../ls.js'

const cwd = process.cwd()

function isTextContent(item: unknown): item is { type: 'text'; text: string } {
  if (typeof item !== 'object' || item === null) return false
  const entries = Object.entries(item)
  let typeValue: unknown
  let textValue: unknown
  for (const [key, value] of entries) {
    if (key === 'type') typeValue = value
    if (key === 'text') textValue = value
  }
  return typeValue === 'text' && typeof textValue === 'string'
}

async function execLs(
  directoryPath: string,
  workingDirectory = cwd,
  ignore?: string[],
) {
  return lsTool.execute(
    'test-call',
    { path: directoryPath, ...(ignore && { ignore }) },
    undefined,
    undefined,
    // @ts-expect-error minimal context mock
    { cwd: workingDirectory },
  )
}

let tempRoot: string
let deniedRoot: string
let listDirectory: string

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'pi-ls-test-'))
  deniedRoot = await mkdtemp(path.join(homedir(), 'pi-ls-denied-'))
  listDirectory = path.join(tempRoot, 'list-me')

  await mkdir(listDirectory, { recursive: true })
  await mkdir(path.join(listDirectory, 'ignored'), { recursive: true })
  await writeFile(path.join(listDirectory, 'a.txt'), 'a')
  await writeFile(path.join(listDirectory, 'b.txt'), 'b')
  await writeFile(path.join(listDirectory, 'ignored', 'c.txt'), 'c')
})

afterAll(async () => {
  await rm(tempRoot, { force: true, recursive: true })
  await rm(deniedRoot, { force: true, recursive: true })
})

describe('lsTool', () => {
  it('lists a directory', async () => {
    const result = await execLs(listDirectory, tempRoot)
    expect(result.content).toHaveLength(1)
    const item = result.content[0]
    if (!isTextContent(item)) throw new Error('Expected text content')
    expect(item.text).toContain('a.txt')
    expect(item.text).toContain('b.txt')
    expect(item.text).toContain('ignored/')
  })

  it('filters entries with ignore patterns', async () => {
    const result = await execLs(listDirectory, tempRoot, ['ignored'])
    expect(result.content).toHaveLength(1)
    const item = result.content[0]
    if (!isTextContent(item)) throw new Error('Expected text content')
    expect(item.text).toContain('a.txt')
    expect(item.text).toContain('b.txt')
    expect(item.text).not.toContain('ignored/')
  })

  it('ignores entries with trailing slash pattern', async () => {
    const result = await execLs(listDirectory, tempRoot, ['ignored/'])
    expect(result.content).toHaveLength(1)
    const item = result.content[0]
    if (!isTextContent(item)) throw new Error('Expected text content')
    expect(item.text).not.toContain('ignored/')
    expect(item.text).toContain('a.txt')
  })

  it('respects the limit option', async () => {
    const result = await lsTool.execute(
      'test-call',
      { path: listDirectory, limit: 1 },
      undefined,
      undefined,
      // @ts-expect-error minimal context mock
      { cwd: tempRoot },
    )
    expect(result.content).toHaveLength(1)
    const item = result.content[0]
    if (!isTextContent(item)) throw new Error('Expected text content')
    expect(item.text).toContain('.txt')
    expect(item.text).toContain('limit reached')
  })

  it('denies reads outside allowed directories', async () => {
    await expect(execLs(deniedRoot, tempRoot)).rejects.toThrow('read denied')
  })
})
