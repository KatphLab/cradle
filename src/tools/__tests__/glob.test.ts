import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { globTool } from '../glob.js'

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

async function execGlob(
  pattern: string,
  directoryPath: string,
  workingDirectory = cwd,
  exclude?: string[],
) {
  return globTool.execute(
    'test-call',
    {
      pattern,
      path: directoryPath,
      ...(exclude && { exclude }),
    },
    undefined,
    undefined,
    // @ts-expect-error minimal context mock
    { cwd: workingDirectory },
  )
}

let tempRoot: string
let deniedRoot: string
let globDirectory: string

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'pi-glob-test-'))
  deniedRoot = await mkdtemp(path.join(tmpdir(), 'pi-glob-denied-'))
  globDirectory = path.join(tempRoot, 'glob-me')

  await mkdir(globDirectory, { recursive: true })
  await mkdir(path.join(globDirectory, 'exclude'), { recursive: true })
  await writeFile(path.join(globDirectory, 'a.ts'), 'a')
  await writeFile(path.join(globDirectory, 'b.ts'), 'b')
  await writeFile(path.join(globDirectory, 'c.js'), 'c')
  await writeFile(path.join(globDirectory, 'exclude', 'd.ts'), 'd')
})

afterAll(async () => {
  await rm(tempRoot, { force: true, recursive: true })
  await rm(deniedRoot, { force: true, recursive: true })
})

describe('globTool', () => {
  it('finds files by pattern', async () => {
    const result = await execGlob('*.ts', 'glob-me', tempRoot)
    expect(result.content).toHaveLength(1)
    const item = result.content[0]
    if (!isTextContent(item)) throw new Error('Expected text content')
    expect(item.text).toContain('a.ts')
    expect(item.text).toContain('b.ts')
    expect(item.text).not.toContain('c.js')
  })

  it('filters with exclude patterns', async () => {
    const result = await execGlob('**/*.ts', 'glob-me', tempRoot, [
      'exclude/**',
    ])
    expect(result.content).toHaveLength(1)
    const item = result.content[0]
    if (!isTextContent(item)) throw new Error('Expected text content')
    expect(item.text).toContain('a.ts')
    expect(item.text).toContain('b.ts')
    expect(item.text).not.toContain('d.ts')
  })

  it('searches current directory when path is omitted', async () => {
    const result = await globTool.execute(
      'test-call',
      { pattern: '*.ts' },
      undefined,
      undefined,
      // @ts-expect-error minimal context mock
      { cwd: globDirectory },
    )
    expect(result.content).toHaveLength(1)
    const item = result.content[0]
    if (!isTextContent(item)) throw new Error('Expected text content')
    expect(item.text).toContain('a.ts')
    expect(item.text).toContain('b.ts')
  })

  it('respects the limit option', async () => {
    const result = await globTool.execute(
      'test-call',
      { pattern: '*.ts', path: 'glob-me', limit: 1 },
      undefined,
      undefined,
      // @ts-expect-error minimal context mock
      { cwd: tempRoot },
    )
    expect(result.content).toHaveLength(1)
    const item = result.content[0]
    if (!isTextContent(item)) throw new Error('Expected text content')
    expect(item.text).toContain('.ts')
    expect(item.text).not.toContain('a.ts\nb.ts')
    expect(item.text).toContain('limit reached')
  })

  it('denies reads outside allowed directories', async () => {
    await mkdir(path.join(deniedRoot, 'search-dir'), { recursive: true })
    await expect(
      execGlob('*.txt', path.join(deniedRoot, 'search-dir'), tempRoot),
    ).rejects.toThrow('read denied')
  })
})
