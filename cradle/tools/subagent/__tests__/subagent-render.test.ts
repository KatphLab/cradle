import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildChainResultCollapsed,
  buildChainResultExpanded,
  buildParallelResultCollapsed,
  buildParallelResultExpanded,
  buildSingleResultCollapsed,
  buildSingleResultExpanded,
} from '../../../lib/subagents/render.js'
import type {
  SingleResult,
  SubagentDetails,
} from '../../../lib/subagents/types.js'
import { buildRenderCall, buildRenderResult } from '../subagent-render.js'

interface MockTextInstance {
  kind: 'Text'
  text: string
  x: number
  y: number
}

vi.mock('@earendil-works/pi-tui', () => ({
  Text: vi.fn(function Text(
    this: MockTextInstance,
    text: string,
    x: number,
    y: number,
  ) {
    this.kind = 'Text'
    this.text = text
    this.x = x
    this.y = y
  }),
}))

vi.mock('../../../lib/subagents/render.js', () => ({
  buildChainResultCollapsed: vi.fn((details: SubagentDetails) => ({
    kind: 'chain-collapsed',
    details,
  })),
  buildChainResultExpanded: vi.fn((details: SubagentDetails) => ({
    kind: 'chain-expanded',
    details,
  })),
  buildParallelResultCollapsed: vi.fn((details: SubagentDetails) => ({
    kind: 'parallel-collapsed',
    details,
  })),
  buildParallelResultExpanded: vi.fn((details: SubagentDetails) => ({
    kind: 'parallel-expanded',
    details,
  })),
  buildSingleResultCollapsed: vi.fn((result: SingleResult) => ({
    kind: 'single-collapsed',
    result,
  })),
  buildSingleResultExpanded: vi.fn((result: SingleResult) => ({
    kind: 'single-expanded',
    result,
  })),
}))

const theme = {
  bold: vi.fn((text: string) => `<bold>${text}</bold>`),
  fg: vi.fn((color: string, text: string) => `<${color}>${text}</${color}>`),
}

function isMockTextInstance(value: unknown): value is MockTextInstance {
  if (!(value instanceof Object)) {
    return false
  }

  if (
    !('kind' in value) ||
    !('text' in value) ||
    !('x' in value) ||
    !('y' in value)
  ) {
    return false
  }

  return (
    value.kind === 'Text' &&
    typeof value.text === 'string' &&
    typeof value.x === 'number' &&
    typeof value.y === 'number'
  )
}

function textOf(rendered: unknown): string {
  if (!isMockTextInstance(rendered)) {
    throw new TypeError('Expected rendered Text instance')
  }

  return rendered.text
}

function makeResult(overrides: Partial<SingleResult> = {}): SingleResult {
  return {
    agent: 'reviewer',
    agentSource: 'user',
    task: 'Review the implementation',
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
    ...overrides,
  }
}

function makeDetails(
  mode: SubagentDetails['mode'],
  results: SingleResult[] = [makeResult()],
): SubagentDetails {
  return {
    mode,
    projectAgentsDir: undefined,
    results,
  }
}

describe('buildRenderCall', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a single subagent call with defaults and missing fields', () => {
    const rendered = buildRenderCall(
      {
        agent: 'coder',
        task: 'Implement a focused unit test',
        complexity: 'low',
      },
      theme,
    )

    expect(rendered).toMatchObject({ kind: 'Text', x: 0, y: 0 })
    expect(textOf(rendered)).toContain(
      '<toolTitle><bold>subagent </bold></toolTitle>',
    )
    expect(textOf(rendered)).toContain('<accent>coder</accent>')
    expect(textOf(rendered)).toContain(
      '<dim>Implement a focused unit test</dim>',
    )

    const emptyRendered = buildRenderCall(
      { agent: 'unknown', task: '', complexity: 'low' },
      theme,
    )
    expect(textOf(emptyRendered)).toContain('<accent>unknown</accent>')
    expect(textOf(emptyRendered)).toContain('<dim></dim>')
  })

  it('renders chain mode with cleaned previous placeholder, truncation, and overflow count', () => {
    const rendered = buildRenderCall(
      {
        chain: [
          {
            agent: 'planner',
            task: 'Plan {previous} the work',
            complexity: 'low',
          },
          {
            agent: 'coder',
            task: 'Implement '.repeat(8),
            complexity: 'low',
          },
          { agent: 'reviewer', task: 'Review the result', complexity: 'low' },
          { agent: 'tester', task: 'Test the result', complexity: 'low' },
        ],
      },
      theme,
    )

    expect(textOf(rendered)).toContain('<accent>chain (4 steps)</accent>')
    expect(textOf(rendered)).toContain(
      '<muted>1.</muted><accent>planner</accent>',
    )
    expect(textOf(rendered)).toContain('<dim> Plan  the work</dim>')
    expect(textOf(rendered)).toContain(
      '<dim> Implement Implement Implement Implement ...</dim>',
    )
    expect(textOf(rendered)).toContain('<muted>... +1 more</muted>')
    expect(textOf(rendered)).not.toContain('{previous}')
    expect(textOf(rendered)).not.toContain(
      'tester</accent><dim> Test the result',
    )
  })

  it('renders parallel mode with task previews and overflow count', () => {
    const rendered = buildRenderCall(
      {
        tasks: [
          { agent: 'docs', task: 'Write documentation', complexity: 'low' },
          { agent: 'lint', task: 'Check '.repeat(9), complexity: 'low' },
          { agent: 'test', task: 'Run tests', complexity: 'low' },
          { agent: 'review', task: 'Review changes', complexity: 'low' },
        ],
      },
      theme,
    )

    expect(textOf(rendered)).toContain('<accent>parallel (4 tasks)</accent>')
    expect(textOf(rendered)).toContain(
      '<accent>docs</accent><dim> Write documentation</dim>',
    )
    expect(textOf(rendered)).toContain(
      '<accent>lint</accent><dim> Check Check Check Check Check Check Chec...</dim>',
    )
    expect(textOf(rendered)).toContain('<muted>... +1 more</muted>')
    expect(textOf(rendered)).not.toContain(
      'review</accent><dim> Review changes',
    )

    const preferChain = buildRenderCall(
      {
        agent: 'single',
        task: 'single task',
        complexity: 'low' as const,
        tasks: [
          {
            agent: 'parallel',
            task: 'parallel task',
            complexity: 'low' as const,
          },
        ],
        chain: [
          { agent: 'chain', task: 'chain task', complexity: 'low' as const },
        ],
      },
      theme,
    )

    expect(textOf(preferChain)).toContain('<accent>chain (1 steps)</accent>')
    expect(textOf(preferChain)).toContain(
      '<accent>chain</accent><dim> chain task</dim>',
    )
    expect(textOf(preferChain)).not.toContain('parallel task')
    expect(textOf(preferChain)).not.toContain('single task')
  })
})

