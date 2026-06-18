import { describe, expect, it } from 'vitest'

import {
  HASH_WIDTH,
  detectLineEnding,
  formatHashline,
  hashLineContent,
  joinLines,
  splitLines,
  validateLineRangeEdit,
  type LineInfo,
  type LineRangeEdit,
} from '../hashlines.js'

describe('HASH_WIDTH', () => {
  it('equals 6 hex characters', () => {
    expect(HASH_WIDTH).toBe(6)
  })
})

describe('hashLineContent', () => {
  it('returns a string of exactly HASH_WIDTH hex characters', () => {
    expect(hashLineContent('hello')).toMatch(/^[0-9a-f]{6}$/)
    expect(hashLineContent('')).toMatch(/^[0-9a-f]{6}$/)
    expect(hashLineContent('hello').length).toBe(HASH_WIDTH)
  })

  it('produces a stable hash for the same visible content', () => {
    expect(hashLineContent('hello')).toBe(hashLineContent('hello'))
    expect(hashLineContent('a longer line of text')).toBe(
      hashLineContent('a longer line of text'),
    )
  })

  it('normalizes trailing spaces and tabs before hashing', () => {
    expect(hashLineContent('hello')).toBe(hashLineContent('hello   '))
    expect(hashLineContent('hello')).toBe(hashLineContent('hello\t\t'))
    expect(hashLineContent('hello')).toBe(hashLineContent('hello \t  \t'))
  })

  it('preserves leading whitespace differences', () => {
    expect(hashLineContent('  hello')).not.toBe(hashLineContent('hello'))
  })

  it('preserves internal whitespace differences', () => {
    expect(hashLineContent('hello world')).not.toBe(
      hashLineContent('hello\tworld'),
    )
    expect(hashLineContent('hello world')).not.toBe(
      hashLineContent('helloworld'),
    )
  })

  it('produces different hashes for different meaningful content', () => {
    expect(hashLineContent('hello')).not.toBe(hashLineContent('world'))
    expect(hashLineContent('return 1')).not.toBe(hashLineContent('return 2'))
  })

  it('returns a stable hash for empty lines', () => {
    const first = hashLineContent('')
    const second = hashLineContent('')
    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{6}$/)
  })

  it('matches the SHA-256 prefix for the empty string', () => {
    // SHA-256("") starts with "e3b0c4..."
    expect(hashLineContent('')).toBe('e3b0c4')
  })

  it('matches the SHA-256 prefix for "hello"', () => {
    // SHA-256("hello") starts with "2cf24d..."
    expect(hashLineContent('hello')).toBe('2cf24d')
  })
})

describe('formatHashline', () => {
  it('uses the exact `${lineNumber}:${hash}| ${line}` format', () => {
    expect(formatHashline(42, 'hello')).toBe('42:2cf24d| hello')
  })

  it('renders the line number without padding', () => {
    expect(formatHashline(1, 'a')).toBe(`1:${hashLineContent('a')}| a`)
    expect(formatHashline(12_345, 'a')).toBe(`12345:${hashLineContent('a')}| a`)
  })

  it('keeps the visible line content exactly as supplied', () => {
    expect(formatHashline(3, '  indented')).toBe(
      `3:${hashLineContent('  indented')}|   indented`,
    )
  })

  it('renders an empty line with a trailing space after the separator', () => {
    expect(formatHashline(7, '')).toBe(`7:${hashLineContent('')}| `)
  })

  it('uses hashLineContent for the hash component', () => {
    const line = 'const x = 1'
    const expected = `9:${hashLineContent(line)}| ${line}`
    expect(formatHashline(9, line)).toBe(expected)
  })
})

describe('detectLineEnding', () => {
  it('returns CRLF when content contains a CRLF newline', () => {
    expect(detectLineEnding('a\r\nb')).toBe('CRLF')
  })

  it('returns LF when content contains only LF newlines', () => {
    expect(detectLineEnding('a\nb')).toBe('LF')
  })

  it('returns LF for empty content', () => {
    expect(detectLineEnding('')).toBe('LF')
  })

  it('returns LF for content with no newlines', () => {
    expect(detectLineEnding('single line')).toBe('LF')
  })

  it('prefers CRLF when a CRLF newline appears before any LF', () => {
    expect(detectLineEnding('\r\nb\nc')).toBe('CRLF')
  })
})

