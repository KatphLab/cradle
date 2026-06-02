import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'
import TurndownService from 'turndown'

import type { ThemeLike } from '../utils/theme.js'

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024 // 5 MB

const CHROME_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const HONEST_UA = 'opencode'

const HTML_ACCEPT = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'

function validateUrl(url: string): string | undefined {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return 'Invalid URL: must start with http:// or https://'
  }
  return undefined
}

function buildHeaders(isRetry: boolean): Record<string, string> {
  return {
    'User-Agent': isRetry ? HONEST_UA : CHROME_UA,
    Accept: HTML_ACCEPT,
  }
}

function isImageContentType(contentType: string): boolean {
  return contentType.startsWith('image/')
}

function isHtmlContentType(contentType: string): boolean {
  return (
    contentType.includes('text/html') ||
    contentType.includes('application/xhtml')
  )
}

function convertContent(
  body: string,
  contentType: string,
):
  | { text: string; isImage: false }
  | { dataUrl: string; mimeType: string; isImage: true } {
  if (isImageContentType(contentType)) {
    const base64 = Buffer.from(body, 'binary').toString('base64')
    const mimeType = contentType.split(';')[0]?.trim() ?? contentType
    const dataUrl = `data:${mimeType};base64,${base64}`
    return { dataUrl, mimeType, isImage: true }
  }

  if (isHtmlContentType(contentType)) {
    const turndown = new TurndownService()
    return { text: turndown.turndown(body), isImage: false }
  }

  return { text: body, isImage: false }
}

function isCloudflareChallenge(response: Response): boolean {
  return (
    response.status === 403 &&
    response.headers.get('cf-mitigated') === 'challenge'
  )
}

interface WebFetchDetails {
  url: string
  status: number
  contentType: string
  size: number
}

function toolError(message: string): {
  content: [TextContent]
  details: undefined
} {
  return {
    content: [{ type: 'text', text: message }],
    details: undefined,
  }
}

async function fetchWithFallback(
  url: string,
  signal: AbortSignal | undefined,
): Promise<
  | { response: Response; error?: never }
  | { error: { content: [TextContent]; details: undefined } }
> {
  const maxAttempts = 2

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const isRetry = attempt > 0
    let response: Response
    try {
      response = await fetch(url, {
        headers: buildHeaders(isRetry),
        ...(signal !== undefined && { signal }),
        redirect: 'follow',
      })
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown fetch error'
      return { error: toolError(`Failed to fetch ${url}: ${message}`) }
    }

    if (!isCloudflareChallenge(response)) {
      return { response }
    }
  }

  return { error: toolError('No response received') }
}

async function readResponseBody(
  response: Response,
  url: string,
): Promise<
  | { body: string; error?: never }
  | { error: { content: [TextContent]; details: undefined } }
> {
  const contentLength = response.headers.get('content-length')
  if (
    contentLength &&
    Number.parseInt(contentLength, 10) > MAX_RESPONSE_BYTES
  ) {
    return {
      error: toolError(
        `Response too large: ${contentLength} bytes exceeds 5MB limit`,
      ),
    }
  }

  try {
    const arrayBuffer = await response.arrayBuffer()
    if (arrayBuffer.byteLength > MAX_RESPONSE_BYTES) {
      return {
        error: toolError(
          `Response too large: ${arrayBuffer.byteLength} bytes exceeds 5MB limit`,
        ),
      }
    }
    return { body: Buffer.from(arrayBuffer).toString('binary') }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown read error'
    return {
      error: toolError(`Failed to read response from ${url}: ${message}`),
    }
  }
}

function buildResult(
  body: string,
  response: Response,
  url: string,
): { content: (TextContent | ImageContent)[]; details: WebFetchDetails } {
  const rawContentType = response.headers.get('content-type') ?? 'text/plain'
  const contentType = rawContentType.split(';')[0]?.trim() ?? rawContentType
  const size = body.length

  const details: WebFetchDetails = {
    url,
    status: response.status,
    contentType,
    size,
  }

  const converted = convertContent(body, contentType)

  if (converted.isImage) {
    return {
      content: [
        {
          type: 'image',
          data: converted.dataUrl,
          mimeType: converted.mimeType,
        },
        {
          type: 'text',
          text: `Fetched ${contentType} from ${url} (${response.status}, ${size} bytes)`,
        },
      ],
      details,
    }
  }

  return {
    content: [{ type: 'text', text: converted.text }],
    details,
  }
}

const PREVIEW_MAX_LENGTH = 300
const SEPARATOR_WIDTH = 40
const COLLAPSED_PREVIEW_LINES = 3
const COLLAPSED_LINE_LIMIT = 80
const SIZE_UNITS = ['B', 'KB', 'MB'] as const
const SIZE_DIVISOR = 1024
const SIZE_DECIMAL_PLACES = 1
const STATUS_INDENT = '  '

