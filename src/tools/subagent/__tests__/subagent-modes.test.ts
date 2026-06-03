import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runSingleAgent } from '../../../subagents/runner.js'
import {
  handleChainMode,
  handleSingleMode,
  makeDetailsFactory,
  type UpdateCallback,
} from '../subagent-modes.js'
import {
  agents,
  assistantText,
  makeContext,
  makeResult,
  makeUpdate,
  noProjectAgentsDirectory,
} from '../subagent-modes.test-helpers.js'

vi.mock('../../../subagents/runner.js', () => ({
  runSingleAgent: vi.fn(),
}))

describe('handleSingleMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs a single agent with output', async () => {
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
        { agent: 'writer', task: 'write', complexity: 'low', cwd: '/work' },
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
        { agent: 'writer', task: 'silent', complexity: 'low' },
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
      { agent: 'writer', task: 'write', complexity: 'low' },
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

  it('runs chain steps sequentially', async () => {
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
          { agent: 'writer', task: 'draft', complexity: 'low', cwd: '/draft' },
          {
            agent: 'reviewer',
            task: 'review {previous}',
            complexity: 'low',
            cwd: '/review',
          },
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
          { agent: 'writer', task: 'draft', complexity: 'low' },
          { agent: 'reviewer', task: 'review {previous}', complexity: 'low' },
          { agent: 'writer', task: 'never runs', complexity: 'low' },
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
