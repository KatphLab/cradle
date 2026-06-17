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
import { writeTool } from '../write.js'

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
      content: 'proceed',
      timestamp: 2,
    },
  }
  const entries: SessionEntry[] = [proposalEntry, approvalEntry]
  return {
    getEntries: () => entries,
    getLeafId: () => 'user-approval',
  }
}

async function execWrite(
  filePath: string,
  content: string,
  workingDirectory = cwd,
  sessionManager: SessionManagerMock = emptySessionManager(),
) {
  return writeTool.execute(
    'test-call',
    { path: filePath, content },
    undefined,
    undefined,
    // @ts-expect-error minimal context mock
    { cwd: workingDirectory, sessionManager },
  )
}

let tempRoot: string
let deniedRoot: string

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'pi-write-test-'))
  deniedRoot = await mkdtemp(path.join(tmpdir(), 'pi-write-denied-'))
})

afterAll(async () => {
  await rm(tempRoot, { force: true, recursive: true })
  await rm(deniedRoot, { force: true, recursive: true })
})

describe('writeTool', () => {
  it('writes a file', async () => {
    const sessionManager = buildApprovedSession([
      { path: 'new-file.txt', operation: 'write', intent: 'test write' },
    ])
    const result = await execWrite(
      'new-file.txt',
      'hello world',
      tempRoot,
      sessionManager,
    )
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })

    const content = await readFile(path.join(tempRoot, 'new-file.txt'), 'utf8')
    expect(content).toBe('hello world')
  })

  it('denies writes outside allowed directories', async () => {
    const deniedFile = path.join(deniedRoot, 'denied.txt')
    await writeFile(deniedFile, 'denied')
    const sessionManager = buildApprovedSession([
      { path: deniedFile, operation: 'write', intent: 'test write' },
    ])
    await expect(
      execWrite(
        path.join(deniedRoot, 'denied.txt'),
        'changed',
        tempRoot,
        sessionManager,
      ),
    ).rejects.toThrow('write denied')
  })

  it('validates agent markdown before writing', async () => {
    const agentDirectory = path.join(tempRoot, 'agents')
    const agentPath = path.join(agentDirectory, 'test-agent.md')
    const invalidContent = `---\nname: test-agent\ndescription: ok\ntools: read\ntools: read\n---\nbody`

    const sessionManager = buildApprovedSession([
      { path: agentPath, operation: 'write', intent: 'test agent' },
    ])
    const result = await execWrite(
      agentPath,
      invalidContent,
      tempRoot,
      sessionManager,
    )

    expect(result).toHaveProperty('isError', true)
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Invalid agent definition'),
    })
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('DUPLICATE_KEY'),
    })

    // File should not have been written
    await expect(readFile(agentPath, 'utf8')).rejects.toThrow()
  })

  it('writes a valid agent file', async () => {
    const agentDirectory = path.join(tempRoot, 'agents')
    const agentPath = path.join(agentDirectory, 'valid-agent.md')
    const validContent = `---\nname: valid-agent\ndescription: A valid agent.\n---\nDo things.`

    const sessionManager = buildApprovedSession([
      { path: agentPath, operation: 'write', intent: 'test agent' },
    ])
    const result = await execWrite(
      agentPath,
      validContent,
      tempRoot,
      sessionManager,
    )

    expect(result).not.toHaveProperty('isError')
    expect(result.content).toHaveLength(1)

    const content = await readFile(agentPath, 'utf8')
    expect(content).toBe(validContent)
  })

  it('bypasses validation for non-agent files', async () => {
    const filePath = path.join(tempRoot, 'notes.md')
    const content = `---\nname: broken\ntools: a\ntools: a\n---\nbody`

    const sessionManager = buildApprovedSession([
      { path: filePath, operation: 'write', intent: 'test write' },
    ])
    const result = await execWrite(filePath, content, tempRoot, sessionManager)

    expect(result).not.toHaveProperty('isError')
    const written = await readFile(filePath, 'utf8')
    expect(written).toBe(content)
  })
})
