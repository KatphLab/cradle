import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { loadCradleSettings } from '../../config/settings.js'
import { discoverAgents } from '../../lib/subagents/agents.js'
import { runSingleAgent } from '../../lib/subagents/runner.js'
import type { AgentConfig, SingleResult } from '../../lib/subagents/types.js'
import { subagentResumeTool } from '../subagent-resume.js'

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

vi.mock('../../config/settings.js', () => ({
  getToolOutputMode: vi.fn(() => 'preview'),
  loadCradleSettings: vi.fn(),
}))

vi.mock('../../lib/subagents/agents.js', () => ({
  discoverAgents: vi.fn(),
}))

vi.mock('../../lib/subagents/runner.js', () => ({
  runSingleAgent: vi.fn(),
}))

function makeAgent(): AgentConfig {
  return {
    name: 'builder',
    description: 'Builds code',
    filePath: '/agents/builder.md',
    source: 'project',
    systemPrompt: 'Build carefully.',
  }
}

function makeResult(overrides: Partial<SingleResult> = {}): SingleResult {
  return {
    agent: 'builder',
    agentSource: 'project',
    task: 'continue',
    exitCode: 0,
    messages: [],
    stderr: '',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: 0,
      turns: 0,
    },
    session: {
      id: 'session-1',
      mode: 'resume',
      cwd: '/repo',
      inspectCommand: 'pi --session session-1',
      continueHint:
        'Call subagent_resume with agent "builder" and sessionId "session-1".',
    },
    ...overrides,
  }
}

function makeContext(): ExtensionContext {
  return {
    cwd: '/repo',
    hasUI: false,
    // @ts-expect-error minimal UI mock
    ui: { confirm: vi.fn() },
  }
}

describe('subagentResumeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(discoverAgents).mockReturnValue({
      agents: [makeAgent()],
      projectAgentsDir: '/repo/cradle/agents',
    })
    vi.mocked(loadCradleSettings).mockResolvedValue({})
    vi.mocked(runSingleAgent).mockResolvedValue(makeResult())
  })

  it('resumes an existing subagent session with the dedicated session id parameter', async () => {
    const signal = new AbortController().signal

    const result = await subagentResumeTool.execute(
      'call-1',
      {
        agent: 'builder',
        task: 'continue investigation',
        sessionId: 'session-1',
        cwd: '/repo',
      },
      signal,
      undefined,
      makeContext(),
    )

    expect(result.details).toMatchObject({
      mode: 'single',
      projectAgentsDir: '/repo/cradle/agents',
      results: [
        expect.objectContaining({
          session: expect.objectContaining({ mode: 'resume' }),
        }),
      ],
    })
    expect(runSingleAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentName: 'builder',
        task: 'continue investigation',
        cwd: '/repo',
        sessionId: 'session-1',
        complexity: undefined,
        signal,
      }),
    )
  })

  it('renders resume calls with the target session id', () => {
    const rendered = subagentResumeTool.renderCall?.(
      { agent: 'builder', task: 'continue', sessionId: 'session-1' },
      // @ts-expect-error minimal theme mock
      {
        bold: (text: string) => text,
        fg: (_color: string, text: string) => text,
      },
      {},
    ) as unknown as { text: string }

    expect(rendered.text).toContain('subagent resume builder (session-1)')
  })

  it('returns no-output text for successful resumes without messages', async () => {
    vi.mocked(runSingleAgent).mockResolvedValue(makeResult())

    const result = await subagentResumeTool.execute(
      'call-1',
      { agent: 'builder', task: 'continue', sessionId: 'session-1' },
      new AbortController().signal,
      undefined,
      makeContext(),
    )

    expect(result.content).toEqual([{ type: 'text', text: '(no output)' }])
    expect(Object.hasOwn(result, 'isError')).toBe(false)
  })

  it('returns failed resume output as an error result', async () => {
    vi.mocked(runSingleAgent).mockResolvedValue(
      makeResult({ exitCode: 1, stderr: 'boom', stopReason: 'error' }),
    )

    const result = await subagentResumeTool.execute(
      'call-1',
      { agent: 'builder', task: 'continue', sessionId: 'session-1' },
      new AbortController().signal,
      undefined,
      makeContext(),
    )

    expect('isError' in result && result.isError).toBe(true)
    const item = result.content[0]
    expect(item?.type).toBe('text')
    if (item?.type !== 'text') throw new TypeError('Expected text content')
    expect(item.text).toContain('Agent error: boom')
  })

  it('forwards partial updates with subagent resume details', async () => {
    const onUpdate = vi.fn()
    vi.mocked(runSingleAgent).mockImplementation((options) => {
      options.onUpdate?.({
        content: [{ type: 'text', text: 'partial' }],
        details: {
          mode: 'single',
          projectAgentsDir: '/repo/cradle/agents',
          results: [makeResult()],
        },
      })
      return Promise.resolve(makeResult())
    })

    await subagentResumeTool.execute(
      'call-1',
      { agent: 'builder', task: 'continue', sessionId: 'session-1' },
      new AbortController().signal,
      onUpdate,
      makeContext(),
    )

    expect(onUpdate).toHaveBeenCalledWith({
      content: [{ type: 'text', text: 'partial' }],
      details: {
        mode: 'single',
        projectAgentsDir: '/repo/cradle/agents',
        results: [expect.objectContaining({ agent: 'builder' })],
      },
    })
  })

  it('renders resume results and fallback output', () => {
    const theme = {
      bold: (text: string) => text,
      fg: (_color: string, text: string) => text,
    }
    const rendered = subagentResumeTool.renderResult?.(
      {
        content: [{ type: 'text', text: 'done' }],
        details: {
          mode: 'single',
          projectAgentsDir: '/repo/cradle/agents',
          results: [makeResult()],
        },
      },
      { expanded: false, isPartial: false },
      theme as never,
      { isError: false } as never,
    ) as unknown as { text: string }
    const fallback = subagentResumeTool.renderResult?.(
      { content: [{ type: 'text', text: 'fallback' }], details: undefined },
      { expanded: false, isPartial: false },
      theme as never,
      { isError: false } as never,
    ) as unknown as { text: string }

    expect(rendered).toBeDefined()
    expect(fallback.text).toBe('fallback')
  })
})
