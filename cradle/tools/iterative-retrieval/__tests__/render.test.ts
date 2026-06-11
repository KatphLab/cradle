import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { describe, expect, it, vi } from 'vitest'

import { renderIterativeRetrievalResult } from '../render.js'
import type { IterativeRetrievalDetails } from '../types.js'

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

const theme = {
  bold: vi.fn((text: string) => `<bold>${text}</bold>`),
  fg: vi.fn((color: string, text: string) => `<${color}>${text}</${color}>`),
}

function isMockTextInstance(value: unknown): value is MockTextInstance {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'Text' &&
    'text' in value &&
    typeof value.text === 'string'
  )
}

function textOf(rendered: unknown): string {
  if (!isMockTextInstance(rendered)) {
    throw new TypeError('Expected rendered Text instance')
  }

  return rendered.text
}

function makeDetails(
  overrides: Partial<IterativeRetrievalDetails> = {},
): IterativeRetrievalDetails {
  return {
    task: 'test task',
    cycles: 2,
    paths: [
      { path: 'src/auth.ts', relevance: 0.9, reason: 'auth implementation' },
      { path: 'src/middleware.ts', relevance: 0.7, reason: 'middleware layer' },
    ],
    sources: [
      {
        path: 'https://example.com',
        relevance: 0.8,
        reason: 'relevant article',
      },
    ],
    findings: ['Uses JWT tokens'],
    gaps: [],
    suggestions: [],
    ...overrides,
  }
}

function makeResult(
  details?: IterativeRetrievalDetails,
  text = 'retrieval failed',
): AgentToolResult<IterativeRetrievalDetails | undefined> {
  return {
    content: [{ type: 'text', text }],
    details,
  }
}

describe('renderIterativeRetrievalResult', () => {
  it('renders collapsed results with paths and sources', () => {
    const details = makeDetails()
    const rendered = renderIterativeRetrievalResult(
      makeResult(details),
      false,
      theme,
    )
    const text = textOf(rendered)

    expect(text).toContain(
      '<toolTitle><bold>iterative_retrieval </bold></toolTitle>',
    )
    expect(text).toContain('<accent>3 results in 2 cycles</accent>')
    expect(text).toContain('1. src/auth.ts (0.9)')
    expect(text).toContain('2. src/middleware.ts (0.7)')
    expect(text).toContain('3. https://example.com (0.8)')
  })

  it('renders expanded results with reasons and gaps', () => {
    const details = makeDetails({
      gaps: ['Could not find deployment config'],
    })
    const rendered = renderIterativeRetrievalResult(
      makeResult(details),
      true,
      theme,
    )
    const text = textOf(rendered)

    expect(text).toContain('1. src/auth.ts')
    expect(text).toContain('<accent>0.9</accent>')
    expect(text).toContain('auth implementation')
    expect(text).toContain(
      '<dim>────────────────────────────────────────</dim>',
    )
    expect(text).toContain('<dim>Gaps:</dim>')
    expect(text).toContain('Could not find deployment config')
  })

  it('renders singular labels for single result and single cycle', () => {
    const details = makeDetails({
      cycles: 1,
      paths: [{ path: 'src/main.ts', relevance: 1, reason: 'entry point' }],
      sources: [],
    })
    const rendered = renderIterativeRetrievalResult(
      makeResult(details),
      false,
      theme,
    )
    const text = textOf(rendered)

    expect(text).toContain('<accent>1 result in 1 cycle</accent>')
  })

  it('renders error text when details absent', () => {
    const rendered = renderIterativeRetrievalResult(makeResult(), false, theme)
    expect(textOf(rendered)).toBe('retrieval failed')
  })

  it('renders empty error when no text content', () => {
    const result: AgentToolResult<IterativeRetrievalDetails | undefined> = {
      content: [],
      details: undefined,
    }

    const rendered = renderIterativeRetrievalResult(result, false, theme)
    expect(textOf(rendered)).toBe('')
  })
})