describe('splitLines', () => {
  it('returns an empty result for empty content', () => {
    expect(splitLines('')).toEqual({
      lines: [],
      hadFinalNewline: false,
      lineEnding: 'LF',
    })
  })

  it('splits LF content and reports no final newline when missing', () => {
    expect(splitLines('a\nb\nc')).toEqual({
      lines: ['a', 'b', 'c'],
      hadFinalNewline: false,
      lineEnding: 'LF',
    })
  })

  it('marks hadFinalNewline when content ends with a newline', () => {
    expect(splitLines('a\nb\nc\n')).toEqual({
      lines: ['a', 'b', 'c'],
      hadFinalNewline: true,
      lineEnding: 'LF',
    })
  })

  it('strips trailing CRLF from CRLF content and detects CRLF', () => {
    expect(splitLines('a\r\nb\r\nc\r\n')).toEqual({
      lines: ['a', 'b', 'c'],
      hadFinalNewline: true,
      lineEnding: 'CRLF',
    })
  })

  it('handles CRLF without a final newline', () => {
    expect(splitLines('a\r\nb\r\nc')).toEqual({
      lines: ['a', 'b', 'c'],
      hadFinalNewline: false,
      lineEnding: 'CRLF',
    })
  })

  it('treats a single LF as one empty line with a final newline', () => {
    expect(splitLines('\n')).toEqual({
      lines: [''],
      hadFinalNewline: true,
      lineEnding: 'LF',
    })
  })

  it('treats a single CRLF as one empty line with a final newline', () => {
    expect(splitLines('\r\n')).toEqual({
      lines: [''],
      hadFinalNewline: true,
      lineEnding: 'CRLF',
    })
  })

  it('returns a single line when content has no newline', () => {
    expect(splitLines('hello')).toEqual({
      lines: ['hello'],
      hadFinalNewline: false,
      lineEnding: 'LF',
    })
  })

  it('preserves empty lines between non-empty lines', () => {
    expect(splitLines('a\n\nb\n')).toEqual({
      lines: ['a', '', 'b'],
      hadFinalNewline: true,
      lineEnding: 'LF',
    })
  })
})

describe('joinLines', () => {
  it('joins lines with LF by default', () => {
    expect(joinLines({ lines: ['a', 'b', 'c'], hadFinalNewline: false })).toBe(
      'a\nb\nc',
    )
  })

  it('preserves the final newline when requested', () => {
    expect(joinLines({ lines: ['a', 'b', 'c'], hadFinalNewline: true })).toBe(
      'a\nb\nc\n',
    )
  })

  it('joins with CRLF separators when lineEnding is CRLF', () => {
    expect(
      joinLines({
        lines: ['a', 'b'],
        hadFinalNewline: true,
        lineEnding: 'CRLF',
      }),
    ).toBe('a\r\nb\r\n')
  })

  it('round-trips with splitLines for LF content with final newline', () => {
    const original = 'alpha\nbeta\ngamma\n'
    const split = splitLines(original)
    expect(joinLines(split)).toBe(original)
  })

  it('round-trips with splitLines for CRLF content with final newline', () => {
    const original = 'alpha\r\nbeta\r\ngamma\r\n'
    const split = splitLines(original)
    expect(joinLines(split)).toBe(original)
  })

  it('round-trips with splitLines for LF content without final newline', () => {
    const original = 'alpha\nbeta'
    const split = splitLines(original)
    expect(joinLines(split)).toBe(original)
  })

  it('round-trips with splitLines for CRLF content without final newline', () => {
    const original = 'alpha\r\nbeta'
    const split = splitLines(original)
    expect(joinLines(split)).toBe(original)
  })

  it('returns the empty string for an empty line list', () => {
    expect(joinLines({ lines: [], hadFinalNewline: false })).toBe('')
    expect(joinLines({ lines: [], hadFinalNewline: true })).toBe('')
  })

  it('preserves a single empty line plus final newline', () => {
    expect(joinLines({ lines: [''], hadFinalNewline: true })).toBe('\n')
  })
})

function makeLine(content: string): LineInfo {
  return { content, hash: hashLineContent(content) }
}

const lines: LineInfo[] = [
  makeLine('first'),
  makeLine('second'),
  makeLine('third'),
]

function makeEdit(overrides: Partial<LineRangeEdit> = {}): LineRangeEdit {
  return {
    from: 1,
    fromHash: hashLineContent('first'),
    to: 2,
    toHash: hashLineContent('second'),
    newText: 'replacement',
    ...overrides,
  }
}

