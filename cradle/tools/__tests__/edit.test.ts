import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import type {
  SessionEntry,
  SessionMessageEntry,
} from '@earendil-works/pi-coding-agent'

import type {
  ApprovalDetails,
  BashScope,
  FileScope,
} from '../../utils/approval-state.js'
import { isDeferredOperationDetails } from '../../utils/deferred-operations.js'
import { hashLineContent } from '../../utils/hashlines.js'
import type { EditToolParameters } from '../edit.js'
import { editTool } from '../edit.js'

const cwd = process.cwd()

interface SessionManagerMock {
  getEntries: () => SessionEntry[]
  getLeafId: () => string | null
}

function emptySessionManager(): SessionManagerMock {
  return { getEntries: () => [], getLeafId: () => null }
}

function buildApprovedSession(
  fileScopes: FileScope[],
  bashScopes: BashScope[] = [],
): SessionManagerMock {
  const proposalDetails: ApprovalDetails = {
    action: 'proposal',
    id: 'test-proposal',
    fileScopes,
    bashScopes,
  }
  const proposalEntry: SessionMessageEntry = {
    type: 'message',
    id: 'proposal-1',
    parentId: null,
    timestamp: '2025-01-01T00:00:00Z',
    message: {
      role: 'toolResult',
      toolName: 'approval',
      toolCallId: 'call-approval-1',
      content: [],
      isError: false,
      timestamp: 1,
      details: proposalDetails,
    },
  }
  const approvalEntry: SessionMessageEntry = {
    type: 'message',
    id: 'user-approval',
    parentId: 'proposal-1',
    timestamp: '2025-01-01T00:00:01Z',
    message: {
      role: 'user',
      content: '<proceed>',
      timestamp: 2,
    },
  }
  const entries: SessionEntry[] = [proposalEntry, approvalEntry]
  return {
    getEntries: () => entries,
    getLeafId: () => 'user-approval',
  }
}

function makeHash(line: string): string {
  return hashLineContent(line)
}

async function execEdit(
  _filePath: string,
  parameters: EditToolParameters,
  workingDirectory = cwd,
  sessionManager: SessionManagerMock = emptySessionManager(),
): Promise<AgentToolResult<unknown> & { isError?: boolean }> {
  return editTool.execute(
    'test-call',
    parameters,
    undefined,
    undefined,
    // @ts-expect-error minimal context mock
    { cwd: workingDirectory, sessionManager },
  )
}

let tempRoot: string
let deniedRoot: string
let savedSubagent: string | undefined

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'pi-edit-test-'))
  deniedRoot = await mkdtemp(path.join(tmpdir(), 'pi-edit-denied-'))
  savedSubagent = process.env['CRADLE_SUBAGENT']
})

afterEach(() => {
  // Restore subagent env to prevent leaking between tests
  if (savedSubagent === undefined) {
    delete process.env['CRADLE_SUBAGENT']
  } else {
    process.env['CRADLE_SUBAGENT'] = savedSubagent
  }
})

afterAll(async () => {
  await rm(tempRoot, { force: true, recursive: true })
  await rm(deniedRoot, { force: true, recursive: true })
})

