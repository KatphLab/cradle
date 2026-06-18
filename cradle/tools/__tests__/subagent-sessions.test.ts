import { beforeEach, describe, expect, it, vi } from 'vitest'

import { listSubagentRunRecords } from '../../lib/subagents/run-index.js'
import { subagentSessionsTool } from '../subagent-sessions.js'

vi.mock('@earendil-works/pi-coding-agent', () => ({
  defineTool: vi.fn(
    <Definition>(definition: Definition): Definition => definition,
  ),
}))

vi.mock('@earendil-works/pi-tui', () => ({
  Text: vi.fn(function Text(this: { text: string }, text: string) {
    this.text = text
  }),
}))

vi.mock('../../lib/subagents/run-index.js', () => ({
  listSubagentRunRecords: vi.fn(),
}))

describe('subagentSessionsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists latest known subagent sessions with resume hints', async () => {
    vi.mocked(listSubagentRunRecords).mockResolvedValue([
      {
        runId: 'run-old',
        agent: 'builder',
        task: 'old task',
        cwd: '/repo',
        sessionId: 'session-1',
        status: 'running',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
      {
        runId: 'run-new',
        agent: 'builder',
        task: 'new task',
        cwd: '/repo',
        sessionId: 'session-1',
        status: 'succeeded',
        timestamp: '2026-01-01T01:00:00.000Z',
        sessionFile: '/sessions/session-1.jsonl',
      },
      {
        runId: 'run-other',
        agent: 'reviewer',
        task: 'review',
        cwd: '/repo',
        sessionId: 'session-2',
        status: 'failed',
        timestamp: '2026-01-01T02:00:00.000Z',
      },
    ])

    const result = await subagentSessionsTool.execute(
      'call-1',
      { agent: 'builder' },
      undefined,
      undefined,
      // @ts-expect-error context is unused
      {},
    )

    expect(result.details).toEqual({
      sessions: [
        expect.objectContaining({
          sessionId: 'session-1',
          task: 'new task',
          status: 'succeeded',
        }),
      ],
      total: 1,
    })
    const item = result.content[0]
    expect(item?.type).toBe('text')
    if (item?.type !== 'text') throw new TypeError('Expected text content')
    expect(item.text).toContain('subagent_resume')
    expect(item.text).toContain('session-1')
    expect(item.text).not.toContain('old task')
  })

  it('reports when no sessions are known', async () => {
    vi.mocked(listSubagentRunRecords).mockResolvedValue([])

    const result = await subagentSessionsTool.execute(
      'call-1',
      {},
      undefined,
      undefined,
      // @ts-expect-error context is unused
      {},
    )

    const item = result.content[0]
    expect(item?.type).toBe('text')
    if (item?.type !== 'text') throw new TypeError('Expected text content')
    expect(item.text).toContain('No known subagent sessions')
  })
})
