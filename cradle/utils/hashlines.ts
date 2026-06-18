import { createHash } from 'node:crypto'

/** Width of the short hash prefix in hex characters used by hashline output. */
export const HASH_WIDTH = 6

const HASH_PATTERN = /^[0-9a-f]{6}$/

/**
 * Compute the short hash used to anchor a single line.
 *
 * Trailing whitespace is normalized away so that cosmetic indentation or
 * editor quirks cannot invalidate an anchor between read and edit calls.
 * Returns the first {@link HASH_WIDTH} hex characters of the SHA-256 digest.
 */
export function hashLineContent(line: string): string {
  const normalized = stripTrailingHorizontalWhitespace(line)
  return createHash('sha256')
    .update(normalized, 'utf8')
    .digest('hex')
    .slice(0, HASH_WIDTH)
}

function stripTrailingHorizontalWhitespace(line: string): string {
  let end = line.length
  while (end > 0) {
    const codePoint = line.codePointAt(end - 1)
    if (codePoint === 0x20 || codePoint === 0x09) {
      end -= 1
    } else {
      break
    }
  }
  return line.slice(0, end)
}

/**
 * Render a single line as `${lineNumber}:${hash}| ${line}`.
 *
 * The visible line content is preserved exactly as supplied; only the
 * trailing whitespace is considered for the hash component.
 */
export function formatHashline(lineNumber: number, line: string): string {
  return `${String(lineNumber)}:${hashLineContent(line)}| ${line}`
}

/** CRLF vs LF line ending style detected in a body of text. */
export type LineEnding = 'CRLF' | 'LF'

/** Result of splitting file content into editable lines. */
export interface SplitLinesResult {
  lines: string[]
  hadFinalNewline: boolean
  lineEnding: LineEnding
}

/**
 * Detect the dominant line-ending style of `content`.
 *
 * Returns `'CRLF'` if the file uses Windows-style line endings and `'LF'`
 * otherwise. Empty input falls back to `'LF'`.
 */
export function detectLineEnding(content: string): LineEnding {
  return content.includes('\r\n') ? 'CRLF' : 'LF'
}

/**
 * Split file content into lines while preserving whether the file ended
 * with a trailing newline and which CRLF/LF style it used.
 *
 * Trailing carriage returns from CRLF separators are stripped so that
 * downstream hashing operates on the visible line content.
 */
export function splitLines(content: string): SplitLinesResult {
  const lineEnding = detectLineEnding(content)
  if (content === '') {
    return { lines: [], hadFinalNewline: false, lineEnding }
  }
  const hadFinalNewline = endsWithAnyNewline(content)
  const body = hadFinalNewline ? stripTrailingNewline(content) : content
  if (body === '') {
    return { lines: [''], hadFinalNewline, lineEnding }
  }
  const lines = body
    .split('\n')
    .map((line) => stripTrailingCarriageReturn(line))
  return { lines, hadFinalNewline, lineEnding }
}

export interface JoinLinesOptions {
  lines: string[]
  hadFinalNewline: boolean
  lineEnding?: LineEnding
}

/**
 * Reassemble lines into file content, preserving the requested CRLF/LF
 * style and whether the original file had a trailing newline.
 */
export function joinLines({
  lines,
  hadFinalNewline,
  lineEnding = 'LF',
}: JoinLinesOptions): string {
  if (lines.length === 0) {
    return ''
  }
  const separator = lineEnding === 'CRLF' ? '\r\n' : '\n'
  const body = lines.join(separator)
  return hadFinalNewline ? body + separator : body
}

function endsWithAnyNewline(content: string): boolean {
  return content.endsWith('\n')
}

function stripTrailingNewline(content: string): string {
  return content.endsWith('\r\n') ? content.slice(0, -2) : content.slice(0, -1)
}

function stripTrailingCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

/** A single file line paired with its hash for range-edit validation. */
export interface LineInfo {
  hash: string
  content: string
}

/** A single line-range edit as accepted by the edit tool. */
export interface LineRangeEdit {
  from: number
  fromHash: string
  to: number
  toHash: string
  newText: string
}

/** Structured validation failure for a line-range edit. */
export type LineRangeValidationError =
  | { kind: 'non-integer-line'; line: 'from' | 'to'; value: number }
  | { kind: 'non-positive-line'; line: 'from' | 'to'; value: number }
  | { kind: 'inverted-range'; from: number; to: number }
  | { kind: 'out-of-bounds'; from: number; to: number; totalLines: number }
  | { kind: 'empty-hash'; endpoint: 'from' | 'to' }
  | { kind: 'malformed-hash'; endpoint: 'from' | 'to'; value: string }
  | {
      kind: 'hash-mismatch'
      endpoint: 'from' | 'to'
      line: number
      claimed: string
      actual: string
      currentLine: string
    }

/**
 * Validate a single {@link LineRangeEdit} against the current line hashes
 * of a file. Returns `undefined` when the edit is valid and a structured
 * error otherwise so callers can render actionable messages.
 */
export function validateLineRangeEdit(
  edit: LineRangeEdit,
  lines: readonly LineInfo[],
): LineRangeValidationError | undefined {
  const totalLines = lines.length

  const fromNumberError = checkLineInteger(edit.from, 'from')
  if (fromNumberError !== undefined) return fromNumberError
  const toNumberError = checkLineInteger(edit.to, 'to')
  if (toNumberError !== undefined) return toNumberError

  if (edit.from > edit.to) {
    return { kind: 'inverted-range', from: edit.from, to: edit.to }
  }
  if (edit.to > totalLines) {
    return {
      kind: 'out-of-bounds',
      from: edit.from,
      to: edit.to,
      totalLines,
    }
  }

  const fromHashError = checkHashFormat(edit.fromHash, 'from')
  if (fromHashError !== undefined) return fromHashError
  const toHashError = checkHashFormat(edit.toHash, 'to')
  if (toHashError !== undefined) return toHashError

  const endpointError = checkEndpointHashes(edit, lines)
  if (endpointError !== undefined) return endpointError

  return undefined
}

function checkLineInteger(
  value: number,
  endpoint: 'from' | 'to',
): LineRangeValidationError | undefined {
  if (!Number.isInteger(value)) {
    return { kind: 'non-integer-line', line: endpoint, value }
  }
  if (value <= 0) {
    return { kind: 'non-positive-line', line: endpoint, value }
  }
  return undefined
}

function checkHashFormat(
  value: string,
  endpoint: 'from' | 'to',
): LineRangeValidationError | undefined {
  if (value === '') {
    return { kind: 'empty-hash', endpoint }
  }
  if (!HASH_PATTERN.test(value)) {
    return { kind: 'malformed-hash', endpoint, value }
  }
  return undefined
}

function checkEndpointHashes(
  edit: LineRangeEdit,
  lines: readonly LineInfo[],
): LineRangeValidationError | undefined {
  const fromLine = lines[edit.from - 1]
  if (fromLine !== undefined && fromLine.hash !== edit.fromHash) {
    return {
      kind: 'hash-mismatch',
      endpoint: 'from',
      line: edit.from,
      claimed: edit.fromHash,
      actual: fromLine.hash,
      currentLine: fromLine.content,
    }
  }
  const toLine = lines[edit.to - 1]
  if (toLine !== undefined && toLine.hash !== edit.toHash) {
    return {
      kind: 'hash-mismatch',
      endpoint: 'to',
      line: edit.to,
      claimed: edit.toHash,
      actual: toLine.hash,
      currentLine: toLine.content,
    }
  }
  return undefined
}
