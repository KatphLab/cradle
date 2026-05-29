import { beforeEach, describe, expect, it, vi } from 'vitest'

import { formatAgentList } from '../subagents/agents.js'
import { runSingleAgent } from '../subagents/runner.js'
import type { AgentConfig } from '../subagents/types.js'
import {
  buildCanceledResponse,
  buildNoModeResponse,
  buildValidationErrorResponse,
  handleChainMode,
  handleSingleMode,
  makeDetailsFactory,
  requestProjectAgentApproval,
  type SubagentParametersType,
  type UpdateCallback,
  validateModeCount,
} from './subagent-modes.js'
import {
  agents,
  assistantText,
  discovery,
  makeContext,
  makeResult,
  makeUpdate,
  noProjectAgentsDirectory,
} from './subagent-modes.test-helpers.js'

vi.mock('../subagents/agents.js', () => ({
  formatAgentList: vi.fn((agents: AgentConfig[], maxItems: number) => {
    const listed = agents.slice(0, maxItems)
    return {
      text:
        listed.length === 0
          ? 'none'
          : listed.map((agent) => `${agent.name} (${agent.source})`).join(', '),
      remaining: agents.length - listed.length,
    }
  }),
}))

vi.mock('../subagents/runner.js', () => ({
  runSingleAgent: vi.fn(),
}))

describe('subagent mode validation and responses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts exactly one populated mode and rejects none, incomplete, empty, or multiple modes', () => {
    const invalid = 'Invalid parameters. Provide exactly one mode.'

    expect(
      validateModeCount({ agent: 'writer', task: 'write' }),
    ).toBeUndefined()
    expect(
      validateModeCount({ tasks: [{ agent: 'writer', task: 'write' }] }),
    ).toBeUndefined()
    expect(
      validateModeCount({ chain: [{ agent: 'writer', task: 'write' }] }),
    ).toBeUndefined()

    expect(validateModeCount({})).toBe(invalid)
    expect(validateModeCount({ agent: 'writer' })).toBe(invalid)
    expect(validateModeCount({ task: 'write' })).toBe(invalid)
    expect(validateModeCount({ tasks: [] })).toBe(invalid)
    expect(validateModeCount({ chain: [] })).toBe(invalid)
    expect(
      validateModeCount({
        agent: 'writer',
        task: 'write',
        chain: [{ agent: 'reviewer', task: 'review' }],
      }),
    ).toBe(invalid)
    expect(
      validateModeCount({
        tasks: [{ agent: 'writer', task: 'write' }],
        chain: [{ agent: 'reviewer', task: 'review' }],
      }),
    ).toBe(invalid)
  })

  it('builds details and simple response payloads with available agent lists', () => {
    const result = makeResult({ agent: 'writer' })
    const makeDetails = makeDetailsFactory('both', discovery.projectAgentsDir)

    expect(makeDetails('parallel')([result])).toEqual({
      mode: 'parallel',
      agentScope: 'both',
      projectAgentsDir: '/repo/.pi/agents',
      results: [result],
    })

    expect(
      buildValidationErrorResponse('Bad request', agents, makeDetails)
        .content[0],
    ).toEqual({
      type: 'text',
      text: 'Bad request\nAvailable agents: writer (user), reviewer (user), repo-agent (project)',
    })
    expect(buildCanceledResponse(makeDetails).content[0]).toEqual({
      type: 'text',
      text: 'Canceled: project-local agents not approved.',
    })
    expect(buildNoModeResponse(agents, makeDetails).content[0]).toEqual({
      type: 'text',
      text: 'Invalid parameters. Available agents: writer (user), reviewer (user), repo-agent (project)',
    })
    expect(formatAgentList).toHaveBeenCalledWith(agents, 10)
  })
})

describe('requestProjectAgentApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not prompt when requested agents are not project-local', async () => {
    const confirm = vi.fn().mockResolvedValue(false)

    await expect(
      requestProjectAgentApproval(
        { agent: 'writer', task: 'write' },
        agents,
        makeContext({ ui: { confirm } }),
        discovery,
      ),
    ).resolves.toBe(true)

    expect(confirm).not.toHaveBeenCalled()
  })

  it('prompts once for project agents requested across single, parallel, and chain data', async () => {
    const confirm = vi.fn().mockResolvedValue(false)
    const parameters: SubagentParametersType = {
      agent: 'repo-agent',
      task: 'inspect',
      tasks: [
        { agent: 'repo-agent', task: 'parallel inspect' },
        { agent: 'writer', task: 'write' },
      ],
      chain: [
        { agent: 'writer', task: 'draft' },
        { agent: 'repo-agent', task: 'check {previous}' },
      ],
    }

    await expect(
      requestProjectAgentApproval(
        parameters,
        agents,
        makeContext({ ui: { confirm } }),
        { agents, projectAgentsDir: noProjectAgentsDirectory() },
      ),
    ).resolves.toBe(false)

    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm).toHaveBeenCalledWith(
      'Run project-local agents?',
      'Agents: repo-agent\nSource: (unknown)\n\nProject agents are repo-controlled. Only continue for trusted repositories.',
    )
  })
})

