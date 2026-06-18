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

  it('filters by cwd, clamps limits, and reports omitted sessions', async () => {
    vi.mocked(listSubagentRunRecords).mockResolvedValue([
      {
        runId: 'run-1',
        agent: 'builder',
        task: 'one',
        cwd: '/repo',
        sessionId: 'session-1',
        status: 'running',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
      {
        runId: 'run-2',
        agent: 'builder',
        task: 'two',
        cwd: '/repo',
        sessionId: 'session-2',
        status: 'succeeded',
        timestamp: '2026-01-01T01:00:00.000Z',
      },
      {
        runId: 'run-3',
        agent: 'builder',
        task: 'three',
        cwd: '/other',
        sessionId: 'session-3',
        status: 'failed',
        timestamp: '2026-01-01T02:00:00.000Z',
      },
    ])

    const result = await subagentSessionsTool.execute(
      'call-1',
      { cwd: '/repo', limit: 1.9 },
      undefined,
      undefined,
      // @ts-expect-error context is unused
      {},
    )

    expect(result.details.total).toBe(2)
    expect(result.details.sessions).toHaveLength(1)
    const item = result.content[0]
    expect(item?.type).toBe('text')
    if (item?.type !== 'text') throw new TypeError('Expected text content')
    expect(item.text).toContain('1/2 shown')
    expect(item.text).toContain('... 1 more omitted')
    expect(item.text).not.toContain('session-3')
  })

  it('uses default and minimum limits for invalid parameters', async () => {
    vi.mocked(listSubagentRunRecords).mockResolvedValue([
      {
        runId: 'run-1',
        agent: 'builder',
        task: 'one',
        cwd: '/repo',
        sessionId: 'session-1',
        status: 'running',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    ])

    const invalidLimit = await subagentSessionsTool.execute(
      'call-1',
      { limit: Number.NaN },
      undefined,
      undefined,
      // @ts-expect-error context is unused
      {},
    )
    const minimumLimit = await subagentSessionsTool.execute(
      'call-2',
      { limit: -5 },
      undefined,
      undefined,
      // @ts-expect-error context is unused
      {},
    )

    expect(invalidLimit.details.sessions).toHaveLength(1)
    expect(minimumLimit.details.sessions).toHaveLength(1)
  })

  it('renders calls with and without filters', () => {
    const theme = {
      bold: (text: string) => text,
      fg: (_color: string, text: string) => text,
    }
    const filtered = subagentSessionsTool.renderCall?.(
      { agent: 'builder', cwd: '/repo' },
      // @ts-expect-error minimal theme mock
      theme,
      {},
    ) as unknown as { text: string }
    const unfiltered = subagentSessionsTool.renderCall?.(
      {},
      // @ts-expect-error minimal theme mock
      theme,
      {},
    ) as unknown as { text: string }

    expect(filtered.text).toContain('agent=builder cwd=/repo')
    expect(unfiltered.text).toBe('subagent sessions')
  })
})