function formatSize(bytes: number): string {
  let size = bytes
  let unitIndex = 0
  while (size >= SIZE_DIVISOR && unitIndex < SIZE_UNITS.length - 1) {
    size /= SIZE_DIVISOR
    unitIndex++
  }
  const unit = SIZE_UNITS[unitIndex] ?? 'B'
  return `${size.toFixed(SIZE_DECIMAL_PLACES)} ${unit}`
}

function buildStatusLine(details: WebFetchDetails): string {
  return `${String(details.status)} ${details.contentType} (${formatSize(details.size)})`
}

function buildPreview(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, maxLength)}...`
}

function buildCollapsedPreview(text: string, theme: ThemeLike): string {
  const lines = text.split('\n')
  const previewLines = lines.slice(0, COLLAPSED_PREVIEW_LINES)
  const truncatedLines: string[] = []
  for (const line of previewLines) {
    truncatedLines.push(
      line.length > COLLAPSED_LINE_LIMIT
        ? `${line.slice(0, COLLAPSED_LINE_LIMIT)}...`
        : line,
    )
  }
  const preview = truncatedLines.join('\n')
  const remaining = lines.length - COLLAPSED_PREVIEW_LINES
  const remainingLine = theme.fg('dim', `... +${String(remaining)} lines`)
  const remainingText = remaining > 0 ? `\n${remainingLine}` : ''
  return `${preview}${remainingText}`
}

function buildHeader(details: WebFetchDetails, theme: ThemeLike): string {
  const statusLine = buildStatusLine(details)
  return `${theme.fg('toolTitle', theme.bold('web_fetch '))}${theme.fg('accent', statusLine)}`
}

function renderWebFetchError(
  result: AgentToolResult<WebFetchDetails | undefined>,
): Text {
  const textContent = result.content.find((c) => c.type === 'text')
  const text =
    textContent !== undefined && 'text' in textContent ? textContent.text : ''
  return new Text(text, 0, 0)
}

function renderWebFetchImage(
  details: WebFetchDetails,
  theme: ThemeLike,
  expanded: boolean,
): Text {
  const header = buildHeader(details, theme)
  const note = theme.fg('dim', '[image attachment — base64 omitted]')
  if (expanded) {
    const separator = theme.fg('dim', '─'.repeat(SEPARATOR_WIDTH))
    return new Text(
      `${header}\n${STATUS_INDENT}${separator}\n${STATUS_INDENT}${note}`,
      0,
      0,
    )
  }
  return new Text(`${header}\n${STATUS_INDENT}${note}`, 0, 0)
}

function renderWebFetchText(
  result: AgentToolResult<WebFetchDetails | undefined>,
  details: WebFetchDetails,
  theme: ThemeLike,
  expanded: boolean,
): Text {
  const header = buildHeader(details, theme)
  const textContent = result.content.find((c) => c.type === 'text')
  const fullText =
    textContent !== undefined && 'text' in textContent ? textContent.text : ''
  if (expanded) {
    const separator = theme.fg('dim', '─'.repeat(SEPARATOR_WIDTH))
    const preview = buildPreview(fullText, PREVIEW_MAX_LENGTH)
    const truncatedLabel = theme.fg(
      'dim',
      `[truncated — ${formatSize(details.size)} total]`,
    )
    const sizeNote =
      fullText.length > PREVIEW_MAX_LENGTH ? `\n${truncatedLabel}` : ''
    return new Text(
      `${header}\n${STATUS_INDENT}${separator}\n${STATUS_INDENT}${preview}${sizeNote}`,
      0,
      0,
    )
  }
  const preview = buildCollapsedPreview(fullText, theme)
  return new Text(`${header}\n${STATUS_INDENT}${preview}`, 0, 0)
}

/** @public */
export const webFetchTool = defineTool({
  name: 'web_fetch',
  label: 'Web Fetch',
  description:
    'Fetch content from a URL. Returns HTML as markdown, images as base64 data URLs, and other content as-is. Supports up to 5MB responses with a 120-second timeout.',
  parameters: Type.Object({
    url: Type.String({ description: 'The URL to fetch (http:// or https://)' }),
  }),
  async execute(_toolCallId, parameters, signal) {
    const urlError = validateUrl(parameters.url)
    if (urlError) {
      return toolError(urlError)
    }

    const fetchResult = await fetchWithFallback(parameters.url, signal)
    if ('error' in fetchResult) {
      return fetchResult.error
    }

    const readResult = await readResponseBody(
      fetchResult.response,
      parameters.url,
    )
    if ('error' in readResult) {
      return readResult.error
    }

    return buildResult(readResult.body, fetchResult.response, parameters.url)
  },

  renderResult(result, { expanded }, theme) {
    const details = result.details
    if (details === undefined) {
      return renderWebFetchError(result)
    }

    if (isImageContentType(details.contentType)) {
      return renderWebFetchImage(details, theme, expanded)
    }

    return renderWebFetchText(result, details, theme, expanded)
  },
})
