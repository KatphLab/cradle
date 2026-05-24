import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { editTool } from './edit.js'

const cwd = process.cwd()

async function execEdit(
  filePath: string,
  oldText: string,
  newText: string,
  workingDirectory = cwd,
) {
  return editTool.execute(
    'test-call',
    { path: filePath, edits: [{ oldText, newText }] },
    undefined,
    undefined,
    // @ts-expect-error minimal context mock
    { cwd: workingDirectory },
  )
}

let tempRoot: string
let deniedRoot: string
let editFile: string

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'pi-edit-test-'))
  deniedRoot = await mkdtemp(path.join(tmpdir(), 'pi-edit-denied-'))
  editFile = path.join(tempRoot, 'edit-me.txt')

  await writeFile(editFile, 'old content here')
})

afterAll(async () => {
  await rm(tempRoot, { force: true, recursive: true })
  await rm(deniedRoot, { force: true, recursive: true })
})

describe('editTool', () => {
  it('edits a file', async () => {
    const result = await execEdit('edit-me.txt', 'old', 'new', tempRoot)
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })

    const content = await readFile(editFile, 'utf8')
    expect(content).toBe('new content here')
  })

  it('denies writes outside allowed directories', async () => {
    const deniedFile = path.join(deniedRoot, 'denied.txt')
    await writeFile(deniedFile, 'denied')
    await expect(
      execEdit(deniedFile, 'denied', 'changed', tempRoot),
    ).rejects.toThrow('write denied')
  })
})
