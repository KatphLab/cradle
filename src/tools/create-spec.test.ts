import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createSpecTool } from './create-spec.js'

let tempRoot: string

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'pi-create-spec-test-'))
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 4, 26))
})

afterAll(async () => {
  vi.useRealTimers()
  await rm(tempRoot, { force: true, recursive: true })
})

async function execCreateSpec(title: string, content: string, slug?: string) {
  return createSpecTool.execute(
    'test-call',
    {
      title,
      content,
      ...(slug !== undefined && { slug }),
    },
    undefined,
    undefined,
    // @ts-expect-error minimal context mock
    { cwd: tempRoot },
  )
}

describe('createSpecTool', () => {
  it('creates a spec artifact under .pi/specs', async () => {
    const result = await execCreateSpec('Add Spec Mode', '## Goal\nPlan')
    const filePath = path.join(
      tempRoot,
      '.pi',
      'specs',
      '2026-05-26-add-spec-mode.md',
    )

    expect(result.details).toEqual({ filePath })
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: `Created spec artifact: ${filePath}`,
    })
    await expect(readFile(filePath, 'utf8')).resolves.toBe('## Goal\nPlan\n')
  })

  it('uses an optional slug override', async () => {
    const result = await execCreateSpec(
      'Ignored Title',
      'content\n',
      'Custom Slug',
    )
    const filePath = path.join(
      tempRoot,
      '.pi',
      'specs',
      '2026-05-26-custom-slug.md',
    )

    expect(result.details).toEqual({ filePath })
    await expect(readFile(filePath, 'utf8')).resolves.toBe('content\n')
  })
})
