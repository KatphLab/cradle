import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { describe, expect, it, vi } from 'vitest'

import { renderWebSearchResult } from '../render.js'
import type { WebSearchDetails } from '../types.js'

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

function makeItem(
  index: number,
  overrides: Partial<WebSearchDetails['items'][number]> = {},
): WebSearchDetails['items'][number] {
  return {
    title: `Item ${String(index)}`,
    description: `Description for item ${String(index)}`,
    url: `https://example.com/${String(index)}`,
    ...overrides,
  }
}

function makeResult(
  details?: WebSearchDetails,
  text = 'search failed',
): AgentToolResult<WebSearchDetails | undefined> {
  return {
    content: [{ type: 'text', text }],
    details,
  }
}

describe('renderWebSearchResult', () => {
  it('renders collapsed results with truncation and remaining count', () => {
    const details: WebSearchDetails = {
      items: [makeItem(1), makeItem(2), makeItem(3), makeItem(4), makeItem(5)],
      query: 'test query',
      provider: 'firecrawl',
      resultCount: 5,
    }

    const rendered = renderWebSearchResult(makeResult(details), false, theme)
    const text = textOf(rendered)

    expect(text).toContain('<toolTitle><bold>web_search </bold></toolTitle>')
    expect(text).toContain('<accent>5 results</accent>')
    expect(text).toContain('1. Item 1')
    expect(text).toContain('2. Item 2')
    expect(text).toContain('3. Item 3')
    expect(text).toContain('<dim>  ... +2 more</dim>')
    expect(text).not.toContain('Item 5')
  })

  it('renders expanded results with all items and URLs', () => {
    const details: WebSearchDetails = {
      items: [
        makeItem(1, {
          title: 'First item',
          description: 'First description',
          url: 'https://example.com/1',
        }),
        makeItem(2, {
          title: 'Second item',
          description: 'Second description',
          url: 'https://example.com/2',
        }),
      ],
      query: 'test query',
      provider: 'firecrawl',
      resultCount: 2,
    }

    const rendered = renderWebSearchResult(makeResult(details), true, theme)
    const text = textOf(rendered)

    expect(text).toContain('<accent>2 results</accent>')
    expect(text).toContain(
      '<dim>────────────────────────────────────────</dim>',
    )
    expect(text).toContain('1. First item')
    expect(text).toContain('<dim>https://example.com/1</dim>')
    expect(text).toContain('First description')
    expect(text).toContain('2. Second item')
    expect(text).toContain('<dim>https://example.com/2</dim>')
    expect(text).toContain('Second description')
  })

  it('renders items with missing title as (no title)', () => {
    const details: WebSearchDetails = {
      items: [makeItem(1, { title: '', url: 'https://example.com/1' })],
      query: 'test',
      provider: 'firecrawl',
      resultCount: 1,
    }

    const rendered = renderWebSearchResult(makeResult(details), true, theme)
    const text = textOf(rendered)

    expect(text).toContain('(no title)')
  })

  it('renders items with missing URL as (no url)', () => {
    const details: WebSearchDetails = {
      items: [makeItem(1, { title: 'Titled', url: '' })],
      query: 'test',
      provider: 'firecrawl',
      resultCount: 1,
    }

    const rendered = renderWebSearchResult(makeResult(details), true, theme)
    const text = textOf(rendered)

    expect(text).toContain('(no url)')
  })

  it('renders error text when details absent', () => {
    const rendered = renderWebSearchResult(makeResult(), false, theme)
    expect(textOf(rendered)).toBe('search failed')
  })

  it('renders empty error when no text content', () => {
    const result: AgentToolResult<WebSearchDetails | undefined> = {
      content: [],
      details: undefined,
    }

    const rendered = renderWebSearchResult(result, false, theme)
    expect(textOf(rendered)).toBe('')
  })
})
