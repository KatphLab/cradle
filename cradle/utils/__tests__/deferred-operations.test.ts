import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { describe, expect, it } from 'vitest'

import {
  createDeferredOperationResult,
  isDeferredOperationDetails,
  reconstructDeferredOperations,
  type DeferredOperationDetails,
} from '../deferred-operations.js'

function makeDeferredToolResult(
  details: DeferredOperationDetails,
): AgentMessage {
  return {
    role: 'toolResult',
    toolName: details.toolName,
    toolCallId: details.id,
    content: [],
    isError: false,
    timestamp: 1,
    details,
  }
}

function makeApprovalReplayResult(replayedIds: string[]): AgentMessage {
  return {
    role: 'toolResult',
    toolName: 'approval',
    toolCallId: 'call-approval',
    content: [],
    isError: false,
    timestamp: 1,
    details: {
      action: 'replay',
      id: 'proposal-1',
      operationIds: replayedIds,
      replayedIds,
    },
  }
}

function makeUserMessage(content: string): AgentMessage {
  return { role: 'user', content, timestamp: 1 }
}

describe('createDeferredOperationResult', () => {
  it('captures blocked write parameters as structured details', () => {
    const result = createDeferredOperationResult(
      'call-1',
      'write',
      { path: './src/new.ts', content: 'hello' },
      'Blocked write.',
    )

    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({
      kind: 'deferred-operation',
      id: 'deferred-call-1',
      toolName: 'write',
      path: './src/new.ts',
      operation: 'write',
      parameters: { path: './src/new.ts', content: 'hello' },
      requiredScope: {
        path: './src/new.ts',
        operation: 'write',
      },
    })
    expect(isDeferredOperationDetails(result.details)).toBe(true)
  })
})

describe('reconstructDeferredOperations', () => {
  it('returns blocked operations from transcript details', () => {
    const deferred = createDeferredOperationResult(
      'call-1',
      'edit',
      {
        path: 'src/example.ts',
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
      'Blocked edit.',
    ).details

    const state = reconstructDeferredOperations([
      makeDeferredToolResult(deferred),
    ])

    expect(state.operations).toEqual([deferred])
  })

  it('removes operations replayed by approval replay results', () => {
    const deferred = createDeferredOperationResult(
      'call-1',
      'write',
      { path: 'src/new.ts', content: 'hello' },
      'Blocked write.',
    ).details

    const state = reconstructDeferredOperations([
      makeDeferredToolResult(deferred),
      makeApprovalReplayResult([deferred.id]),
    ])

    expect(state.operations).toEqual([])
  })

  it('clears deferred operations when the user responds without an approval tag', () => {
    const deferred = createDeferredOperationResult(
      'call-1',
      'write',
      { path: 'src/new.ts', content: 'hello' },
      'Blocked write.',
    ).details

    const state = reconstructDeferredOperations([
      makeDeferredToolResult(deferred),
      makeUserMessage('not now'),
    ])

    expect(state.operations).toEqual([])
  })

  it('keeps deferred operations when the user response contains an approval tag', () => {
    const deferred = createDeferredOperationResult(
      'call-1',
      'write',
      { path: 'src/new.ts', content: 'hello' },
      'Blocked write.',
    ).details

    const state = reconstructDeferredOperations([
      makeDeferredToolResult(deferred),
      makeUserMessage('<yes>'),
    ])

    expect(state.operations).toEqual([deferred])
  })
})
