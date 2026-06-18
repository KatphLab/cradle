import type { AgentMessage } from '@earendil-works/pi-agent-core'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getApprovalHint } from '../approval-hint.js'
import {
  formatApprovalReminder,
  isApprovalDetails,
  isBashApproved,
  isFileApproved,
  reconstructApprovalState,
  type ApprovalDetails,
  type BashScope,
  type FileScope,
} from '../approval-state.js'

function makeUserMessage(text: string): AgentMessage {
  return {
    role: 'user',
    content: text,
    timestamp: 1,
  }
}

function makeAssistantMessage(text: string): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'test-api',
    provider: 'test-provider',
    model: 'test-model',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: 'stop',
    timestamp: 1,
  }
}

function makeApprovalToolResult(
  details: ApprovalDetails,
  options: { isError?: boolean } = {},
): AgentMessage {
  return {
    role: 'toolResult',
    toolName: 'approval',
    toolCallId: 'call_approval',
    content: [],
    isError: options.isError ?? false,
    timestamp: 1,
    details,
  }
}

function expectApprovalTags(text: string): void {
  expect(text).toContain('<yes>')
  expect(text).toContain('<approve>')
  expect(text).toContain('<proceed>')
}

const fileEditScope: FileScope = {
  path: 'src/example.ts',
  operation: 'edit',
  intent: 'refactor helper',
}

const fileWriteScope: FileScope = {
  path: 'src/new.ts',
  operation: 'write',
  intent: 'add new file',
}

const bashScope: BashScope = {
  pattern: 'pnpm test',
  riskLevel: 'medium',
  intent: 'run unit tests',
  allowedPaths: ['coverage/'],
}

const proposalDetails: ApprovalDetails = {
  action: 'proposal',
  id: '1',
  summary: 'edit example and run tests',
  fileScopes: [fileEditScope],
  bashScopes: [bashScope],
}

describe('isApprovalDetails', () => {
  it('accepts a valid proposal with file and bash scopes', () => {
    expect(isApprovalDetails(proposalDetails)).toBe(true)
  })

  it('accepts a valid amendment with file scopes only', () => {
    const amendment: ApprovalDetails = {
      action: 'amendment',
      id: '1',
      fileScopes: [fileWriteScope],
    }
    expect(isApprovalDetails(amendment)).toBe(true)
  })

  it('rejects malformed details (unknown action, missing fields, bad operation)', () => {
    const cases: unknown[] = [
      null,
      undefined,
      'not-an-object',
      { action: 'approve', id: '1' },
      { action: 'proposal', id: '1' },
      {
        action: 'proposal',
        id: '1',
        fileScopes: [{ path: 'x.ts', operation: 'delete', intent: 'oops' }],
        bashScopes: [],
      },
      {
        action: 'proposal',
        id: '1',
        fileScopes: [fileEditScope],
        bashScopes: [
          {
            pattern: 'rm',
            riskLevel: 'extreme',
            intent: 'cleanup',
            allowedPaths: [],
          },
        ],
      },
      { action: 'amendment', id: 42 },
    ]
    for (const value of cases) {
      expect(isApprovalDetails(value)).toBe(false)
    }
  })
})

