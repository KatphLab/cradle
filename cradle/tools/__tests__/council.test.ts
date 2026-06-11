import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { councilTool, parseCouncilParameters } from '../council.js'
import { runCouncil } from '../council/runner.js'

vi.mock('../council/runner.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    runCouncil: vi.fn(),
  }
})

function makeMockContext(cwd: string): ExtensionContext {
  return {
    cwd,
    hasUI: false,
    ui: { confirm: vi.fn(), select: vi.fn() },
    sessionManager: { getActiveSession: vi.fn(), getSessions: vi.fn() },
    modelRegistry: { getModel: vi.fn(), getModels: vi.fn() },
    model: undefined,
    isIdle: () => true,
    signal: undefined,
    abort: vi.fn(),
    hasPendingMessages: () => false,
    shutdown: vi.fn(),
    getContextUsage: vi.fn(),
    compact: vi.fn(),
    getSystemPrompt: () => '',
  } as unknown as ExtensionContext
}

describe('parseCouncilParameters', () => {
  it('returns undefined for non-object input', () => {
    expect(parseCouncilParameters('string')).toBeUndefined()
    expect(parseCouncilParameters(null)).toBeUndefined()
    expect(parseCouncilParameters(42)).toBeUndefined()
  })

  it('returns undefined when question is missing', () => {
    expect(parseCouncilParameters({})).toBeUndefined()
    expect(parseCouncilParameters({ context: 'ctx' })).toBeUndefined()
  })

  it('returns undefined when question is empty', () => {
    expect(parseCouncilParameters({ question: '' })).toBeUndefined()
  })

  it('parses question with defaults', () => {
    const result = parseCouncilParameters({ question: 'Ship or hold?' })
    expect(result).toEqual({ question: 'Ship or hold?', complexity: 'medium' })
  })

  it('parses question with context', () => {
    const result = parseCouncilParameters({
      question: 'Which framework?',
      context: 'React codebase',
    })
    expect(result).toEqual({
      question: 'Which framework?',
      complexity: 'medium',
      context: 'React codebase',
    })
  })

  it('parses complexity low', () => {
    const result = parseCouncilParameters({
      question: 'Q',
      complexity: 'low',
    })
    expect(result?.complexity).toBe('low')
  })

  it('parses complexity high', () => {
    const result = parseCouncilParameters({
      question: 'Q',
      complexity: 'high',
    })
    expect(result?.complexity).toBe('high')
  })

  it('defaults complexity to medium for unknown values', () => {
    const result = parseCouncilParameters({
      question: 'Q',
      complexity: 'invalid',
    })
    expect(result?.complexity).toBe('medium')
  })

  it('defaults complexity to medium when not provided', () => {
    const result = parseCouncilParameters({ question: 'Q' })
    expect(result?.complexity).toBe('medium')
  })
})

describe('councilTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exports a tool with correct name', () => {
    expect(councilTool.name).toBe('council')
  })

  it('has a description', () => {
    expect(councilTool.description).toContain('council')
  })

  it('has parameters schema', () => {
    expect(councilTool.parameters).toBeDefined()
  })

  it('has an execute function', () => {
    expect(typeof councilTool.execute).toBe('function')
  })

  it('has a renderCall function', () => {
    expect(typeof councilTool.renderCall).toBe('function')
  })

  it('has a renderResult function', () => {
    expect(typeof councilTool.renderResult).toBe('function')
  })

  it('renders call with valid parameters', () => {
    const renderCall = councilTool.renderCall as unknown as
      | ((args: unknown, theme: unknown, context: unknown) => unknown)
      | undefined
    if (renderCall === undefined) throw new Error('renderCall missing')
    const mockTheme = {
      bold: (text: string) => text,
      fg: (_c: string, text: string) => text,
    }
    const result = renderCall({ question: 'Test question' }, mockTheme, {})
    expect(result).toBeDefined()
  })

  it('renders call with invalid parameters', () => {
    const renderCall = councilTool.renderCall as unknown as
      | ((args: unknown, theme: unknown, context: unknown) => unknown)
      | undefined
    if (renderCall === undefined) throw new Error('renderCall missing')
    const mockTheme = {
      bold: (text: string) => text,
      fg: (_c: string, text: string) => text,
    }
    const result = renderCall({}, mockTheme, {})
    expect(result).toBeDefined()
  })

  it('renders result', () => {
    const renderResult = councilTool.renderResult as unknown as
      | ((
          result: unknown,
          options: unknown,
          theme: unknown,
          context: unknown,
        ) => unknown)
      | undefined
    if (renderResult === undefined) throw new Error('renderResult missing')
    const result = renderResult(
      {
        content: [{ type: 'text', text: 'verdict' }],
        details: { verdict: 'verdict', voiceResults: [], error: undefined },
      },
      { expanded: false },
      {},
      {},
    )
    expect(result).toBeDefined()
  })

  it('returns error for invalid parameters', async () => {
    const result = await councilTool.execute(
      'call-1',
      { question: '' },
      undefined,
      undefined,
      makeMockContext('/repo'),
    )
    expect(result.content[0]?.type).toBe('text')
  })

  it('returns error when runCouncil returns an error', async () => {
    vi.mocked(runCouncil).mockResolvedValue({
      verdict: '',
      voiceResults: [],
      error: 'All voices failed',
    })

    const result = await councilTool.execute(
      'call-2',
      { question: 'Test question' },
      undefined,
      undefined,
      makeMockContext('/repo'),
    )

    expect(result.content[0]?.type).toBe('text')
  })

  it('returns verdict on success', async () => {
    vi.mocked(runCouncil).mockResolvedValue({
      verdict: '## Council\nShip it',
      voiceResults: [],
      error: undefined,
    })

    const result = await councilTool.execute(
      'call-3',
      { question: 'Ship or hold?', context: 'Deadline Friday' },
      undefined,
      undefined,
      makeMockContext('/repo'),
    )

    expect(result.content[0]?.type).toBe('text')
  })

  it('returns error when runCouncil throws', async () => {
    vi.mocked(runCouncil).mockRejectedValue(new Error('Network error'))

    const result = await councilTool.execute(
      'call-4',
      { question: 'Q' },
      undefined,
      undefined,
      makeMockContext('/repo'),
    )

    expect(result.content[0]?.type).toBe('text')
  })
})
