import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grepTool } from '../grep.js'

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

async function execGrep(
  pattern: string,
  filePath?: string,
  workingDirectory = cwd,
) {
  return grepTool.execute(
    'test-call',
    { pattern, ...(filePath && { path: filePath }) },
    undefined,
    undefined,
    // @ts-expect-error minimal context mock
    { cwd: workingDirectory },
  )
}

let tempRoot: string
let deniedRoot: string
let searchFile: string

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'pi-grep-test-'))
  deniedRoot = await mkdtemp(path.join(homedir(), 'pi-grep-denied-'))
  searchFile = path.join(tempRoot, 'search.txt')

  await writeFile(searchFile, 'hello world\nfoo bar\nhello again')
})

afterAll(async () => {
  await rm(tempRoot, { force: true, recursive: true })
  await rm(deniedRoot, { force: true, recursive: true })
})

describe('grepTool', () => {
  it('searches for a pattern', async () => {
    const result = await execGrep('hello', 'search.txt', tempRoot)
    expect(result.content).toHaveLength(1)
    const item = result.content[0]
    if (!isTextContent(item)) throw new Error('Expected text content')
    expect(item.text).toContain('hello world')
    expect(item.text).toContain('hello again')
  })

  it('searches current directory when path is omitted', async () => {
    const result = await grepTool.execute(
      'test-call',
      { pattern: 'hello' },
      undefined,
      undefined,
      // @ts-expect-error minimal context mock
      { cwd: tempRoot },
    )
    expect(result.content).toHaveLength(1)
    const item = result.content[0]
    if (!isTextContent(item)) throw new Error('Expected text content')
    expect(item.text).toContain('hello world')
    expect(item.text).toContain('hello again')
  })

  it('denies reads outside allowed directories', async () => {
    await expect(execGrep('denied', deniedRoot, tempRoot)).rejects.toThrow(
      'read denied',
    )
  })
})