describe('reconstructApprovalState', () => {
  it('returns an empty state for an empty message list', () => {
    const state = reconstructApprovalState([])
    expect(state).toEqual({ pending: undefined, approved: undefined })
  })

  it('promotes a pending proposal to approved when a later user message contains an approval tag', () => {
    const messages: AgentMessage[] = [
      makeApprovalToolResult(proposalDetails),
      makeUserMessage('<yes>'),
    ]
    const state = reconstructApprovalState(messages)
    expect(state.pending).toBeUndefined()
    expect(state.approved).toEqual({
      id: '1',
      fileScopes: [fileEditScope],
      bashScopes: [bashScope],
    })
  })

  it('does not promote when "proceed" comes from an assistant message (no self-approval)', () => {
    const messages: AgentMessage[] = [
      makeApprovalToolResult(proposalDetails),
      makeAssistantMessage('<proceed>'),
    ]
    const state = reconstructApprovalState(messages)
    expect(state.approved).toBeUndefined()
    expect(state.pending).toEqual({
      id: '1',
      fileScopes: [fileEditScope],
      bashScopes: [bashScope],
    })
  })

  it('applies "proceed" only to the latest pending proposal, not earlier approved ones', () => {
    const secondProposal: ApprovalDetails = {
      action: 'proposal',
      id: '2',
      fileScopes: [fileWriteScope],
      bashScopes: [],
    }
    const messages: AgentMessage[] = [
      makeApprovalToolResult(proposalDetails),
      makeUserMessage('<proceed>'),
      makeApprovalToolResult(secondProposal),
      makeUserMessage('<proceed>'),
    ]
    const state = reconstructApprovalState(messages)
    expect(state.approved).toEqual({
      id: '2',
      fileScopes: [fileWriteScope],
      bashScopes: [],
    })
    expect(state.pending).toBeUndefined()
  })

  it('supersedes a previous pending proposal when a new proposal is emitted', () => {
    const secondProposal: ApprovalDetails = {
      action: 'proposal',
      id: '2',
      fileScopes: [fileWriteScope],
      bashScopes: [],
    }
    const messages: AgentMessage[] = [
      makeApprovalToolResult(proposalDetails),
      makeApprovalToolResult(secondProposal),
    ]
    const state = reconstructApprovalState(messages)
    expect(state.pending).toEqual({
      id: '2',
      fileScopes: [fileWriteScope],
      bashScopes: [],
    })
    expect(state.approved).toBeUndefined()
  })

  it('amends the eventual approval scope when an amendment is recorded before user approval', () => {
    const amendment: ApprovalDetails = {
      action: 'amendment',
      id: '1',
      fileScopes: [fileWriteScope],
    }
    const messages: AgentMessage[] = [
      makeApprovalToolResult(proposalDetails),
      makeApprovalToolResult(amendment),
      makeUserMessage('<approve>'),
    ]
    const state = reconstructApprovalState(messages)
    expect(state.approved?.id).toBe('1')
    expect(state.approved?.fileScopes).toEqual([fileEditScope, fileWriteScope])
    expect(state.approved?.bashScopes).toEqual([bashScope])
    expect(state.pending).toBeUndefined()
  })

  it('clears the approved state when a complete action is recorded', () => {
    const complete: ApprovalDetails = {
      action: 'complete',
      id: '1',
      reason: 'done',
    }
    const messages: AgentMessage[] = [
      makeApprovalToolResult(proposalDetails),
      makeUserMessage('<proceed>'),
      makeApprovalToolResult(complete),
    ]
    const state = reconstructApprovalState(messages)
    expect(state.approved).toBeUndefined()
    expect(state.pending).toBeUndefined()
  })
})

