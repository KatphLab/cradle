import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { describe, expect, it, vi } from 'vitest'

import { renderWebFetchResult } from '../render.js'
import type { WebFetchDetails } from '../types.js'

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
  overrides: Partial<WebFetchDetails['items'][number]> = {},
): WebFetchDetails['items'][number] {
  return {
    url: `https://example.com/${String(index)}`,
    provider: 'native',
    status: 200,
    contentType: 'text/plain',
    size: 1536,
    artifactPath: `/var/cache/${String(index)}.md`,
    metadataPath: `/var/cache/${String(index)}-metadata.json`,
    cacheStatus: 'refresh',
    urlHash: `hash${String(index)}`,
    ...overrides,
  }
}

function makeResult(
  details?: WebFetchDetails,
  text = 'error text',
): AgentToolResult<WebFetchDetails | undefined> {
  return {
    content: [{ type: 'text', text }],
    details,
  }
}

describe('renderWebFetchResult', () => {
  it('renders collapsed results with truncation and remaining count', () => {
    const details: WebFetchDetails = {
      mode: 'chain',
      items: [
        makeItem(1, { url: `https://example.com/${'long-'.repeat(20)}` }),
        makeItem(2, { cacheStatus: 'hit' }),
        makeItem(3),
        makeItem(4),
      ],
    }

    const rendered = renderWebFetchResult(makeResult(details), false, theme)
    const text = textOf(rendered)

    expect(text).toContain('<toolTitle><bold>web_fetch </bold></toolTitle>')
    expect(text).toContain('<accent>4 URLs fetched</accent>')
    expect(text).toContain('...')
    expect(text).toContain('<dim>  ... +1 more</dim>')
    expect(text).not.toContain('/var/cache/4.md')
  })

  it('renders expanded results with all items and cache status', () => {
    const details: WebFetchDetails = {
      mode: 'single',
      items: [makeItem(1, { size: 512, cacheStatus: 'hit' })],
    }

    const rendered = renderWebFetchResult(makeResult(details), true, theme)
    const text = textOf(rendered)

    expect(text).toContain('<accent>1 URL fetched</accent>')
    expect(text).toContain(
      '<dim>────────────────────────────────────────</dim>',
    )
    expect(text).toContain('https://example.com/1 → /var/cache/1.md')
    expect(text).toContain('(200 text/plain, 512.0 B)')
    expect(text).toContain('(cached)')
  })

  it('renders error item', () => {
    const details: WebFetchDetails = {
      mode: 'single',
      items: [makeItem(1, { cacheStatus: 'error' })],
    }

    const rendered = renderWebFetchResult(makeResult(details), true, theme)
    const text = textOf(rendered)

    expect(text).toContain('fetch failed')
  })

  it('renders error text when details are absent', () => {
    const rendered = renderWebFetchResult(makeResult(), false, theme)
    expect(textOf(rendered)).toBe('error text')
  })

  it('renders an empty error when no text content exists', () => {
    const result: AgentToolResult<WebFetchDetails | undefined> = {
      content: [],
      details: undefined,
    }

    const rendered = renderWebFetchResult(result, false, theme)
    expect(textOf(rendered)).toBe('')
  })
})
