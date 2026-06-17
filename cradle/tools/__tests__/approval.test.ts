import type {
  AgentMessage,
  AgentToolResult,
} from '@earendil-works/pi-agent-core'
import type {
  ExtensionContext,
  SessionEntry,
} from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import { setToolOutputModeForTests } from '../../config/settings.js'
import type {
  ApprovalDetails,
  BashScope,
  FileScope,
} from '../../utils/approval-state.js'
import { approvalTool, type ApprovalToolParameters } from '../approval.js'

function executeApproval(
  parameters: ApprovalToolParameters,
  entries: SessionEntry[] = [],
  leafId: string | null = null,
) {
  const context = {
    sessionManager: {
      getEntries: () => entries,
      getLeafId: () => leafId,
    },
  } as unknown as ExtensionContext

  return approvalTool.execute(
    'test-call',
    parameters,
    undefined,
    undefined,
    context,
  )
}

interface TextResultLike {
  content: { type: string; text?: string }[]
}

function firstTextContent(result: TextResultLike): string {
  const firstContent = result.content[0]
  if (firstContent?.type !== 'text') return ''
  return firstContent.text ?? ''
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

function makeUserMessage(text: string): AgentMessage {
  return {
    role: 'user',
    content: text,
    timestamp: 1,
  }
}

interface SeedEntry {
  message: AgentMessage
  id: string
  parentId: string | null
}

function seedChain(entries: SeedEntry[]): SessionEntry[] {
  return entries.map((entry, index) => ({
    type: 'message',
    id: entry.id,
    parentId: entry.parentId,
    timestamp: `2024-01-01T00:00:0${String(index)}.000Z`,
    message: entry.message,
  }))
}

function lastId(entries: SessionEntry[]): string | null {
  return entries.at(-1)?.id ?? null
}

describe('approvalTool — proposal action', () => {
  it('records proposal details with file scopes only', async () => {
    const result = await executeApproval({
      action: 'proposal',
      id: '1',
      summary: 'edit example',
      fileScopes: [fileEditScope],
    })

    expect(result.details).toEqual({
      action: 'proposal',
      id: '1',
      summary: 'edit example',
      fileScopes: [fileEditScope],
      bashScopes: [],
    })
    const text = firstTextContent(result)
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect(text).toContain('## Approval proposal #1')
    expect(text).toContain('edit example')
    expect(text).toContain('- edit `src/example.ts` — refactor helper')
    expect(text).toContain('Confirm if you want me to proceed.')
  })

  it('records proposal details with bash scopes only', async () => {
    const result = await executeApproval({
      action: 'proposal',
      id: '2',
      bashScopes: [bashScope],
    })

    expect(result.details).toEqual({
      action: 'proposal',
      id: '2',
      fileScopes: [],
      bashScopes: [bashScope],
    })
    const text = firstTextContent(result)
    expect(text).toContain('## Approval proposal #2')
    expect(text).toContain(
      '- `pnpm test` (risk=medium, allowed paths: `coverage/`) — run unit tests',
    )
  })

  it('records proposal with both file and bash scopes', async () => {
    const result = await executeApproval({
      action: 'proposal',
      id: '3',
      fileScopes: [fileEditScope],
      bashScopes: [bashScope],
    })

    expect(result.details).toMatchObject({
      action: 'proposal',
      id: '3',
      fileScopes: [fileEditScope],
      bashScopes: [bashScope],
    })
    const text = firstTextContent(result)
    expect(text).toContain('### File operations')
    expect(text).toContain('### Bash operations')
  })

  it('rejects proposal with no scopes at all', async () => {
    await expect(
      executeApproval({ action: 'proposal', id: '4' }),
    ).rejects.toThrow(/at least one file or bash scope/)
  })

  it('rejects proposal with empty file and bash arrays', async () => {
    await expect(
      executeApproval({
        action: 'proposal',
        id: '5',
        fileScopes: [],
        bashScopes: [],
      }),
    ).rejects.toThrow(/at least one file or bash scope/)
  })
})

describe('approvalTool — amendment action', () => {
  it('records amendment details with file scopes', async () => {
    const result = await executeApproval({
      action: 'amendment',
      id: '1',
      fileScopes: [fileWriteScope],
    })

    expect(result.details).toEqual({
      action: 'amendment',
      id: '1',
      fileScopes: [fileWriteScope],
    })
    const text = firstTextContent(result)
    expect(text).toContain('## Approval amendment #1')
    expect(text).toContain('- write `src/new.ts` — add new file')
  })

  it('records amendment details with bash scopes', async () => {
    const result = await executeApproval({
      action: 'amendment',
      id: '1',
      bashScopes: [bashScope],
    })

    expect(result.details).toEqual({
      action: 'amendment',
      id: '1',
      bashScopes: [bashScope],
    })
  })

  it('rejects amendment with no scopes at all', async () => {
    await expect(
      executeApproval({ action: 'amendment', id: '1' }),
    ).rejects.toThrow(/at least one file or bash scope/)
  })

  it('rejects amendment with empty file and bash arrays', async () => {
    await expect(
      executeApproval({
        action: 'amendment',
        id: '1',
        fileScopes: [],
        bashScopes: [],
      }),
    ).rejects.toThrow(/at least one file or bash scope/)
  })
})

describe('approvalTool — complete action', () => {
  it('completes the currently approved proposal', async () => {
    const proposal: ApprovalDetails = {
      action: 'proposal',
      id: '1',
      fileScopes: [fileEditScope],
      bashScopes: [],
    }
    const seed = seedChain([
      { id: 'e1', parentId: null, message: makeApprovalToolResult(proposal) },
      { id: 'e2', parentId: 'e1', message: makeUserMessage('yes, proceed') },
    ])

    const result = await executeApproval(
      { action: 'complete', id: '1', reason: 'all done' },
      seed,
      lastId(seed),
    )

    expect(result.details).toEqual({
      action: 'complete',
      id: '1',
      reason: 'all done',
    })
    expect(firstTextContent(result)).toContain('Proposal #1')
    expect(firstTextContent(result)).toContain('complete')
  })

  it('rejects complete when no proposal is approved', async () => {
    await expect(
      executeApproval({ action: 'complete', id: '1' }),
    ).rejects.toThrow(/currently approved proposal is none/)
  })

  it('rejects complete when id does not match the approved proposal', async () => {
    const proposal: ApprovalDetails = {
      action: 'proposal',
      id: '1',
      fileScopes: [fileEditScope],
      bashScopes: [],
    }
    const seed = seedChain([
      { id: 'e1', parentId: null, message: makeApprovalToolResult(proposal) },
      { id: 'e2', parentId: 'e1', message: makeUserMessage('proceed') },
    ])

    await expect(
      executeApproval({ action: 'complete', id: 'wrong' }, seed, lastId(seed)),
    ).rejects.toThrow(/currently approved proposal is #1/)
  })
})

function makeProposalResult(): AgentToolResult<ApprovalDetails> {
  return {
    content: [{ type: 'text', text: 'Proposal #1 recorded with 1 scope.' }],
    details: {
      action: 'proposal',
      id: '1',
      fileScopes: [fileEditScope],
      bashScopes: [],
    },
  }
}

function makeErrorResult(): AgentToolResult<ApprovalDetails> {
  return {
    content: [{ type: 'text', text: 'Blocked' }],
    details: {
      action: 'proposal',
      id: '1',
      fileScopes: [fileEditScope],
      bashScopes: [],
    },
  }
}

function makeTheme(): {
  fg: (a: string, t: string) => string
  bold: (t: string) => string
} {
  return {
    fg: (_label: string, text: string) => text,
    bold: (text: string) => text,
  }
}

function renderedText(component: unknown): string {
  if (
    typeof component === 'object' &&
    component !== null &&
    'text' in component &&
    typeof component.text === 'string'
  ) {
    return component.text
  }
  throw new TypeError('Expected rendered Text component')
}

function makeContext(isError = false) {
  return {
    args: {},
    toolCallId: 'call_1',
    invalidate() {
      return
    },
    lastComponent: undefined,
    state: {},
    cwd: process.cwd(),
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    showImages: false,
    isError,
  }
}

describe('approvalTool — renderResult', () => {
  it('renders full output when expanded', () => {
    setToolOutputModeForTests('full')
    const renderResult = approvalTool.renderResult
    expect(renderResult).toBeDefined()
    const result = renderResult?.(
      makeProposalResult(),
      { expanded: true, isPartial: false },
      makeTheme() as never,
      makeContext(),
    )
    expect(result).toBeDefined()
  })

  it('renders full output when collapsed in preview mode', () => {
    setToolOutputModeForTests('preview')
    const renderResult = approvalTool.renderResult
    expect(renderResult).toBeDefined()
    const result = renderResult?.(
      makeProposalResult(),
      { expanded: false, isPartial: false },
      makeTheme() as never,
      makeContext(),
    )
    expect(renderedText(result)).toContain('Proposal #1 recorded with 1 scope.')
  })

  it('renders full output in header-only mode', () => {
    setToolOutputModeForTests('header-only')
    const renderResult = approvalTool.renderResult
    expect(renderResult).toBeDefined()
    const result = renderResult?.(
      makeProposalResult(),
      { expanded: false, isPartial: false },
      makeTheme() as never,
      makeContext(),
    )
    expect(renderedText(result)).toContain('Proposal #1 recorded with 1 scope.')
  })

  it('renders full error output in header-only mode', () => {
    setToolOutputModeForTests('header-only')
    const renderResult = approvalTool.renderResult
    expect(renderResult).toBeDefined()
    const result = renderResult?.(
      makeErrorResult(),
      { expanded: false, isPartial: false },
      makeTheme() as never,
      makeContext(true),
    )
    expect(renderedText(result)).toContain('Blocked')
  })

  it('renders full output in hidden mode', () => {
    setToolOutputModeForTests('hidden')
    const renderResult = approvalTool.renderResult
    expect(renderResult).toBeDefined()
    const result = renderResult?.(
      makeProposalResult(),
      { expanded: false, isPartial: false },
      makeTheme() as never,
      makeContext(),
    )
    expect(renderedText(result)).toContain('Proposal #1 recorded with 1 scope.')
  })

  it('renders full error output in hidden mode', () => {
    setToolOutputModeForTests('hidden')
    const renderResult = approvalTool.renderResult
    expect(renderResult).toBeDefined()
    const result = renderResult?.(
      makeErrorResult(),
      { expanded: false, isPartial: false },
      makeTheme() as never,
      makeContext(true),
    )
    expect(renderedText(result)).toContain('Blocked')
  })
})
