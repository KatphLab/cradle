import { afterEach, describe, expect, it, vi } from 'vitest'

import { webFetchTool } from '../web-fetch.js'

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

const theme = {
  fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
  bold: (text: string) => `<bold>${text}</bold>`,
}

const signal = new AbortController().signal

function makeResponse(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  const { status = 200, headers = {} } = init
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain', ...headers },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('webFetchTool', () => {
  it('rejects non-http URLs', async () => {
    const result = await webFetchTool.execute(
      'test-call',
      { url: 'ftp://example.com' },
      signal,
      undefined,
      // @ts-expect-error minimal context mock
      {},
    )

    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Invalid URL'),
    })
  })

  it('fetches plain text content', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(makeResponse('hello world'))

    const result = await webFetchTool.execute(
      'test-call',
      { url: 'https://example.com' },
      signal,
      undefined,
      // @ts-expect-error minimal context mock
      {},
    )

    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: 'hello world',
    })
    expect(result.details).toMatchObject({
      url: 'https://example.com',
      status: 200,
      contentType: 'text/plain',
      size: 11,
    })
  })

  it('converts HTML to markdown', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse('<h1>Title</h1><p>Paragraph</p>', {
        headers: { 'content-type': 'text/html' },
      }),
    )

    const result = await webFetchTool.execute(
      'test-call',
      { url: 'https://example.com' },
      signal,
      undefined,
      // @ts-expect-error minimal context mock
      {},
    )

    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Title'),
    })
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Paragraph'),
    })
    expect(result.details).toMatchObject({ contentType: 'text/html' })
  })

  it('converts images to base64 data URL', async () => {
    const imageBody = 'fake-image-bytes'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse(imageBody, {
        headers: { 'content-type': 'image/png' },
      }),
    )

    const result = await webFetchTool.execute(
      'test-call',
      { url: 'https://example.com/photo.png' },
      signal,
      undefined,
      // @ts-expect-error minimal context mock
      {},
    )

    expect(result.content).toHaveLength(2)
    expect(result.content[0]).toMatchObject({
      type: 'image',
      data: expect.stringContaining('data:image/png;base64,'),
      mimeType: 'image/png',
    })
    expect(result.content[1]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('image/png'),
    })
    expect(result.details).toMatchObject({ contentType: 'image/png' })
  })

  it('retries with honest user-agent on Cloudflare challenge', async () => {
    const cfResponse = new Response('blocked', {
      status: 403,
      headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/plain' },
    })
    const okResponse = makeResponse('ok')

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(cfResponse)
      .mockResolvedValueOnce(okResponse)

    const result = await webFetchTool.execute(
      'test-call',
      { url: 'https://example.com' },
      signal,
      undefined,
      // @ts-expect-error minimal context mock
      {},
    )

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[0]?.[1]?.headers).toMatchObject({
      'User-Agent': expect.stringContaining('Chrome'),
    })
    expect(fetchSpy.mock.calls[1]?.[1]?.headers).toMatchObject({
      'User-Agent': 'opencode',
    })
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'ok' })
  })

  it('rejects responses exceeding 5MB', async () => {
    const largeSize = 5 * 1024 * 1024 + 1
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('x', {
        status: 200,
        headers: {
          'content-type': 'text/plain',
          'content-length': String(largeSize),
        },
      }),
    )

    const result = await webFetchTool.execute(
      'test-call',
      { url: 'https://example.com' },
      signal,
      undefined,
      // @ts-expect-error minimal context mock
      {},
    )

    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('too large'),
    })
  })

  it('handles fetch network errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('Connection refused'),
    )

    const result = await webFetchTool.execute(
      'test-call',
      { url: 'https://example.com' },
      signal,
      undefined,
      // @ts-expect-error minimal context mock
      {},
    )

    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Connection refused'),
    })
  })
})

describe('webFetchTool.renderResult', () => {
  it('renders text content collapsed', () => {
    const result = {
      content: [{ type: 'text' as const, text: 'hello world' }],
      details: {
        url: 'https://example.com',
        status: 200,
        contentType: 'text/plain',
        size: 11,
      },
    }

    const rendered = webFetchTool.renderResult?.(
      result,
      { expanded: false, isPartial: false },
      // @ts-expect-error minimal theme mock for test
      theme,
      { args: {}, toolCallId: 'test', state: {} },
    )

    expect(textOf(rendered)).toContain('200')
    expect(textOf(rendered)).toContain('text/plain')
    expect(textOf(rendered)).toContain('11.0 B')
    expect(textOf(rendered)).toContain('hello world')
  })

  it('renders text content expanded with preview', () => {
    const longText = 'a'.repeat(500)
    const result = {
      content: [{ type: 'text' as const, text: longText }],
      details: {
        url: 'https://example.com',
        status: 200,
        contentType: 'text/plain',
        size: 500,
      },
    }

    const rendered = webFetchTool.renderResult?.(
      result,
      { expanded: true, isPartial: false },
      // @ts-expect-error minimal theme mock for test
      theme,
      { args: {}, toolCallId: 'test', state: {} },
    )

    expect(textOf(rendered)).toContain('truncated')
    expect(textOf(rendered)).toContain('500.0 B')
  })

  it('renders image content without base64', () => {
    const result = {
      content: [
        {
          type: 'image' as const,
          data: 'data:image/png;base64,abc123',
          mimeType: 'image/png',
        },
        { type: 'text' as const, text: 'Fetched image/png' },
      ],
      details: {
        url: 'https://example.com/photo.png',
        status: 200,
        contentType: 'image/png',
        size: 1024,
      },
    }

    const rendered = webFetchTool.renderResult?.(
      result,
      { expanded: false, isPartial: false },
      // @ts-expect-error minimal theme mock for test
      theme,
      { args: {}, toolCallId: 'test', state: {} },
    )

    expect(textOf(rendered)).toContain('image/png')
    expect(textOf(rendered)).toContain('1.0 KB')
    expect(textOf(rendered)).toContain('base64 omitted')
    expect(textOf(rendered)).not.toContain('abc123')
  })

  it('renders error result', () => {
    const result = {
      content: [{ type: 'text' as const, text: 'Something went wrong' }],
      details: undefined,
    }

    const rendered = webFetchTool.renderResult?.(
      result,
      { expanded: false, isPartial: false },
      // @ts-expect-error minimal theme mock for test
      theme,
      { args: {}, toolCallId: 'test', state: {} },
    )

    expect(textOf(rendered)).toBe('Something went wrong')
  })

  it('formats large sizes correctly', () => {
    const result = {
      content: [{ type: 'text' as const, text: 'content' }],
      details: {
        url: 'https://example.com',
        status: 200,
        contentType: 'text/plain',
        size: 2 * 1024 * 1024,
      },
    }

    const rendered = webFetchTool.renderResult?.(
      result,
      { expanded: false, isPartial: false },
      // @ts-expect-error minimal theme mock for test
      theme,
      { args: {}, toolCallId: 'test', state: {} },
    )

    expect(textOf(rendered)).toContain('2.0 MB')
  })
})
