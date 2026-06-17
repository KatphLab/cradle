import { appendFile, mkdir } from 'node:fs/promises'

import {
  getAgentDir,
  withFileMutationQueue,
} from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { appendSubagentRunRecord } from '../run-index.js'

vi.mock('node:fs/promises', () => ({
  appendFile: vi.fn(),
  mkdir: vi.fn(),
}))

vi.mock('@earendil-works/pi-coding-agent', () => ({
  getAgentDir: vi.fn(() => '/home/test/.pi/agent'),
  withFileMutationQueue: vi.fn(
    async (_filePath: string, fn: () => Promise<void>) => fn(),
  ),
}))

describe('appendSubagentRunRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('appends subagent run records to the diagnostics index', async () => {
    await appendSubagentRunRecord({
      runId: 'run-1',
      agent: 'reviewer',
      task: 'review',
      cwd: '/repo',
      sessionId: 'session-1',
      sessionFile: '/sessions/session-1.jsonl',
      status: 'failed',
      exitCode: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
    })

    expect(getAgentDir).toHaveBeenCalledWith()
    expect(mkdir).toHaveBeenCalledWith('/home/test/.pi/agent/subagents', {
      recursive: true,
    })
    expect(withFileMutationQueue).toHaveBeenCalledWith(
      '/home/test/.pi/agent/subagents/runs.jsonl',
      expect.any(Function),
    )
    expect(appendFile).toHaveBeenCalledWith(
      '/home/test/.pi/agent/subagents/runs.jsonl',
      expect.stringContaining('"sessionId":"session-1"'),
      'utf8',
    )
  })

  it('does not throw when the best-effort index write fails', async () => {
    vi.mocked(mkdir).mockRejectedValueOnce(new Error('permission denied'))

    await expect(
      appendSubagentRunRecord({
        runId: 'run-2',
        agent: 'writer',
        task: 'write',
        cwd: '/repo',
        sessionId: 'session-2',
        status: 'running',
        timestamp: '2026-01-01T00:00:00.000Z',
      }),
    ).resolves.toBeUndefined()

    expect(appendFile).not.toHaveBeenCalled()
  })
})
