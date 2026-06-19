import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type {
  ExtensionContext,
  SessionEntry,
  SessionMessageEntry,
} from '@earendil-works/pi-coding-agent'

import type {
  ApprovalDetails,
  BashScope,
  FileScope,
} from '../../utils/approval-state.js'
import { bashTool } from '../bash.js'

interface SessionManagerMock {
  getEntries: () => SessionEntry[]
  getLeafId: () => string | null
}

function emptySessionManager(): SessionManagerMock {
  return { getEntries: () => [], getLeafId: () => null }
}

function makeContext(
  cwd: string,
  confirmSpy: ReturnType<typeof vi.fn>,
  sessionManager: SessionManagerMock = emptySessionManager(),
): ExtensionContext {
  return {
    cwd,
    ui: { confirm: confirmSpy },
    sessionManager,
  } as unknown as ExtensionContext
}

function buildApprovedSession(
  fileScopes: FileScope[],
  bashScopes: BashScope[],
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

let withPatternsDirectory: string
let withoutPatternsDirectory: string

beforeAll(async () => {
  withPatternsDirectory = await mkdtemp(path.join(tmpdir(), 'pi-bash-with-'))
  withoutPatternsDirectory = await mkdtemp(
    path.join(tmpdir(), 'pi-bash-without-'),
  )

  const riskPatterns = [
    {
      pattern: String.raw`\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?-[a-zA-Z]*f`,
      level: 'critical',
      reason: 'Recursive force deletion',
    },
    {
      pattern: String.raw`\bsudo\b`,
      level: 'high',
      reason: 'Elevated privileges',
    },
    {
      pattern: String.raw`\bchmod\s+.*777`,
      level: 'medium',
      reason: 'Broad permission change',
    },
  ]

  await writeFile(
    path.join(withPatternsDirectory, 'SHELL_RISK_PATTERNS.json'),
    JSON.stringify(riskPatterns),
  )
})

afterAll(async () => {
  await rm(withPatternsDirectory, { force: true, recursive: true })
  await rm(withoutPatternsDirectory, { force: true, recursive: true })
})

describe('bashTool', () => {
  it('executes low-risk command without confirmation', async () => {
    const confirmSpy = vi.fn()
    const result = await bashTool.execute(
      'test-call',
      {
        command: 'echo hello',
        summary: 'Print hello',
        riskLevel: 'low',
        riskReason: 'Harmless',
      },
      new AbortController().signal,
      vi.fn(),
      makeContext(withPatternsDirectory, confirmSpy),
    )

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect(result.content[0]).toHaveProperty(
      'text',
      expect.stringContaining('hello'),
    )
  })

  it('accepts timeout parameter', async () => {
    const confirmSpy = vi.fn()
    const result = await bashTool.execute(
      'test-call',
      {
        command: 'echo timeout-test',
        summary: 'Test timeout',
        riskLevel: 'low',
        riskReason: 'Harmless',
        timeout: 5,
      },
      new AbortController().signal,
      vi.fn(),
      makeContext(withPatternsDirectory, confirmSpy),
    )

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })
  })

  it('blocks high-risk command when user denies', async () => {
    const confirmSpy = vi.fn().mockResolvedValue(false)
    const result = await bashTool.execute(
      'test-call',
      {
        command: 'echo sudo apt update',
        summary: 'Print sudo string',
        riskLevel: 'low',
        riskReason: 'Just cleanup',
      },
      new AbortController().signal,
      vi.fn(),
      makeContext(withPatternsDirectory, confirmSpy),
    )

    expect(confirmSpy).toHaveBeenCalled()
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Blocked'),
    })
  })

  it('executes high-risk command when user allows', async () => {
    const confirmSpy = vi.fn().mockResolvedValue(true)
    const sessionManager = buildApprovedSession(
      [],
      [
        {
          pattern: 'sudo',
          riskLevel: 'high',
          intent: 'test sudo commands',
          allowedPaths: [],
        },
      ],
    )
    const result = await bashTool.execute(
      'test-call',
      {
        command: 'echo sudo apt update',
        summary: 'Print sudo string',
        riskLevel: 'high',
        riskReason: 'Elevated privileges',
      },
      new AbortController().signal,
      vi.fn(),
      makeContext(withPatternsDirectory, confirmSpy, sessionManager),
    )

    expect(confirmSpy).toHaveBeenCalled()
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })
  })

  it('overrides under-declared risk and confirms', async () => {
    const confirmSpy = vi.fn().mockResolvedValue(true)
    const result = await bashTool.execute(
      'test-call',
      {
        command: 'echo rm -rf /',
        summary: 'Print scary string',
        riskLevel: 'low',
        riskReason: 'Low risk',
      },
      new AbortController().signal,
      vi.fn(),
      makeContext(withPatternsDirectory, confirmSpy),
    )

    expect(confirmSpy).toHaveBeenCalled()
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })
  })

  it('blocks under-declared critical when user denies', async () => {
    const confirmSpy = vi.fn().mockResolvedValue(false)
    const result = await bashTool.execute(
      'test-call',
      {
        command: 'echo rm -rf /',
        summary: 'Print scary string',
        riskLevel: 'low',
        riskReason: 'Low risk',
      },
      new AbortController().signal,
      vi.fn(),
      makeContext(withPatternsDirectory, confirmSpy),
    )

    expect(confirmSpy).toHaveBeenCalled()
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Blocked'),
    })
  })

  it('handles medium-risk command without confirmation', async () => {
    const confirmSpy = vi.fn()
    const sessionManager = buildApprovedSession(
      [],
      [
        {
          pattern: 'chmod 777',
          riskLevel: 'high',
          intent: 'test chmod commands',
          allowedPaths: [],
        },
      ],
    )
    const result = await bashTool.execute(
      'test-call',
      {
        command: 'echo chmod 777 example',
        summary: 'Print permissions',
        riskLevel: 'medium',
        riskReason: 'Permission change',
      },
      new AbortController().signal,
      vi.fn(),
      makeContext(withPatternsDirectory, confirmSpy, sessionManager),
    )

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })
  })

  it('uses declared reason when declared risk exceeds detected', async () => {
    const confirmSpy = vi.fn().mockResolvedValue(true)
    const sessionManager = buildApprovedSession(
      [],
      [
        {
          pattern: 'chmod 777',
          riskLevel: 'high',
          intent: 'test chmod commands',
          allowedPaths: [],
        },
      ],
    )
    await bashTool.execute(
      'test-call',
      {
        command: 'echo chmod 777 example',
        summary: 'Print permissions',
        riskLevel: 'high',
        riskReason: 'Intentional broad permissions',
      },
      new AbortController().signal,
      vi.fn(),
      makeContext(withPatternsDirectory, confirmSpy, sessionManager),
    )

    expect(confirmSpy).toHaveBeenCalled()
    expect(confirmSpy).toHaveBeenCalledWith(
      'High-risk command: high',
      expect.stringContaining('Intentional broad permissions'),
    )
  })

  it('trusts LLM when no patterns file exists', async () => {
    const confirmSpy = vi.fn()
    const result = await bashTool.execute(
      'test-call',
      {
        command: 'echo rm -rf /',
        summary: 'Print scary string',
        riskLevel: 'low',
        riskReason: 'Low risk',
      },
      new AbortController().signal,
      vi.fn(),
      makeContext(withoutPatternsDirectory, confirmSpy),
    )

    // No patterns loaded — trust the LLM's declared low risk.
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })
  })

  it('blocks low-risk shell redirects without approved allowed paths', async () => {
    const confirmSpy = vi.fn()
    const targetPath = path.join(withoutPatternsDirectory, 'blocked.txt')
    const result = await bashTool.execute(
      'test-call',
      {
        command: `printf blocked > ${targetPath}`,
        summary: 'Write through redirect',
        riskLevel: 'low',
        riskReason: 'Model claimed harmless',
      },
      new AbortController().signal,
      vi.fn(),
      makeContext(withoutPatternsDirectory, confirmSpy),
    )

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('appears to write files'),
    })
  })

  it('allows shell redirects only when the bash scope allowedPaths include the target', async () => {
    const confirmSpy = vi.fn()
    const targetPath = path.join(withoutPatternsDirectory, 'allowed.txt')
    const sessionManager = buildApprovedSession(
      [],
      [
        {
          pattern: 'printf allowed',
          riskLevel: 'low',
          intent: 'test approved redirect',
          allowedPaths: [targetPath],
        },
      ],
    )

    const result = await bashTool.execute(
      'test-call',
      {
        command: `printf allowed > ${targetPath}`,
        summary: 'Write through approved redirect',
        riskLevel: 'low',
        riskReason: 'Approved test write',
      },
      new AbortController().signal,
      vi.fn(),
      makeContext(withoutPatternsDirectory, confirmSpy, sessionManager),
    )

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(result.content).toHaveLength(1)
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('allowed')
  })

  it('blocks inline script file writes because the target cannot be verified', async () => {
    const confirmSpy = vi.fn()
    const result = await bashTool.execute(
      'test-call',
      {
        command: `python -c "open('bypass.txt', 'w').write('bad')"`,
        summary: 'Write through Python',
        riskLevel: 'low',
        riskReason: 'Model claimed harmless',
      },
      new AbortController().signal,
      vi.fn(),
      makeContext(withoutPatternsDirectory, confirmSpy),
    )

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('unknown paths'),
    })
  })
})