describe('validateLineRangeEdit', () => {
  it('accepts a valid range with matching endpoint hashes', () => {
    expect(validateLineRangeEdit(makeEdit(), lines)).toBeUndefined()
  })

  it('accepts a single-line range where from equals to', () => {
    const edit = makeEdit({
      from: 2,
      fromHash: hashLineContent('second'),
      to: 2,
      toHash: hashLineContent('second'),
    })
    expect(validateLineRangeEdit(edit, lines)).toBeUndefined()
  })

  it('accepts the last line of the file', () => {
    const edit = makeEdit({
      from: 3,
      fromHash: hashLineContent('third'),
      to: 3,
      toHash: hashLineContent('third'),
    })
    expect(validateLineRangeEdit(edit, lines)).toBeUndefined()
  })

  it('rejects a non-integer `from` line', () => {
    expect(validateLineRangeEdit(makeEdit({ from: 1.5 }), lines)).toEqual({
      kind: 'non-integer-line',
      line: 'from',
      value: 1.5,
    })
  })

  it('rejects a non-integer `to` line', () => {
    expect(validateLineRangeEdit(makeEdit({ to: 2.5 }), lines)).toEqual({
      kind: 'non-integer-line',
      line: 'to',
      value: 2.5,
    })
  })

  it('rejects a zero line number on `from`', () => {
    expect(validateLineRangeEdit(makeEdit({ from: 0 }), lines)).toEqual({
      kind: 'non-positive-line',
      line: 'from',
      value: 0,
    })
  })

  it('rejects a negative line number on `to`', () => {
    expect(validateLineRangeEdit(makeEdit({ to: -3 }), lines)).toEqual({
      kind: 'non-positive-line',
      line: 'to',
      value: -3,
    })
  })

  it('rejects an inverted range (from > to)', () => {
    const edit = makeEdit({
      from: 2,
      fromHash: hashLineContent('second'),
      to: 1,
      toHash: hashLineContent('first'),
    })
    expect(validateLineRangeEdit(edit, lines)).toEqual({
      kind: 'inverted-range',
      from: 2,
      to: 1,
    })
  })

  it('rejects a range that extends past the end of the file', () => {
    const edit = makeEdit({ to: 4, toHash: hashLineContent('third') })
    expect(validateLineRangeEdit(edit, lines)).toEqual({
      kind: 'out-of-bounds',
      from: 1,
      to: 4,
      totalLines: 3,
    })
  })

  it('rejects an empty `fromHash`', () => {
    expect(validateLineRangeEdit(makeEdit({ fromHash: '' }), lines)).toEqual({
      kind: 'empty-hash',
      endpoint: 'from',
    })
  })

  it('rejects an empty `toHash`', () => {
    expect(validateLineRangeEdit(makeEdit({ toHash: '' }), lines)).toEqual({
      kind: 'empty-hash',
      endpoint: 'to',
    })
  })

  it('rejects a malformed `fromHash` (wrong characters)', () => {
    expect(validateLineRangeEdit(makeEdit({ fromHash: 'XYZ' }), lines)).toEqual(
      {
        kind: 'malformed-hash',
        endpoint: 'from',
        value: 'XYZ',
      },
    )
  })

  it('rejects a malformed `toHash` (wrong length)', () => {
    expect(validateLineRangeEdit(makeEdit({ toHash: 'abc' }), lines)).toEqual({
      kind: 'malformed-hash',
      endpoint: 'to',
      value: 'abc',
    })
  })

  it('rejects a `fromHash` mismatch and reports the current line content', () => {
    expect(
      validateLineRangeEdit(makeEdit({ fromHash: '000000' }), lines),
    ).toEqual({
      kind: 'hash-mismatch',
      endpoint: 'from',
      line: 1,
      claimed: '000000',
      actual: hashLineContent('first'),
      currentLine: 'first',
    })
  })

  it('rejects a `toHash` mismatch and reports the current line content', () => {
    expect(
      validateLineRangeEdit(makeEdit({ toHash: 'ffffff' }), lines),
    ).toEqual({
      kind: 'hash-mismatch',
      endpoint: 'to',
      line: 2,
      claimed: 'ffffff',
      actual: hashLineContent('second'),
      currentLine: 'second',
    })
  })

  it('rejects hash-format errors before checking hash mismatches', () => {
    const edit = makeEdit({ fromHash: '', toHash: 'also-bad' })
    const result = validateLineRangeEdit(edit, lines)
    expect(result).toEqual({ kind: 'empty-hash', endpoint: 'from' })
  })
})
