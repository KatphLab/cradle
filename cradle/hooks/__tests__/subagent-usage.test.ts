import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it } from 'vitest'

import { registerSubagentUsageHook } from '../subagent-usage.js'

interface HandlerEntry {
  event: string
  fn: (...args: unknown[]) => unknown
}

interface UsageInput {
  input: number
  output: number
  cost: number
  cacheRead?: number
  cacheWrite?: number
}

interface UsageResult {
  message: { usage: Record<string, unknown> }
}

function createPi(): {
  pi: Pick<ExtensionAPI, 'on'>
  handlers: HandlerEntry[]
} {
  const handlers: HandlerEntry[] = []
  const pi: Pick<ExtensionAPI, 'on'> = {
    on: (event, handler) => {
      handlers.push({ event, fn: handler as (...args: unknown[]) => unknown })
    },
  }
  return { pi, handlers }
}

function findHandler(
  handlers: HandlerEntry[],
  event: string,
): (...args: unknown[]) => unknown {
  const entry = handlers.find((h) => h.event === event)
  if (!entry) throw new Error(`Handler not found: ${event}`)
  return entry.fn
}

function usageStats(input: UsageInput) {
  return {
    input: input.input,
    output: input.output,
    cacheRead: input.cacheRead ?? 0,
    cacheWrite: input.cacheWrite ?? 0,
    cost: input.cost,
    contextTokens: 0,
    turns: 1,
  }
}

function singleResult(input: UsageInput) {
  return {
    agent: 'test-agent',
    agentSource: 'user',
    task: 'test task',
    exitCode: 0,
    messages: [],
    stderr: '',
    usage: usageStats(input),
  }
}

function makeSubagentDetails(results: UsageInput[]) {
  return {
    mode: 'single',
    projectAgentsDir: undefined,
    results: results.map((input) => singleResult(input)),
  }
}

function makeCouncilDetails(voiceResults: UsageInput[]) {
  return {
    verdict: 'test verdict',
    voiceResults: voiceResults.map((input) => ({
      voice: 'test-voice',
      output: 'test output',
      result: singleResult(input),
      error: undefined,
    })),
    error: undefined,
  }
}

function makeAssistantMessage(
  input: number,
  output: number,
  totalTokens: number,
  costTotal: number,
  cacheRead = 0,
  cacheWrite = 0,
) {
  return {
    role: 'assistant',
    content: [],
    api: 'test',
    provider: 'test',
    model: 'test-model',
    usage: {
      input,
      output,
      cacheRead,
      cacheWrite,
      totalTokens,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: costTotal,
      },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  }
}

function makeToolResultEvent(toolName: string, details: unknown) {
  return {
    type: 'tool_result',
    toolName,
    toolCallId: '1',
    input: {},
    content: [],
    isError: false,
    details,
  }
}

async function runToolResultAndMessageEnd(
  handlers: HandlerEntry[],
  toolName: string,
  details: unknown,
  assistant: [number, number, number, number, number?, number?],
) {
  const toolResultHandler = findHandler(handlers, 'tool_result')
  const messageEndHandler = findHandler(handlers, 'message_end')

  await toolResultHandler(makeToolResultEvent(toolName, details), {})
  return messageEndHandler(
    { type: 'message_end', message: makeAssistantMessage(...assistant) },
    {},
  )
}

function expectUsage(
  result: unknown,
  expected: [number, number, number, number, number?, number?],
) {
  expect(result).toBeDefined()
  const { usage } = (result as UsageResult).message
  const [input, output, totalTokens, costTotal, cacheRead, cacheWrite] =
    expected
  expect(usage['input']).toBe(input)
  expect(usage['output']).toBe(output)
  expect(usage['totalTokens']).toBe(totalTokens)
  if (cacheRead !== undefined) expect(usage['cacheRead']).toBe(cacheRead)
  if (cacheWrite !== undefined) expect(usage['cacheWrite']).toBe(cacheWrite)
  const cost = usage['cost'] as Record<string, unknown>
  expect(cost['total']).toBeCloseTo(costTotal)
}

