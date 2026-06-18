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
})