describe('buildRenderResult', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders expanded and collapsed single, chain, and parallel results', () => {
    const singleResult = makeResult({ agent: 'coder' })
    const singleResultData = {
      content: [{ type: 'text', text: 'fallback' }],
      details: makeDetails('single', [singleResult]),
    } satisfies AgentToolResult<SubagentDetails>

    expect(buildRenderResult(singleResultData, true, theme)).toEqual({
      kind: 'single-expanded',
      result: singleResult,
    })
    expect(buildSingleResultExpanded).toHaveBeenCalledWith(singleResult, theme)
    expect(buildRenderResult(singleResultData, false, theme)).toEqual({
      kind: 'single-collapsed',
      result: singleResult,
    })
    expect(buildSingleResultCollapsed).toHaveBeenCalledWith(singleResult, theme)

    const chainDetails = makeDetails('chain', [makeResult({ step: 1 })])
    const chainResult = {
      content: [{ type: 'text', text: 'fallback' }],
      details: chainDetails,
    } satisfies AgentToolResult<SubagentDetails>

    expect(buildRenderResult(chainResult, true, theme)).toEqual({
      kind: 'chain-expanded',
      details: chainDetails,
    })
    expect(buildChainResultExpanded).toHaveBeenCalledWith(chainDetails, theme)
    expect(buildRenderResult(chainResult, false, theme)).toEqual({
      kind: 'chain-collapsed',
      details: chainDetails,
    })
    expect(buildChainResultCollapsed).toHaveBeenCalledWith(chainDetails, theme)

    const parallelDetails = makeDetails('parallel', [
      makeResult({ agent: 'tester' }),
    ])
    const parallelResult = {
      content: [{ type: 'text', text: 'fallback' }],
      details: parallelDetails,
    } satisfies AgentToolResult<SubagentDetails>

    expect(buildRenderResult(parallelResult, true, theme)).toEqual({
      kind: 'parallel-expanded',
      details: parallelDetails,
    })
    expect(buildParallelResultExpanded).toHaveBeenCalledWith(
      parallelDetails,
      theme,
    )
    expect(buildRenderResult(parallelResult, false, theme)).toEqual({
      kind: 'parallel-collapsed',
      details: parallelDetails,
    })
    expect(buildParallelResultCollapsed).toHaveBeenCalledWith(
      parallelDetails,
      theme,
    )
  })

  it('falls back when details are missing, empty, or unsupported', () => {
    const rendered = buildRenderResult(
      { content: [{ type: 'text', text: 'plain output' }], details: undefined },
      false,
      theme,
    )
    expect(rendered).toEqual({
      kind: 'Text',
      text: 'plain output',
      x: 0,
      y: 0,
    })
    expect(buildSingleResultCollapsed).not.toHaveBeenCalled()
    expect(buildChainResultCollapsed).not.toHaveBeenCalled()
    expect(buildParallelResultCollapsed).not.toHaveBeenCalled()

    expect(
      buildRenderResult({ content: [], details: undefined }, false, theme),
    ).toEqual({
      kind: 'Text',
      text: '(no output)',
      x: 0,
      y: 0,
    })
    expect(
      buildRenderResult(
        {
          content: [{ type: 'image', data: 'abc', mimeType: 'image/png' }],
          details: undefined,
        },
        false,
        theme,
      ),
    ).toEqual({ kind: 'Text', text: '(no output)', x: 0, y: 0 })

    const fallbackContent: AgentToolResult<unknown>['content'] = [
      { type: 'text', text: 'fallback output' },
    ]

    expect(
      buildRenderResult(
        { content: fallbackContent, details: { mode: 'single' } },
        false,
        theme,
      ),
    ).toEqual({ kind: 'Text', text: 'fallback output', x: 0, y: 0 })
    expect(
      buildRenderResult(
        { content: fallbackContent, details: makeDetails('single', []) },
        true,
        theme,
      ),
    ).toEqual({ kind: 'Text', text: 'fallback output', x: 0, y: 0 })
    expect(
      buildRenderResult(
        {
          content: fallbackContent,
          details: { ...makeDetails('single'), mode: 'unexpected' },
        },
        false,
        theme,
      ),
    ).toEqual({ kind: 'Text', text: 'fallback output', x: 0, y: 0 })
  })
})
