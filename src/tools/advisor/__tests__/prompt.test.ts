import { describe, expect, it } from 'vitest'
import { buildAdvisorUserMessage } from '../prompt.js'

describe('buildAdvisorUserMessage', () => {
  it('builds message with only context', () => {
    const result = buildAdvisorUserMessage({
      context: 'I need help with a bug',
      code: undefined,
      error: undefined,
      attempted: undefined,
    })
    expect(result).toContain('## Situation')
    expect(result).toContain('I need help with a bug')
    expect(result).toContain('## Request')
  })

  it('includes code when provided', () => {
    const result = buildAdvisorUserMessage({
      context: 'Bug in my code',
      code: 'const x = 1',
      error: undefined,
      attempted: undefined,
    })
    expect(result).toContain('## Relevant Code')
    expect(result).toContain('const x = 1')
  })

  it('includes error when provided', () => {
    const result = buildAdvisorUserMessage({
      context: 'Bug in my code',
      code: undefined,
      error: 'TypeError: undefined is not a function',
      attempted: undefined,
    })
    expect(result).toContain('## Error / Unexpected Output')
    expect(result).toContain('TypeError: undefined is not a function')
  })

  it('includes attempted when provided', () => {
    const result = buildAdvisorUserMessage({
      context: 'Bug in my code',
      code: undefined,
      error: undefined,
      attempted: 'I tried restarting the server',
    })
    expect(result).toContain("## What I've Already Tried")
    expect(result).toContain('I tried restarting the server')
  })

  it('includes all fields when provided', () => {
    const result = buildAdvisorUserMessage({
      context: 'Bug in my code',
      code: 'const x = 1',
      error: 'TypeError',
      attempted: 'Tried everything',
    })
    expect(result).toContain('## Situation')
    expect(result).toContain('## Relevant Code')
    expect(result).toContain('## Error / Unexpected Output')
    expect(result).toContain("## What I've Already Tried")
    expect(result).toContain('## Request')
  })

  it('skips empty string fields', () => {
    const result = buildAdvisorUserMessage({
      context: 'Bug in my code',
      code: '',
      error: '',
      attempted: '',
    })
    expect(result).not.toContain('## Relevant Code')
    expect(result).not.toContain('## Error / Unexpected Output')
    expect(result).not.toContain("## What I've Already Tried")
  })
})