describe('registerSubagentUsageHook', () => {
  let handlers: HandlerEntry[]

  beforeEach(() => {
    const created = createPi()
    registerSubagentUsageHook(created.pi)
    handlers = created.handlers
    findHandler(handlers, 'session_start')({}, {})
  })

  it('resets pending usage on session_start', async () => {
    const toolResultHandler = findHandler(handlers, 'tool_result')
    const messageEndHandler = findHandler(handlers, 'message_end')

    await toolResultHandler(
      makeToolResultEvent(
        'subagent',
        makeSubagentDetails([{ input: 100, output: 50, cost: 0.01 }]),
      ),
      {},
    )

    findHandler(handlers, 'session_start')({}, {})

    const result = await messageEndHandler(
      {
        type: 'message_end',
        message: makeAssistantMessage(200, 100, 300, 0.02),
      },
      {},
    )
    expect(result).toBeUndefined()
  })

  it('injects usage from single subagent result', async () => {
    const result = await runToolResultAndMessageEnd(
      handlers,
      'subagent',
      makeSubagentDetails([{ input: 100, output: 50, cost: 0.01 }]),
      [200, 100, 300, 0.02, 10, 5],
    )
    expectUsage(result, [300, 150, 450, 0.03, 10, 5])
  })

  it('aggregates usage from multiple subagent results', async () => {
    const result = await runToolResultAndMessageEnd(
      handlers,
      'subagent',
      makeSubagentDetails([
        { input: 100, output: 50, cost: 0.01 },
        { input: 200, output: 80, cost: 0.02 },
      ]),
      [500, 200, 700, 0.05],
    )
    expectUsage(result, [800, 330, 1130, 0.08])
  })

  it('injects usage from advisor result', async () => {
    const result = await runToolResultAndMessageEnd(
      handlers,
      'advisor',
      makeSubagentDetails([{ input: 150, output: 75, cost: 0.03 }]),
      [300, 150, 450, 0.04],
    )
    expectUsage(result, [450, 225, 675, 0.07])
  })

  it('injects usage from council voice results', async () => {
    const result = await runToolResultAndMessageEnd(
      handlers,
      'council',
      makeCouncilDetails([
        { input: 100, output: 50, cost: 0.01 },
        { input: 120, output: 60, cost: 0.015 },
        { input: 80, output: 40, cost: 0.008 },
        { input: 90, output: 45, cost: 0.012 },
      ]),
      [400, 200, 600, 0.05],
    )
    expectUsage(result, [790, 395, 1185, 0.095])
  })

  it('injects usage from iterative retrieval details', async () => {
    const result = await runToolResultAndMessageEnd(
      handlers,
      'iterative_retrieval',
      {
        task: 'test',
        cycles: 2,
        paths: [],
        sources: [],
        findings: [],
        gaps: [],
        suggestions: [],
        usage: usageStats({ input: 250, output: 120, cost: 0.04 }),
      },
      [500, 250, 750, 0.06],
    )
    expectUsage(result, [750, 370, 1120, 0.1])
  })

  it('handles iterative retrieval details without usage', async () => {
    const result = await runToolResultAndMessageEnd(
      handlers,
      'iterative_retrieval',
      {
        task: 'test',
        cycles: 1,
        paths: [],
        sources: [],
        findings: [],
        gaps: [],
        suggestions: [],
      },
      [100, 50, 150, 0.01],
    )
    expect(result).toBeUndefined()
  })

  it('accumulates usage from multiple tools before injecting', async () => {
    const toolResultHandler = findHandler(handlers, 'tool_result')
    const messageEndHandler = findHandler(handlers, 'message_end')

    await toolResultHandler(
      makeToolResultEvent(
        'subagent',
        makeSubagentDetails([{ input: 100, output: 50, cost: 0.01 }]),
      ),
      {},
    )
    await toolResultHandler(
      makeToolResultEvent(
        'advisor',
        makeSubagentDetails([{ input: 200, output: 80, cost: 0.02 }]),
      ),
      {},
    )

    const result = await messageEndHandler(
      {
        type: 'message_end',
        message: makeAssistantMessage(500, 200, 700, 0.05),
      },
      {},
    )
    expectUsage(result, [800, 330, 1130, 0.08])
  })

  it('clears pending usage after injection', async () => {
    const toolResultHandler = findHandler(handlers, 'tool_result')
    const messageEndHandler = findHandler(handlers, 'message_end')

    await toolResultHandler(
      makeToolResultEvent(
        'subagent',
        makeSubagentDetails([{ input: 100, output: 50, cost: 0.01 }]),
      ),
      {},
    )

    const result1 = await messageEndHandler(
      {
        type: 'message_end',
        message: makeAssistantMessage(200, 100, 300, 0.02),
      },
      {},
    )
    expect(result1).toBeDefined()

    const result2 = await messageEndHandler(
      {
        type: 'message_end',
        message: makeAssistantMessage(400, 200, 600, 0.04),
      },
      {},
    )
    expect(result2).toBeUndefined()
  })

  it('ignores non-subagent tool results', async () => {
    const result = await runToolResultAndMessageEnd(
      handlers,
      'bash',
      {},
      [100, 50, 150, 0.01],
    )
    expect(result).toBeUndefined()
  })

  it('ignores non-assistant messages', async () => {
    const toolResultHandler = findHandler(handlers, 'tool_result')
    const messageEndHandler = findHandler(handlers, 'message_end')

    await toolResultHandler(
      makeToolResultEvent(
        'subagent',
        makeSubagentDetails([{ input: 100, output: 50, cost: 0.01 }]),
      ),
      {},
    )

    const result = await messageEndHandler(
      {
        type: 'message_end',
        message: { role: 'user', content: 'test', timestamp: Date.now() },
      },
      {},
    )
    expect(result).toBeUndefined()
  })

  it('ignores invalid details', async () => {
    const invalidSubagentResult = await runToolResultAndMessageEnd(
      handlers,
      'subagent',
      { invalid: 'shape' },
      [100, 50, 150, 0.01],
    )
    expect(invalidSubagentResult).toBeUndefined()

    const invalidCouncilResult = await runToolResultAndMessageEnd(
      handlers,
      'council',
      { verdict: '', voiceResults: 'not-array' },
      [100, 50, 150, 0.01],
    )
    expect(invalidCouncilResult).toBeUndefined()
  })

  it('adds subagent cache tokens to original', async () => {
    const result = await runToolResultAndMessageEnd(
      handlers,
      'subagent',
      makeSubagentDetails([
        {
          input: 100,
          output: 50,
          cacheRead: 30,
          cacheWrite: 10,
          cost: 0.01,
        },
      ]),
      [200, 100, 300, 0.02, 20, 5],
    )
    expectUsage(result, [300, 150, 450, 0.03, 50, 15])
  })
})
