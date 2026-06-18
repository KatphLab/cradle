import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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

async function execEdit(
  filePath: string,
  oldText: string,
  newText: string,
  workingDirectory = cwd,
  sessionManager: SessionManagerMock = emptySessionManager(),
) {
  return editTool.execute(
    'test-call',
    { path: filePath, edits: [{ oldText, newText }] },
    undefined,
    undefined,
    // @ts-expect-error minimal context mock
    { cwd: workingDirectory, sessionManager },
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
    const sessionManager = buildApprovedSession([
      { path: 'edit-me.txt', operation: 'edit', intent: 'test edit' },
    ])
    const result = await execEdit(
      'edit-me.txt',
      'old',
      'new',
      tempRoot,
      sessionManager,
    )
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })

    const content = await readFile(editFile, 'utf8')
    expect(content).toBe('new content here')
  })

  it('denies writes outside allowed directories', async () => {
    const deniedFile = path.join(deniedRoot, 'denied.txt')
    await writeFile(deniedFile, 'denied')
    const sessionManager = buildApprovedSession([
      { path: deniedFile, operation: 'edit', intent: 'test edit' },
    ])
    await expect(
      execEdit(deniedFile, 'denied', 'changed', tempRoot, sessionManager),
    ).rejects.toThrow('write denied')
  })

  it('captures blocked edits as deferred operations', async () => {
    const sessionManager = buildApprovedSession([
      { path: 'other-file.ts', operation: 'edit', intent: 'different file' },
    ])
    const result = await execEdit(
      'edit-me.txt',
      'old',
      'new',
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
      path: 'edit-me.txt',
      operation: 'edit',
      parameters: {
        path: 'edit-me.txt',
        edits: [{ oldText: 'old', newText: 'new' }],
      },
    })
  })

  it('allows subagent edits without approval', async () => {
    const previousValue = process.env['CRADLE_SUBAGENT']
    const subagentFile = path.join(tempRoot, 'subagent-edit.txt')
    await writeFile(subagentFile, 'subagent old content')

    try {
      process.env['CRADLE_SUBAGENT'] = '1'
      const result = await execEdit('subagent-edit.txt', 'old', 'new', tempRoot)

      expect(result.content[0]).toMatchObject({ type: 'text' })
      await expect(readFile(subagentFile, 'utf8')).resolves.toBe(
        'subagent new content',
      )
      expect(
        editTool.renderCall?.(
          { path: 'subagent-edit.txt', edits: [] },
          // @ts-expect-error minimal theme mock
          {
            bold: (text: string) => text,
            fg: (_color: string, text: string) => text,
          },
          { expanded: false, isError: false, isPartial: false },
        ),
      ).toBeDefined()
    } finally {
      if (previousValue === undefined) {
        delete process.env['CRADLE_SUBAGENT']
      } else {
        process.env['CRADLE_SUBAGENT'] = previousValue
      }
    }
  })
})
