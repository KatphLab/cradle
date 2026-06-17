import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runSingleAgent } from '../../../lib/subagents/runner.js'
import { MAX_PARALLEL_TASKS } from '../../../lib/subagents/utilities.js'
import {
  handleParallelMode,
  makeDetailsFactory,
  type ParallelModeParameters,
  type UpdateCallback,
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

vi.mock('../../../lib/subagents/runner.js', () => ({
  runSingleAgent: vi.fn(),
}))

describe('handleParallelMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws for missing parallel tasks and rejects oversized batches without running agents', async () => {
    const makeDetails = makeDetailsFactory(noProjectAgentsDirectory())

    await expect(
      handleParallelMode(
        {} as ParallelModeParameters,
        makeContext(),
        agents,
        undefined,
        undefined,
        makeDetails,
      ),
    ).rejects.toThrow()
    await expect(
      handleParallelMode(
        { tasks: [] },
        makeContext(),
        agents,
        undefined,
        undefined,
        makeDetails,
      ),
    ).rejects.toThrow('Missing tasks in parallel mode')

    const tooManyTasks = Array.from(
      { length: MAX_PARALLEL_TASKS + 1 },
      (_, index) => ({
        agent: 'writer',
        task: `task ${index}`,
        complexity: 'low' as const,
      }),
    )
    const response = await handleParallelMode(
      { tasks: tooManyTasks },
      makeContext(),
      agents,
      undefined,
      undefined,
      makeDetails,
    )

    expect(response).toMatchObject({
      content: [
        {
          type: 'text',
          text: `Too many parallel tasks (${MAX_PARALLEL_TASKS + 1}). Max is ${MAX_PARALLEL_TASKS}.`,
        },
      ],
      details: { mode: 'parallel', results: [] },
    })
    expect(runSingleAgent).not.toHaveBeenCalled()
  })

  it('runs parallel tasks, emits progress, and summarizes successful and failed statuses', async () => {
    const success = makeResult({
      agent: 'writer',
      task: 'write',
      messages: [assistantText('written')],
    })
    const failed = makeResult({
      agent: 'reviewer',
      task: 'review',
      exitCode: 1,
      stderr: 'bad review',
      messages: [],
    })
    const aborted = makeResult({
      agent: 'repo-agent',
      agentSource: 'project',
      task: 'inspect',
      exitCode: 0,
      stopReason: 'aborted',
      errorMessage: 'aborted by signal',
      messages: [],
    })
    const results = [success, failed, aborted]
    const onUpdate = vi.fn() as UpdateCallback

    vi.mocked(runSingleAgent).mockImplementation((options) => {
      const index = results.findIndex(
        (result) => result.agent === options.agentName,
      )
      const result = results[index]
      options.onUpdate?.(
        makeUpdate(
          makeResult({
            agent: options.agentName,
            task: options.task,
            exitCode: -1,
            messages: [assistantText('working')],
          }),
        ),
      )
      if (!result) throw new Error('unexpected agent')
      return Promise.resolve(result)
    })

    const response = await handleParallelMode(
      {
        tasks: [
          { agent: 'writer', task: 'write', complexity: 'low', cwd: '/one' },
          { agent: 'reviewer', task: 'review', complexity: 'low', cwd: '/two' },
          {
            agent: 'repo-agent',
            task: 'inspect',
            complexity: 'low',
            cwd: '/three',
          },
        ],
      },
      makeContext(),
      agents,
      undefined,
      onUpdate,
      makeDetailsFactory(discovery.projectAgentsDir),
    )

    expect(response.details).toEqual({
      mode: 'parallel',
      projectAgentsDir: discovery.projectAgentsDir,
      results,
    })
    const first = response.content[0]
    if (first?.type !== 'text') {
      throw new Error('Expected text content at index 0')
    }
    expect(first.text).toContain('Parallel: 1/3 succeeded')
    expect(first.text).toContain('### [writer] completed\n\nwritten')
    expect(first.text).toContain('### [reviewer] failed\n\nbad review')
    expect(first.text).toContain(
      '### [repo-agent] failed (aborted)\n\naborted by signal',
    )
    expect(runSingleAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentName: 'writer',
        task: 'write',
        cwd: '/one',
        sessionId: undefined,
        step: undefined,
      }),
    )
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        content: [
          expect.objectContaining({
            text: expect.stringMatching(
              /^Parallel: \d\/3 done, \d running\.\.\.$/,
            ),
          }),
        ],
        details: expect.objectContaining({ mode: 'parallel', results: [] }),
      }),
    )
  })
})