describe('editTool', () => {
  it('replaces a single line when endpoint hash matches', async () => {
    const editFile = path.join(tempRoot, 'single-line.txt')
    await writeFile(editFile, 'line one\nline two\nline three\n')

    const sessionManager = buildApprovedSession([
      { path: 'single-line.txt', operation: 'edit', intent: 'test edit' },
    ])
    const result = await execEdit(
      editFile,
      {
        path: 'single-line.txt',
        edits: [
          {
            from: 2,
            fromHash: makeHash('line two'),
            to: 2,
            toHash: makeHash('line two'),
            newText: 'line TWO',
          },
        ],
      },
      tempRoot,
      sessionManager,
    )

    expect(result.content[0]).toMatchObject({ type: 'text' })
    const content = await readFile(editFile, 'utf8')
    expect(content).toBe('line one\nline TWO\nline three\n')
  })

  it('handles multi-line replacements, deletions, and multiple stable edits', async () => {
    const editFile = path.join(tempRoot, 'combined-edits.txt')
    await writeFile(editFile, 'a\nb\nc\nd\ne\nf\n')

    const sessionManager = buildApprovedSession([
      { path: 'combined-edits.txt', operation: 'edit', intent: 'test edit' },
    ])
    const result = await execEdit(
      editFile,
      {
        path: 'combined-edits.txt',
        edits: [
          {
            from: 2,
            fromHash: makeHash('b'),
            to: 3,
            toHash: makeHash('c'),
            newText: 'B\nC\nD',
          },
          {
            from: 5,
            fromHash: makeHash('e'),
            to: 5,
            toHash: makeHash('e'),
            newText: '',
          },
          {
            from: 6,
            fromHash: makeHash('f'),
            to: 6,
            toHash: makeHash('f'),
            newText: 'F',
          },
        ],
      },
      tempRoot,
      sessionManager,
    )

    expect(result.isError).toBeFalsy()
    await expect(readFile(editFile, 'utf8')).resolves.toBe('a\nB\nC\nD\nd\nF\n')
  })

  it('rejects stale fromHash and leaves file unchanged', async () => {
    const editFile = path.join(tempRoot, 'stale-from.txt')
    const original = 'line one\nline two\nline three\n'
    await writeFile(editFile, original)

    // Use subagent bypass to test validation without approval
    process.env['CRADLE_SUBAGENT'] = '1'
    const result = await execEdit(
      editFile,
      {
        path: 'stale-from.txt',
        // Use valid 6-char hex that doesn't match the actual hash
        edits: [
          {
            from: 2,
            fromHash: 'aabbcc',
            to: 2,
            toHash: makeHash('line two'),
            newText: 'replaced',
          },
        ],
      },
      tempRoot,
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('hash mismatch'),
    })
    expect(await readFile(editFile, 'utf8')).toBe(original)
  })

  it('rejects overlapping ranges and leaves file unchanged', async () => {
    const editFile = path.join(tempRoot, 'overlap.txt')
    const original = 'aaa\nbbb\nccc\n'
    await writeFile(editFile, original)

    process.env['CRADLE_SUBAGENT'] = '1'
    const result = await execEdit(
      editFile,
      {
        path: 'overlap.txt',
        edits: [
          {
            from: 1,
            fromHash: makeHash('aaa'),
            to: 2,
            toHash: makeHash('bbb'),
            newText: 'AB',
          },
          {
            from: 2,
            fromHash: makeHash('bbb'),
            to: 3,
            toHash: makeHash('ccc'),
            newText: 'BC',
          },
        ],
      },
      tempRoot,
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('overlapping'),
    })
    expect(await readFile(editFile, 'utf8')).toBe(original)
  })

  it('rejects out-of-bounds ranges and leaves file unchanged', async () => {
    const editFile = path.join(tempRoot, 'oob.txt')
    const original = 'one\ntwo\n'
    await writeFile(editFile, original)

    process.env['CRADLE_SUBAGENT'] = '1'
    const result = await execEdit(
      editFile,
      {
        path: 'oob.txt',
        edits: [
          {
            from: 1,
            fromHash: makeHash('one'),
            to: 5,
            toHash: 'aabbcc',
            newText: 'replaced',
          },
        ],
      },
      tempRoot,
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('out of bounds'),
    })
    expect(await readFile(editFile, 'utf8')).toBe(original)
  })

  it('preserves final newline when file has one', async () => {
    const editFile = path.join(tempRoot, 'final-newline.txt')
    await writeFile(editFile, 'aaa\nbbb\n')

    process.env['CRADLE_SUBAGENT'] = '1'
    await execEdit(
      editFile,
      {
        path: 'final-newline.txt',
        edits: [
          {
            from: 1,
            fromHash: makeHash('aaa'),
            to: 1,
            toHash: makeHash('aaa'),
            newText: 'AAA',
          },
        ],
      },
      tempRoot,
    )

    const content = await readFile(editFile, 'utf8')
    expect(content).toBe('AAA\nbbb\n')
  })

  it('preserves no-final-newline when file has none', async () => {
    const editFile = path.join(tempRoot, 'no-final-newline.txt')
    await writeFile(editFile, 'aaa\nbbb')

    process.env['CRADLE_SUBAGENT'] = '1'
    await execEdit(
      editFile,
      {
        path: 'no-final-newline.txt',
        edits: [
          {
            from: 1,
            fromHash: makeHash('aaa'),
            to: 1,
            toHash: makeHash('aaa'),
            newText: 'AAA',
          },
        ],
      },
      tempRoot,
    )

    const content = await readFile(editFile, 'utf8')
    expect(content).toBe('AAA\nbbb')
  })

  it('rejects empty edits array', async () => {
    const editFile = path.join(tempRoot, 'empty-edits.txt')
    await writeFile(editFile, 'content\n')

    process.env['CRADLE_SUBAGENT'] = '1'
    const result = await execEdit(
      editFile,
      {
        path: 'empty-edits.txt',
        edits: [],
      },
      tempRoot,
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('at least one'),
    })
  })

  it('rejects editing empty files', async () => {
    const editFile = path.join(tempRoot, 'empty-file.txt')
    await writeFile(editFile, '')

    process.env['CRADLE_SUBAGENT'] = '1'
    const result = await execEdit(
      editFile,
      {
        path: 'empty-file.txt',
        edits: [
          {
            from: 1,
            fromHash: makeHash(''),
            to: 1,
            toHash: makeHash(''),
            newText: 'new',
          },
        ],
      },
      tempRoot,
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('empty file'),
    })
  })

  it('denies writes outside allowed directories', async () => {
    const deniedFile = path.join(deniedRoot, 'denied.txt')
    await writeFile(deniedFile, 'denied')
    const sessionManager = buildApprovedSession([
      { path: deniedFile, operation: 'edit', intent: 'test edit' },
    ])
    await expect(
      execEdit(
        deniedFile,
        {
          path: deniedFile,
          edits: [
            {
              from: 1,
              fromHash: makeHash('denied'),
              to: 1,
              toHash: makeHash('denied'),
              newText: 'changed',
            },
          ],
        },
        tempRoot,
        sessionManager,
      ),
    ).rejects.toThrow('write denied')
  })

  it('captures blocked edits as deferred operations', async () => {
    const editFile = path.join(tempRoot, 'blocked.txt')
    await writeFile(editFile, 'old content\n')

    const sessionManager = buildApprovedSession([
      { path: 'other-file.ts', operation: 'edit', intent: 'different file' },
    ])
    const result = await execEdit(
      editFile,
      {
        path: 'blocked.txt',
        edits: [
          {
            from: 1,
            fromHash: makeHash('old content'),
            to: 1,
            toHash: makeHash('old content'),
            newText: 'new content',
          },
        ],
      },
      tempRoot,
      sessionManager,
    )

    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Blocked'),
    })
    expect(isDeferredOperationDetails(result.details)).toBe(true)
    expect(result.details).toMatchObject({
      kind: 'deferred-operation',
      id: 'deferred-test-call',
      toolName: 'edit',
      path: 'blocked.txt',
      operation: 'edit',
    })
  })

  it('allows subagent edits without approval', async () => {
    const subagentFile = path.join(tempRoot, 'subagent-edit.txt')
    await writeFile(subagentFile, 'subagent old\n')

    process.env['CRADLE_SUBAGENT'] = '1'
    const result = await execEdit(
      subagentFile,
      {
        path: 'subagent-edit.txt',
        edits: [
          {
            from: 1,
            fromHash: makeHash('subagent old'),
            to: 1,
            toHash: makeHash('subagent old'),
            newText: 'subagent new',
          },
        ],
      },
      tempRoot,
    )

    expect(result.content[0]).toMatchObject({ type: 'text' })
    await expect(readFile(subagentFile, 'utf8')).resolves.toBe('subagent new\n')
  })

  it('keeps render behavior intact', () => {
    expect(
      editTool.renderCall?.(
        { path: 'test.txt', edits: [] },
        // @ts-expect-error minimal theme mock
        {
          bold: (text: string) => text,
          fg: (_color: string, text: string) => text,
        },
        { expanded: false, isError: false, isPartial: false },
      ),
    ).toBeDefined()
  })

  it('hash mismatch error includes claimed, actual, and line content', async () => {
    const editFile = path.join(tempRoot, 'mismatch-detail.txt')
    await writeFile(editFile, '  return value\n')

    process.env['CRADLE_SUBAGENT'] = '1'
    const result = await execEdit(
      editFile,
      {
        path: 'mismatch-detail.txt',
        edits: [
          {
            from: 1,
            fromHash: 'abc123',
            to: 1,
            toHash: 'abc123',
            newText: 'new',
          },
        ],
      },
      tempRoot,
    )

    expect(result.isError).toBe(true)
    const text = (result.content[0] as { type: 'text'; text: string }).text
    expect(text).toContain('claimed "abc123"')
    expect(text).toContain('actual "')
    expect(text).toContain('  return value')
    expect(text).toContain('Read the file again')
  })
})
