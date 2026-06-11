import { Text } from '@earendil-works/pi-tui'
import { describe, expect, it } from 'vitest'
import { buildCouncilRenderCall, buildCouncilRenderResult } from '../render.js'

const theme = {
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
}

describe('buildCouncilRenderCall', () => {
  it('renders basic call with question', () => {
    const result = buildCouncilRenderCall(
      { question: 'Should we ship now?' },
      theme,
    )
    expect(result).toBeInstanceOf(Text)
  })

  it('renders call with context', () => {
    const result = buildCouncilRenderCall(
      { question: 'Should we ship?', context: 'Deadline is Friday' },
      theme,
    )
    expect(result).toBeInstanceOf(Text)
  })

  it('renders call with complexity', () => {
    const result = buildCouncilRenderCall(
      { question: 'Which path?', complexity: 'high' },
      theme,
    )
    expect(result).toBeInstanceOf(Text)
  })

  it('truncates long questions', () => {
    const longQuestion = 'A'.repeat(200)
    const result = buildCouncilRenderCall({ question: longQuestion }, theme)
    expect(result).toBeInstanceOf(Text)
  })
})

describe('buildCouncilRenderResult', () => {
  it('renders verdict when details contain valid council output', () => {
    const result = buildCouncilRenderResult(
      {
        content: [
          { type: 'text', text: '## Council Verdict\nRecommendation: ship' },
        ],
        details: {
          verdict: '## Council Verdict\nRecommendation: ship',
          voiceResults: [],
          error: undefined,
        },
      },
      false,
      theme,
    )
    expect(result).toBeInstanceOf(Text)
  })

  it('renders error when details contain error', () => {
    const result = buildCouncilRenderResult(
      {
        content: [{ type: 'text', text: 'Council error: All voices failed' }],
        details: {
          verdict: '',
          voiceResults: [],
          error: 'All voices failed',
        },
      },
      false,
      theme,
    )
    expect(result).toBeInstanceOf(Text)
  })

  it('renders expanded verdict', () => {
    const result = buildCouncilRenderResult(
      {
        content: [{ type: 'text', text: 'Full verdict text' }],
        details: {
          verdict: 'Full verdict text',
          voiceResults: [],
          error: undefined,
        },
      },
      true,
      theme,
    )
    expect(result).toBeInstanceOf(Text)
  })

  it('renders compact verdict with truncation for long output', () => {
    const longText = Array.from(
      { length: 20 },
      (_, index) => `Line ${index + 1}`,
    ).join('\n')
    const result = buildCouncilRenderResult(
      {
        content: [{ type: 'text', text: longText }],
        details: {
          verdict: longText,
          voiceResults: [],
          error: undefined,
        },
      },
      false,
      theme,
    )
    expect(result).toBeInstanceOf(Text)
  })

  it('renders no verdict placeholder for empty text', () => {
    const result = buildCouncilRenderResult(
      {
        content: [{ type: 'text', text: '' }],
        details: {
          verdict: '',
          voiceResults: [],
          error: undefined,
        },
      },
      false,
      theme,
    )
    expect(result).toBeInstanceOf(Text)
  })

  it('renders fallback for details without council output', () => {
    const result = buildCouncilRenderResult(
      {
        content: [{ type: 'text', text: 'some output' }],
        details: undefined,
      },
      false,
      theme,
    )
    expect(result).toBeInstanceOf(Text)
  })
})
