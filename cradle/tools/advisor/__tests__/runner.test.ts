import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadCradleSettings } from '../../../config/settings.js'
import { runSingleAgent } from '../../../subagents/runner.js'
import type { SingleResult } from '../../../subagents/types.js'
import { runAdvisor } from '../runner.js'

vi.mock('../../../subagents/runner.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    runSingleAgent: vi.fn(),
  }
})

vi.mock('../../../config/settings.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    loadCradleSettings: vi.fn(),
    saveCradleSettings: vi.fn(),
    assertPermission: vi.fn(),
  }
})

function makeSingleResult(): SingleResult {
  return {
    agent: 'advisor',
    agentSource: 'extension',
    exitCode: 0,
    messages: [
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'advice' }],
        api: 'test',
        provider: 'test',
        model: 'test',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
        stopReason: 'stop',
        timestamp: 0,
      },
    ],
    stderr: '',
    task: 'test',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: 0,
      turns: 0,
    },
  }
}

describe('runAdvisor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when advisor model is not configured', async () => {
    vi.mocked(loadCradleSettings).mockResolvedValue({})

    await expect(
      runAdvisor({
        context: 'test',
        code: undefined,
        error: undefined,
        attempted: undefined,
        files: undefined,
        cwd: '/repo',
        signal: undefined,
        onUpdate: undefined,
      }),
    ).rejects.toThrow('Advisor model not configured')
  })

  it('calls runSingleAgent with correct args when model is configured', async () => {
    vi.mocked(loadCradleSettings).mockResolvedValue({
      advisorModel: 'gpt-4',
    })
    vi.mocked(runSingleAgent).mockResolvedValue(makeSingleResult())

    const result = await runAdvisor({
      context: 'I need help',
      code: undefined,
      error: undefined,
      attempted: undefined,
      files: undefined,
      cwd: '/repo',
      signal: undefined,
      onUpdate: undefined,
    })

    expect(result.output).toBe('advice')
    expect(runSingleAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentName: 'advisor',
        defaultCwd: '/repo',
      }),
    )
  })

  it('includes files in the message when provided', async () => {
    vi.mocked(loadCradleSettings).mockResolvedValue({
      advisorModel: 'gpt-4',
    })
    vi.mocked(runSingleAgent).mockResolvedValue(makeSingleResult())

    await runAdvisor({
      context: 'I need help',
      code: undefined,
      error: undefined,
      attempted: undefined,
      files: ['cradle/index.ts', 'cradle/lib.ts'],
      cwd: '/repo',
      signal: undefined,
      onUpdate: undefined,
    })

    expect(runSingleAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.stringContaining('Files to Examine'),
      }),
    )
    expect(runSingleAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.stringContaining('cradle/index.ts'),
      }),
    )
    expect(runSingleAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.stringContaining('cradle/lib.ts'),
      }),
    )
  })

  it('passes onUpdate and makeDetails to runSingleAgent', async () => {
    vi.mocked(loadCradleSettings).mockResolvedValue({
      advisorModel: 'gpt-4',
    })
    vi.mocked(runSingleAgent).mockImplementation((args) => {
      const singleResult = makeSingleResult()
      if (typeof args.makeDetails === 'function') {
        args.makeDetails([singleResult])
      }
      return Promise.resolve(singleResult)
    })

    const onUpdate = vi.fn()

    const result = await runAdvisor({
      context: 'I need help',
      code: undefined,
      error: undefined,
      attempted: undefined,
      files: undefined,
      cwd: '/repo',
      signal: undefined,
      onUpdate,
    })

    expect(result.output).toBe('advice')
    expect(runSingleAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        onUpdate: expect.any(Function),
      }),
    )
    expect(runSingleAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        makeDetails: expect.any(Function),
      }),
    )
  })
})