describe('handleSingleMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when single mode is missing its agent or task', async () => {
    const makeDetails = makeDetailsFactory('user', noProjectAgentsDirectory())

    await expect(
      handleSingleMode(
        { task: 'write' },
        makeContext(),
        agents,
        undefined,
        undefined,
        makeDetails,
      ),
    ).rejects.toThrow('Missing agent or task in single mode')
    await expect(
      handleSingleMode(
        { agent: 'writer' },
        makeContext(),
        agents,
        undefined,
        undefined,
        makeDetails,
      ),
    ).rejects.toThrow('Missing agent or task in single mode')
  })

  it('runs a single agent and returns final assistant output or a no-output placeholder', async () => {
    const makeDetails = makeDetailsFactory('project', '/repo/.pi/agents')
    const signal = new AbortController().signal
    const onUpdate = vi.fn() as UpdateCallback
    vi.mocked(runSingleAgent)
      .mockResolvedValueOnce(
        makeResult({ messages: [assistantText('final output')] }),
      )
      .mockResolvedValueOnce(makeResult({ messages: [] }))

    await expect(
      handleSingleMode(
        { agent: 'writer', task: 'write', cwd: '/work' },
        makeContext(),
        agents,
        signal,
        onUpdate,
        makeDetails,
      ),
    ).resolves.toMatchObject({
      content: [{ type: 'text', text: 'final output' }],
      details: { mode: 'single', agentScope: 'project' },
    })
    await expect(
      handleSingleMode(
        { agent: 'writer', task: 'silent' },
        makeContext(),
        agents,
        undefined,
        undefined,
        makeDetails,
      ),
    ).resolves.toMatchObject({
      content: [{ type: 'text', text: '(no output)' }],
    })

    expect(runSingleAgent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        defaultCwd: '/repo',
        agents,
        agentName: 'writer',
        task: 'write',
        cwd: '/work',
        step: undefined,
        signal,
        onUpdate,
      }),
    )
  })

  it('marks failed single results as tool errors with the stop reason and error output', async () => {
    const failed = makeResult({
      exitCode: 1,
      stopReason: 'aborted',
      errorMessage: 'user canceled',
    })
    vi.mocked(runSingleAgent).mockResolvedValue(failed)

    const response = await handleSingleMode(
      { agent: 'writer', task: 'write' },
      makeContext(),
      agents,
      undefined,
      undefined,
      makeDetailsFactory('user', noProjectAgentsDirectory()),
    )

    expect(response).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Agent aborted: user canceled' }],
      details: { mode: 'single', results: [failed] },
    })
  })
})

describe('handleChainMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when chain mode has no steps', async () => {
    const makeDetails = makeDetailsFactory('user', noProjectAgentsDirectory())

    await expect(
      handleChainMode(
        {},
        makeContext(),
        agents,
        undefined,
        undefined,
        makeDetails,
      ),
    ).rejects.toThrow('Missing chain in chain mode')
    await expect(
      handleChainMode(
        { chain: [] },
        makeContext(),
        agents,
        undefined,
        undefined,
        makeDetails,
      ),
    ).rejects.toThrow('Missing chain in chain mode')
  })

  it('runs chain steps sequentially, replaces previous output, and wraps progress updates', async () => {
    const firstResult = makeResult({
      agent: 'writer',
      task: 'draft',
      messages: [assistantText('draft output')],
    })
    const partialSecond = makeResult({
      agent: 'reviewer',
      task: 'review draft output',
      messages: [assistantText('reviewing')],
    })
    const secondResult = makeResult({
      agent: 'reviewer',
      task: 'review draft output',
      messages: [assistantText('approved')],
    })
    const onUpdate = vi.fn() as UpdateCallback

    vi.mocked(runSingleAgent).mockImplementation((options) => {
      if (options.agentName === 'reviewer')
        options.onUpdate?.(makeUpdate(partialSecond))
      return Promise.resolve(
        options.agentName === 'writer' ? firstResult : secondResult,
      )
    })

    const response = await handleChainMode(
      {
        chain: [
          { agent: 'writer', task: 'draft', cwd: '/draft' },
          { agent: 'reviewer', task: 'review {previous}', cwd: '/review' },
        ],
      },
      makeContext(),
      agents,
      undefined,
      onUpdate,
      makeDetailsFactory('both', '/repo/.pi/agents'),
    )

    expect(response).toMatchObject({
      content: [{ type: 'text', text: 'approved' }],
      details: { mode: 'chain', results: [firstResult, secondResult] },
    })
    expect(runSingleAgent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        agentName: 'writer',
        task: 'draft',
        cwd: '/draft',
        step: 1,
      }),
    )
    expect(runSingleAgent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        agentName: 'reviewer',
        task: 'review draft output',
        cwd: '/review',
        step: 2,
      }),
    )
    expect(onUpdate).toHaveBeenCalledWith({
      content: [{ type: 'text', text: 'partial' }],
      details: expect.objectContaining({
        mode: 'chain',
        results: [firstResult, partialSecond],
      }),
    })
  })

  it('stops the chain at the first failed step and returns stderr when no error message exists', async () => {
    const firstResult = makeResult({
      messages: [assistantText('draft output')],
    })
    const failed = makeResult({
      agent: 'reviewer',
      exitCode: 1,
      stderr: 'review failed',
      messages: [],
    })
    vi.mocked(runSingleAgent)
      .mockResolvedValueOnce(firstResult)
      .mockResolvedValueOnce(failed)

    const response = await handleChainMode(
      {
        chain: [
          { agent: 'writer', task: 'draft' },
          { agent: 'reviewer', task: 'review {previous}' },
          { agent: 'writer', task: 'never runs' },
        ],
      },
      makeContext(),
      agents,
      undefined,
      undefined,
      makeDetailsFactory('user', noProjectAgentsDirectory()),
    )

    expect(response).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'Chain stopped at step 2 (reviewer): review failed',
        },
      ],
      details: { mode: 'chain', results: [firstResult, failed] },
    })
    expect(runSingleAgent).toHaveBeenCalledTimes(2)
  })
})