describe('isFileApproved', () => {
  it('returns true when the file path and operation match an approved scope', () => {
    const state = reconstructApprovalState([
      makeApprovalToolResult(proposalDetails),
      makeUserMessage('<proceed>'),
    ])
    expect(isFileApproved(state, 'src/example.ts', 'edit')).toBe(true)
  })

  it('returns false when the file path is unapproved or the operation differs', () => {
    const state = reconstructApprovalState([
      makeApprovalToolResult(proposalDetails),
      makeUserMessage('<proceed>'),
    ])
    expect(isFileApproved(state, 'src/example.ts', 'write')).toBe(false)
    expect(isFileApproved(state, 'src/other.ts', 'edit')).toBe(false)
    expect(isFileApproved(state, 'src/other.ts', 'write')).toBe(false)
  })

  it('matches when scope has relative path and file path is absolute', () => {
    const relativeScope: FileScope = {
      path: 'src/example.ts',
      operation: 'edit',
      intent: 'refactor',
    }
    const state = reconstructApprovalState([
      makeApprovalToolResult({
        action: 'proposal',
        id: '1',
        fileScopes: [relativeScope],
        bashScopes: [],
      }),
      makeUserMessage('<proceed>'),
    ])
    const absolutePath = path.resolve('src/example.ts')
    expect(isFileApproved(state, absolutePath, 'edit')).toBe(true)
  })

  it('matches when scope has absolute path and file path is relative', () => {
    const absoluteScope: FileScope = {
      path: path.resolve('src/example.ts'),
      operation: 'edit',
      intent: 'refactor',
    }
    const state = reconstructApprovalState([
      makeApprovalToolResult({
        action: 'proposal',
        id: '1',
        fileScopes: [absoluteScope],
        bashScopes: [],
      }),
      makeUserMessage('<proceed>'),
    ])
    expect(isFileApproved(state, 'src/example.ts', 'edit')).toBe(true)
  })

  it('matches glob patterns like mr-description-*.md', () => {
    const globScope: FileScope = {
      path: 'mr-description-*.md',
      operation: 'write',
      intent: 'write temporary PR description',
    }
    const state = reconstructApprovalState([
      makeApprovalToolResult({
        action: 'proposal',
        id: '1',
        fileScopes: [globScope],
        bashScopes: [],
      }),
      makeUserMessage('<proceed>'),
    ])
    expect(isFileApproved(state, 'mr-description-12345.md', 'write')).toBe(true)
    expect(isFileApproved(state, 'mr-description-abc.md', 'write')).toBe(true)
    expect(isFileApproved(state, 'other-file.md', 'write')).toBe(false)
  })

  it('matches glob patterns with path separators', () => {
    const globScope: FileScope = {
      path: 'src/**/*.test.ts',
      operation: 'edit',
      intent: 'edit test files',
    }
    const state = reconstructApprovalState([
      makeApprovalToolResult({
        action: 'proposal',
        id: '1',
        fileScopes: [globScope],
        bashScopes: [],
      }),
      makeUserMessage('<proceed>'),
    ])
    expect(isFileApproved(state, 'src/utils/helper.test.ts', 'edit')).toBe(true)
    expect(isFileApproved(state, 'src/lib/deep/nested.test.ts', 'edit')).toBe(
      true,
    )
    expect(isFileApproved(state, 'src/production.ts', 'edit')).toBe(false)
  })

  it('matches glob patterns with ? wildcard', () => {
    const globScope: FileScope = {
      path: 'file?.txt',
      operation: 'write',
      intent: 'write numbered files',
    }
    const state = reconstructApprovalState([
      makeApprovalToolResult({
        action: 'proposal',
        id: '1',
        fileScopes: [globScope],
        bashScopes: [],
      }),
      makeUserMessage('<proceed>'),
    ])
    expect(isFileApproved(state, 'file1.txt', 'write')).toBe(true)
    expect(isFileApproved(state, 'fileA.txt', 'write')).toBe(true)
    expect(isFileApproved(state, 'file12.txt', 'write')).toBe(false)
  })
})

describe('isBashApproved', () => {
  it('returns true when the command matches an approved pattern within the approved risk tier', () => {
    const state = reconstructApprovalState([
      makeApprovalToolResult(proposalDetails),
      makeUserMessage('<proceed>'),
    ])
    expect(isBashApproved(state, 'pnpm test', 'medium')).toBe(true)
    expect(isBashApproved(state, 'pnpm test -- --run foo', 'low')).toBe(true)
  })

  it('returns false when the attempted risk level exceeds the approved risk tier', () => {
    const state = reconstructApprovalState([
      makeApprovalToolResult(proposalDetails),
      makeUserMessage('<proceed>'),
    ])
    expect(isBashApproved(state, 'pnpm test', 'critical')).toBe(false)
    expect(isBashApproved(state, 'pnpm test', 'high')).toBe(false)
  })
})

describe('formatApprovalReminder', () => {
  it('includes approved file and bash scopes when an approval is active', () => {
    const state = reconstructApprovalState([
      makeApprovalToolResult(proposalDetails),
      makeUserMessage('<proceed>'),
    ])
    const reminder = formatApprovalReminder(state)
    expect(reminder).toBeDefined()
    expect(reminder).toContain('Proposal #1')
    expect(reminder).toContain('edit `src/example.ts`')
    expect(reminder).toContain('`pnpm test` (risk=medium)')
    expect(reminder).not.toContain('Pending Approval')
  })

  it('includes pending proposal scope and accepted approval tags', () => {
    const state = reconstructApprovalState([
      makeApprovalToolResult(proposalDetails),
    ])
    const reminder = formatApprovalReminder(state)
    expect(reminder).toBeDefined()
    expect(reminder).toContain('Proposal #1')
    expect(reminder).toMatch(/pending/i)
    expectApprovalTags(reminder ?? '')
    expect(reminder).toContain('edit `src/example.ts`')
    expect(reminder).toContain('`pnpm test` (risk=medium)')
  })
})

describe('getApprovalHint', () => {
  it('is exported and callable', () => {
    // Verify the function is properly exported
    expect(typeof getApprovalHint).toBe('function')
  })

  // Full integration tests are handled through the read tool since
  // getApprovalHint requires a sessionManager with getEntries/getLeafId.
  // The underlying logic (reconstructApprovalState + isFileApproved) is
  // thoroughly tested above.
})
