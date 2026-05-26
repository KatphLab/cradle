import { describe, expect, it, vi } from 'vitest'

import { askUserTool, type AskUserQuestion } from './ask-user.js'

describe('askUserTool', () => {
  it('returns structured JSON for a single question with options', async () => {
    const result = await askUserTool.execute(
      'test-call',
      {
        questions: [
          {
            id: 'q1',
            question: 'Which approach?',
            options: [
              { label: 'JWT tokens', value: 'jwt' },
              { label: 'Session cookies', value: 'session' },
            ],
          },
        ],
      },
      new AbortController().signal,
      vi.fn(),
      // @ts-expect-error minimal context mock
      {},
    )

    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect(result.details).toEqual({ type: 'ask_user' })

    expect(result.content[0]).toHaveProperty(
      'text',
      expect.stringContaining('"id": "q1"'),
    )
    expect(result.content[0]).toHaveProperty(
      'text',
      expect.stringContaining('"question": "Which approach?"'),
    )
    expect(result.content[0]).toHaveProperty(
      'text',
      expect.stringContaining('"label": "JWT tokens"'),
    )
    expect(result.content[0]).toHaveProperty(
      'text',
      expect.stringContaining('"value": "jwt"'),
    )
  })

  it('includes preamble when provided', async () => {
    const result = await askUserTool.execute(
      'test-call',
      {
        questions: [
          {
            id: 'q1',
            question: 'Proceed?',
            options: [{ label: 'Yes', value: 'yes' }],
          },
        ],
        preamble: 'This is important context.',
      },
      new AbortController().signal,
      vi.fn(),
      // @ts-expect-error minimal context mock
      {},
    )

    expect(result.content[0]).toHaveProperty(
      'text',
      expect.stringContaining('"preamble": "This is important context."'),
    )
  })

  it('handles free-form questions without options', async () => {
    const result = await askUserTool.execute(
      'test-call',
      {
        questions: [
          {
            id: 'q1',
            question: 'Any additional notes?',
          },
        ],
      },
      new AbortController().signal,
      vi.fn(),
      // @ts-expect-error minimal context mock
      {},
    )

    expect(result.content[0]).toHaveProperty(
      'text',
      expect.stringContaining('"id": "q1"'),
    )
    expect(result.content[0]).toHaveProperty(
      'text',
      expect.stringContaining('"question": "Any additional notes?"'),
    )
    expect(result.content[0]).toHaveProperty(
      'text',
      expect.not.stringContaining('"options"'),
    )
  })

  it('preserves allowCustomAnswer setting', async () => {
    const result = await askUserTool.execute(
      'test-call',
      {
        questions: [
          {
            id: 'q1',
            question: 'Pick one?',
            options: [{ label: 'A', value: 'a' }],
            allowCustomAnswer: false,
          },
        ],
      },
      new AbortController().signal,
      vi.fn(),
      // @ts-expect-error minimal context mock
      {},
    )

    expect(result.content[0]).toHaveProperty(
      'text',
      expect.stringContaining('"allowCustomAnswer": false'),
    )
  })

  it('formats multiple questions', async () => {
    const questions: AskUserQuestion[] = [
      {
        id: 'q1',
        question: 'First?',
        options: [{ label: 'A', value: 'a' }],
      },
      {
        id: 'q2',
        question: 'Second?',
        options: [{ label: 'B', value: 'b' }],
      },
    ]

    const result = await askUserTool.execute(
      'test-call',
      { questions },
      new AbortController().signal,
      vi.fn(),
      // @ts-expect-error minimal context mock
      {},
    )

    expect(result.content[0]).toHaveProperty(
      'text',
      expect.stringContaining('"id": "q1"'),
    )
    expect(result.content[0]).toHaveProperty(
      'text',
      expect.stringContaining('"id": "q2"'),
    )
  })
})
