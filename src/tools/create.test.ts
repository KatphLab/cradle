import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTool } from './create.js'

const cwd = process.cwd()

async function execCreate(
  filePath: string,
  content: string,
  workingDirectory = cwd,
) {
  return createTool.execute(
    'test-call',
    { path: filePath, content },
    undefined,
    undefined,
    // @ts-expect-error minimal context mock
    { cwd: workingDirectory },
  )
}

let tempRoot: string
let deniedRoot: string

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'pi-create-test-'))
  deniedRoot = await mkdtemp(path.join(tmpdir(), 'pi-create-denied-'))
})

afterAll(async () => {
  await rm(tempRoot, { force: true, recursive: true })
  await rm(deniedRoot, { force: true, recursive: true })
})

describe('createTool', () => {
  it('creates a file', async () => {
    const result = await execCreate('new-file.txt', 'hello world', tempRoot)
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })

    const content = await readFile(path.join(tempRoot, 'new-file.txt'), 'utf8')
    expect(content).toBe('hello world')
  })

  it('denies writes outside allowed directories', async () => {
    const deniedFile = path.join(deniedRoot, 'denied.txt')
    await writeFile(deniedFile, 'denied')
    await expect(
      execCreate(path.join(deniedRoot, 'denied.txt'), 'changed', tempRoot),
    ).rejects.toThrow('write denied')
  })
})
