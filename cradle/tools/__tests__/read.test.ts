import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hashLineContent } from '../../utils/hashlines.js'
import { readTool } from '../read.js'

const cwd = process.cwd()

async function execRead(
  filePath: string,
  workingDirectory = cwd,
  options: { offset?: number; limit?: number } = {},
) {
  return readTool.execute(
    'test-call',
    { path: filePath, ...options },
    undefined,
    undefined,
    // @ts-expect-error minimal context mock
    { cwd: workingDirectory },
  )
}

function hashline(lineNumber: number, line: string): string {
  return `${String(lineNumber)}:${hashLineContent(line)}| ${line}`
}

function textContent(result: AgentToolResult<unknown>): string {
  const [content] = result.content
  expect(content).toMatchObject({ type: 'text' })
  return (content as { type: 'text'; text: string }).text
}

let tempRoot: string
let extraRoot: string
let deniedRoot: string
let extraFile: string
let deniedFile: string

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'pi-read-test-'))
  extraRoot = await mkdtemp(path.join(tmpdir(), 'pi-read-extra-'))
  deniedRoot = await mkdtemp(path.join(homedir(), 'pi-read-denied-'))
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
  it('reads text files as hashlines with cwd resolution', async () => {
    const file = path.join(tempRoot, 'sample.txt')
    await writeFile(file, 'first\nsecond\n')

    const result = await execRead('sample.txt', tempRoot)

    expect(result.details).toBeUndefined()
    expect(textContent(result)).toBe(
      [hashline(1, 'first'), hashline(2, 'second')].join('\n'),
    )
  })

  it('strips leading @ from path', async () => {
    const file = path.join(tempRoot, 'at-path.txt')
    await writeFile(file, 'content\n')

    const result = await execRead('@at-path.txt', tempRoot)

    expect(textContent(result)).toBe(hashline(1, 'content'))
  })

  it('uses real file line numbers with offset and limit', async () => {
    const file = path.join(tempRoot, 'offset-limit.txt')
    await writeFile(file, 'one\ntwo\nthree\nfour\n')

    const result = await execRead('offset-limit.txt', tempRoot, {
      offset: 2,
      limit: 2,
    })

    expect(textContent(result)).toBe(
      [hashline(2, 'two'), hashline(3, 'three')].join('\n'),
    )
  })

  it('hashes trailing whitespace as normalized but preserves visible content', async () => {
    const file = path.join(tempRoot, 'trailing-space.txt')
    await writeFile(file, 'same   \nsame\n')

    const result = await execRead('trailing-space.txt', tempRoot)
    const lines = textContent(result).split('\n')

    expect(lines).toEqual([hashline(1, 'same   '), hashline(2, 'same')])
    expect(lines[0]?.split(':')[1]?.slice(0, 6)).toBe(
      lines[1]?.split(':')[1]?.slice(0, 6),
    )
  })

  it('renders empty lines with their hash anchor', async () => {
    const file = path.join(tempRoot, 'empty-lines.txt')
    await writeFile(file, 'first\n\nthird\n')

    const result = await execRead('empty-lines.txt', tempRoot)

    expect(textContent(result)).toBe(
      [hashline(1, 'first'), hashline(2, ''), hashline(3, 'third')].join('\n'),
    )
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
    expect(result.content).toEqual([
      { type: 'text', text: hashline(1, 'extra') },
    ])
  })

  it('denies reads outside allowed directories', async () => {
    await expect(execRead(deniedFile, tempRoot)).rejects.toThrow('read denied')
  })
})
