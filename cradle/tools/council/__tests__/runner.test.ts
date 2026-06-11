import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadCradleSettings } from '../../../config/settings.js'
import { runSingleAgent } from '../../../lib/subagents/runner.js'
import type { SingleResult } from '../../../lib/subagents/types.js'
import { runCouncil } from '../runner.js'

vi.mock('../../../lib/subagents/runner.js', async (importOriginal) => {
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

function makeVoiceResult(agentName: string, text: string): SingleResult {
  return {
    agent: agentName,
    agentSource: 'extension',
    exitCode: 0,
    messages: [
      {
        role: 'assistant',
        content: [{ type: 'text', text }],
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

function makeFailedResult(agentName: string): SingleResult {
  return {
    agent: agentName,
    agentSource: 'extension',
    exitCode: 1,
    messages: [],
    stderr: 'Agent failed',
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
    stopReason: 'error',
  }
}

describe('runCouncil', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('launches 4 voice agents and 1 synthesis agent', async () => {
    vi.mocked(loadCradleSettings).mockResolvedValue({
      subagentModels: { medium: 'test-model' },
    })

    let callCount = 0
    vi.mocked(runSingleAgent).mockImplementation(() => {
      callCount++
      if (callCount <= 4) {
        const names = [
          'council-architect',
          'council-skeptic',
          'council-pragmatist',
          'council-critic',
        ]
        return Promise.resolve(
          makeVoiceResult(
            names[callCount - 1] ?? 'unknown',
            `Voice ${callCount} response`,
          ),
        )
      }
      return Promise.resolve(
        makeVoiceResult('council-synthesis', '## Council\nConsensus: ship it'),
      )
    })

    const result = await runCouncil({
      question: 'Should we ship?',
      context: undefined,
      complexity: 'medium',
      cwd: '/repo',
      signal: undefined,
    })

    expect(result.error).toBeUndefined()
    expect(result.verdict).toBe('## Council\nConsensus: ship it')
    expect(result.voiceResults).toHaveLength(4)
    expect(runSingleAgent).toHaveBeenCalledTimes(5)
  })

  it('returns error when all voices fail', async () => {
    vi.mocked(loadCradleSettings).mockResolvedValue({
      subagentModels: { medium: 'test-model' },
    })

    vi.mocked(runSingleAgent).mockResolvedValue(
      makeFailedResult('council-architect'),
    )

    const result = await runCouncil({
      question: 'Hard question',
      context: undefined,
      complexity: 'medium',
      cwd: '/repo',
      signal: undefined,
    })

    expect(result.error).toContain('All council voices failed')
    expect(result.verdict).toBe('')
  })

  it('runs synthesis even when some voices fail', async () => {
    vi.mocked(loadCradleSettings).mockResolvedValue({
      subagentModels: { medium: 'test-model' },
    })

    let callCount = 0
    vi.mocked(runSingleAgent).mockImplementation(() => {
      callCount++
      if (callCount === 1)
        return Promise.resolve(makeFailedResult('council-architect'))
      if (callCount <= 4)
        return Promise.resolve(
          makeVoiceResult(`voice-${callCount}`, `Response ${callCount}`),
        )
      return Promise.resolve(
        makeVoiceResult('council-synthesis', 'Synthesis verdict'),
      )
    })

    const result = await runCouncil({
      question: 'Question',
      context: 'Some context',
      complexity: 'low',
      cwd: '/repo',
      signal: undefined,
    })

    expect(result.error).toBeUndefined()
    expect(result.verdict).toBe('Synthesis verdict')
    expect(result.voiceResults).toHaveLength(4)
    expect(runSingleAgent).toHaveBeenCalledTimes(5)
  })

  it('returns error when synthesis fails', async () => {
    vi.mocked(loadCradleSettings).mockResolvedValue({
      subagentModels: { high: 'test-model' },
    })

    let callCount = 0
    vi.mocked(runSingleAgent).mockImplementation(() => {
      callCount++
      if (callCount <= 4)
        return Promise.resolve(
          makeVoiceResult(`voice-${callCount}`, `Response ${callCount}`),
        )
      return Promise.resolve(makeFailedResult('council-synthesis'))
    })

    const result = await runCouncil({
      question: 'Question',
      context: undefined,
      complexity: 'high',
      cwd: '/repo',
      signal: undefined,
    })

    expect(result.error).toContain('Synthesis failed')
    expect(result.verdict).toBe('')
  })

  it('uses correct complexity for model selection', async () => {
    vi.mocked(loadCradleSettings).mockResolvedValue({
      subagentModels: { low: 'haiku', high: 'opus' },
    })

    vi.mocked(runSingleAgent).mockImplementation(() =>
      Promise.resolve(makeVoiceResult('test', 'response')),
    )

    await runCouncil({
      question: 'Q',
      context: undefined,
      complexity: 'low',
      cwd: '/repo',
      signal: undefined,
    })

    const firstCall = vi.mocked(runSingleAgent).mock.calls[0]
    if (firstCall === undefined) throw new Error('expected call')
    expect(firstCall[0].complexity).toBe('low')
  })

  it('builds correct voice user message', async () => {
    vi.mocked(loadCradleSettings).mockResolvedValue({
      subagentModels: { medium: 'model' },
    })

    vi.mocked(runSingleAgent).mockImplementation(() =>
      Promise.resolve(makeVoiceResult('test', 'response')),
    )

    await runCouncil({
      question: 'Ship or hold?',
      context: 'Deadline Friday',
      complexity: 'medium',
      cwd: '/repo',
      signal: undefined,
    })

    const firstCall = vi.mocked(runSingleAgent).mock.calls[0]
    if (firstCall === undefined) throw new Error('expected call')
    expect(firstCall[0].task).toContain('Ship or hold?')
    expect(firstCall[0].task).toContain('Deadline Friday')
  })

  it('returns error when synthesis throws', async () => {
    vi.mocked(loadCradleSettings).mockResolvedValue({
      subagentModels: { medium: 'test-model' },
    })

    let callCount = 0
    vi.mocked(runSingleAgent).mockImplementation(() => {
      callCount++
      if (callCount <= 4)
        return Promise.resolve(
          makeVoiceResult(`voice-${callCount}`, `Response ${callCount}`),
        )
      return Promise.reject(new Error('Synthesis exploded'))
    })

    const result = await runCouncil({
      question: 'Question',
      context: undefined,
      complexity: 'medium',
      cwd: '/repo',
      signal: undefined,
    })

    expect(result.error).toContain('Synthesis error')
    expect(result.verdict).toBe('')
  })
})
