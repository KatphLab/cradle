import { describe, expect, it } from 'vitest'

import {
  createMockProcess,
  findFinalOutput,
  isRecord,
  isTextPart,
  type MockProcess,
  waitForSpawn,
} from './runner.test-helpers.js'

describe('isTextPart', () => {
  it('returns true for valid text part', () => {
    expect(isTextPart({ type: 'text', text: 'hello' })).toBe(true)
  })

  it('returns false for object with wrong type field', () => {
    expect(isTextPart({ type: 'image', text: 'hello' })).toBe(false)
  })

  it('returns false for object with non-string text', () => {
    expect(isTextPart({ type: 'text', text: 42 })).toBe(false)
  })

  it('returns false for null', () => {
    expect(isTextPart(null)).toBe(false)
  })

  it('returns false for primitive', () => {
    expect(isTextPart('hello')).toBe(false)
  })

  it('returns false for object missing text field', () => {
    expect(isTextPart({ type: 'text' })).toBe(false)
  })

  it('returns false for object missing type field', () => {
    expect(isTextPart({ text: 'hello' })).toBe(false)
  })
})

describe('findFinalOutput', () => {
  it('returns text from last assistant message', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
      { role: 'user', content: [{ type: 'text', text: 'bye' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'goodbye' }] },
    ]
    expect(findFinalOutput(messages)).toBe('goodbye')
  })

  it('returns empty string when no assistant messages', () => {
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
    expect(findFinalOutput(messages)).toBe('')
  })

  it('returns empty string when assistant message has no content', () => {
    const messages = [{ role: 'assistant' }]
    expect(findFinalOutput(messages)).toBe('')
  })

  it('returns empty string when assistant message has no text parts', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'image', url: 'https://example.com/img.png' }],
      },
    ]
    expect(findFinalOutput(messages)).toBe('')
  })

  it('returns empty string for empty messages array', () => {
    expect(findFinalOutput([])).toBe('')
  })
})

describe('isRecord', () => {
  it('returns true for plain object', () => {
    expect(isRecord({ a: 1 })).toBe(true)
  })

  it('returns true for array (arrays are objects)', () => {
    expect(isRecord([1, 2])).toBe(true)
  })

  it('returns false for null', () => {
    expect(isRecord(null)).toBe(false)
  })

  it('returns false for primitive', () => {
    expect(isRecord('hello')).toBe(false)
    expect(isRecord(42)).toBe(false)
    expect(isRecord(true)).toBe(false)
  })
})

describe('waitForSpawn', () => {
  it('returns process when immediately available', async () => {
    const proc = createMockProcess()
    const spawned = [proc]
    const result = await waitForSpawn(spawned)
    expect(result).toBe(proc)
  })

  it('returns process after waiting', async () => {
    const spawned: MockProcess[] = []
    const promise = waitForSpawn(spawned)
    spawned.push(createMockProcess())
    const result = await promise
    expect(result).toBe(spawned[0])
  })

  it('throws when process is never spawned', async () => {
    await expect(waitForSpawn([])).rejects.toThrow('Process was not spawned')
  })
})
