import { beforeEach, describe, expect, it, vi } from 'vitest'

import { formatAgentList } from '../../subagents/agents.js'
import { runSingleAgent } from '../../subagents/runner.js'
import type { AgentConfig } from '../../subagents/types.js'
import {
  buildNoModeResponse,
  buildValidationErrorResponse,
  handleChainMode,
  handleSingleMode,
  makeDetailsFactory,
  type UpdateCallback,
  validateModeCount,
} from '../subagent-modes.js'
import {
  agents,
  assistantText,
  discovery,
  makeContext,
  makeResult,
  makeUpdate,
  noProjectAgentsDirectory,
} from '../subagent-modes.test-helpers.js'

vi.mock('../../subagents/agents.js', () => ({
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

vi.mock('../../subagents/runner.js', () => ({
  runSingleAgent: vi.fn(),
}))

describe('subagent mode validation and responses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('validates mode counts and builds response payloads with available agents', () => {
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

    const result = makeResult({ agent: 'writer' })
    const makeDetails = makeDetailsFactory(discovery.projectAgentsDir)

    expect(makeDetails('parallel')([result])).toEqual({
      mode: 'parallel',
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
    expect(buildNoModeResponse(agents, makeDetails).content[0]).toEqual({
      type: 'text',
      text: 'Invalid parameters. Available agents: writer (user), reviewer (user), repo-agent (project)',
    })
    expect(formatAgentList).toHaveBeenCalledWith(agents, 10)
  })
})

describe('handleSingleMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when missing fields and runs a single agent with output', async () => {
    const makeDetails = makeDetailsFactory(noProjectAgentsDirectory())

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

    const projectDetails = makeDetailsFactory('/repo/.pi/agents')
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
        projectDetails,
      ),
    ).resolves.toMatchObject({
      content: [{ type: 'text', text: 'final output' }],
      details: { mode: 'single' },
    })
    await expect(
      handleSingleMode(
        { agent: 'writer', task: 'silent' },
        makeContext(),
        agents,
        undefined,
        undefined,
        projectDetails,
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
      makeDetailsFactory(noProjectAgentsDirectory()),
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

  it('throws when chain mode has no steps and runs steps sequentially', async () => {
    const makeDetails = makeDetailsFactory(noProjectAgentsDirectory())

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
      makeDetailsFactory('/repo/.pi/agents'),
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
      makeDetailsFactory(noProjectAgentsDirectory()),
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
