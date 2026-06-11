import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildRenderCall, renderIterativeRetrievalResult } from '../render.js'
import type { IterativeRetrievalDetails } from '../types.js'

interface MockTextInstance {
  kind: 'Text'
  text: string
  x: number
  y: number
}

interface MockContainerInstance {
  kind: 'Container'
  children: unknown[]
  addChild: (child: unknown) => void
}

interface MockSpacerInstance {
  kind: 'Spacer'
  size: number
}

interface MockMarkdownInstance {
  kind: 'Markdown'
  text: string
  x: number
  y: number
  theme: unknown
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
  Container: vi.fn(function Container(this: MockContainerInstance) {
    this.kind = 'Container'
    const children: unknown[] = []
    this.children = children
    this.addChild = (child: unknown) => {
      children.push(child)
    }
  }),
  Spacer: vi.fn(function Spacer(this: MockSpacerInstance, size: number) {
    this.kind = 'Spacer'
    this.size = size
  }),
  Markdown: vi.fn(function Markdown(
    this: MockMarkdownInstance,
    text: string,
    x: number,
    y: number,
    theme: unknown,
  ) {
    this.kind = 'Markdown'
    this.text = text
    this.x = x
    this.y = y
    this.theme = theme
  }),
}))

vi.mock('@earendil-works/pi-coding-agent', () => ({
  getMarkdownTheme: vi.fn(() => ({ _kind: 'markdown-theme' })),
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
    typeof value.text === 'string' &&
    'x' in value &&
    typeof value.x === 'number' &&
    'y' in value &&
    typeof value.y === 'number'
  )
}

function isMockContainerInstance(
  value: unknown,
): value is MockContainerInstance {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'Container' &&
    'children' in value &&
    Array.isArray(value.children)
  )
}

function textOf(rendered: unknown): string {
  if (!isMockTextInstance(rendered)) {
    throw new TypeError('Expected rendered Text instance')
  }
  return rendered.text
}

function childrenOf(rendered: unknown): unknown[] {
  if (!isMockContainerInstance(rendered)) {
    throw new TypeError('Expected rendered Container instance')
  }
  return rendered.children
}

function makeDetails(
  overrides: Partial<IterativeRetrievalDetails> = {},
): IterativeRetrievalDetails {
  return {
    task: 'test task',
    cycles: 2,
    paths: [
      { path: 'src/auth.ts', relevance: 0.9, reason: 'auth implementation' },
      { path: 'src/middleware.ts', relevance: 0.7, reason: 'middleware layer' },
    ],
    sources: [
      {
        path: 'https://example.com',
        relevance: 0.8,
        reason: 'relevant article',
      },
    ],
    findings: ['Uses JWT tokens'],
    gaps: [],
    suggestions: [],
    ...overrides,
  }
}

function makeResult(
  details?: IterativeRetrievalDetails,
  text = '## Relevant Paths\n- src/auth.ts (relevance: 0.9)',
): AgentToolResult<IterativeRetrievalDetails | undefined> {
  return {
    content: [{ type: 'text', text }],
    details,
  }
}

describe('buildRenderCall', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders label with task preview', () => {
    const rendered = buildRenderCall({ task: 'find auth patterns' }, theme)

    expect(rendered).toMatchObject({ kind: 'Text', x: 0, y: 0 })
    expect(textOf(rendered)).toContain(
      '<toolTitle><bold>Iterative Retrieval </bold></toolTitle>',
    )
    expect(textOf(rendered)).toContain('<dim>find auth patterns</dim>')
  })

  it('handles empty task', () => {
    const rendered = buildRenderCall({ task: '' }, theme)
    expect(textOf(rendered)).toContain('<dim></dim>')
  })

  it('handles missing task gracefully', () => {
    const rendered = buildRenderCall({}, theme)
    expect(textOf(rendered)).toContain('<dim></dim>')
  })

  it('truncates long tasks at 60 characters', () => {
    const longTask = `${'Find '.repeat(15)}extra`
    const rendered = buildRenderCall({ task: longTask }, theme)
    const text = textOf(rendered)
    const dimStart = text.indexOf('<dim>') + 5
    const dimEnd = text.indexOf('</dim>')
    const taskContent = text.slice(dimStart, dimEnd)
    expect(taskContent.length).toBeLessThanOrEqual(63) // 60 chars + "..."
    expect(taskContent.endsWith('...')).toBe(true)
  })
})

describe('renderIterativeRetrievalResult', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('collapsed', () => {
    it('renders header with icon and result/cycle count', () => {
      const details = makeDetails()
      const rendered = renderIterativeRetrievalResult(
        makeResult(details),
        false,
        theme,
      )
      const text = textOf(rendered)

      expect(text).toContain('<success>\u2713</success>')
      expect(text).toContain(
        '<toolTitle><bold>Iterative Retrieval</bold></toolTitle>',
      )
      expect(text).toContain('<accent>3 results in 2 cycles</accent>')
    })

    it('renders singular labels for one result and one cycle', () => {
      const details = makeDetails({
        cycles: 1,
        paths: [{ path: 'src/main.ts', relevance: 1, reason: 'entry point' }],
        sources: [],
      })
      const rendered = renderIterativeRetrievalResult(
        makeResult(details),
        false,
        theme,
      )
      const text = textOf(rendered)

      expect(text).toContain('<accent>1 result in 1 cycle</accent>')
    })

    it('shows truncated items with ...+N more when over limit', () => {
      const details = makeDetails({
        paths: [
          { path: 'src/a.ts', relevance: 0.9, reason: 'a' },
          { path: 'src/b.ts', relevance: 0.8, reason: 'b' },
          { path: 'src/c.ts', relevance: 0.7, reason: 'c' },
          { path: 'src/d.ts', relevance: 0.6, reason: 'd' },
        ],
        sources: [{ path: 'https://x.com', relevance: 0.9, reason: 'x' }],
      })
      const rendered = renderIterativeRetrievalResult(
        makeResult(details),
        false,
        theme,
      )
      const text = textOf(rendered)

      expect(text).toContain('1. src/a.ts (0.9)')
      expect(text).toContain('2. src/b.ts (0.8)')
      expect(text).toContain('3. src/c.ts (0.7)')
      expect(text).not.toContain('src/d.ts')
      expect(text).toContain('<dim>  ... +2 more</dim>')
    })

    it('shows gaps when present', () => {
      const details = makeDetails({
        gaps: ['missing deployment config'],
      })
      const rendered = renderIterativeRetrievalResult(
        makeResult(details),
        false,
        theme,
      )
      const text = textOf(rendered)

      expect(text).toContain('<dim>Gaps:</dim>')
      expect(text).toContain('  - missing deployment config')
    })

    it('truncates gaps at 2 with overflow', () => {
      const details = makeDetails({
        gaps: ['gap one', 'gap two', 'gap three', 'gap four'],
      })
      const rendered = renderIterativeRetrievalResult(
        makeResult(details),
        false,
        theme,
      )
      const text = textOf(rendered)

      expect(text).toContain('  - gap one')
      expect(text).toContain('  - gap two')
      expect(text).not.toContain('gap three')
      expect(text).toContain('<dim>  ... +2 more</dim>')
    })

    it('shows expand hint', () => {
      const rendered = renderIterativeRetrievalResult(
        makeResult(makeDetails()),
        false,
        theme,
      )
      expect(textOf(rendered)).toContain('<muted>(Ctrl+O to expand)</muted>')
    })

    it('renders usage stats and model name in collapsed view', () => {
      // With model
      const withModel = makeDetails({
        model: 'claude-sonnet-4',
        usage: {
          input: 2300,
          output: 1100,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0.0123,
          contextTokens: 0,
          turns: 7,
        },
      })
      const text1 = textOf(
        renderIterativeRetrievalResult(makeResult(withModel), false, theme),
      )
      expect(text1).toContain('7 turns')
      expect(text1).toContain('claude-sonnet-4')
      expect(text1).toContain('$0.0123')

      // Without model
      const noModel = makeDetails({
        usage: {
          input: 500,
          output: 200,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0.005,
          contextTokens: 0,
          turns: 3,
        },
      })
      const text2 = textOf(
        renderIterativeRetrievalResult(makeResult(noModel), false, theme),
      )
      expect(text2).toContain('3 turns')
      expect(text2).not.toContain('claude-sonnet-4')

      // Without usage entirely
      const noUsage = makeDetails({ model: 'gpt-4' })
      const text3 = textOf(
        renderIterativeRetrievalResult(makeResult(noUsage), false, theme),
      )
      expect(text3).not.toContain('turns')
    })

    it('renders display items (tool calls) when present', () => {
      const withItems = makeDetails({
        displayItems: [
          { type: 'toolCall', name: 'read', args: { path: 'src/auth.ts' } },
          { type: 'toolCall', name: 'grep', args: { pattern: 'jwt' } },
          { type: 'text', text: 'some text output' },
        ],
      })
      const text1 = textOf(
        renderIterativeRetrievalResult(makeResult(withItems), false, theme),
      )
      expect(text1).toContain('<muted>\u2192 </muted>')
      expect(text1).toContain('src/auth.ts')
      expect(text1).toContain('/jwt/')
      expect(text1).not.toContain('some text output')

      // Last 5 items only
      const manyItems = makeDetails({
        displayItems: [
          { type: 'toolCall', name: 'read', args: { path: 'a.ts' } },
          { type: 'toolCall', name: 'read', args: { path: 'b.ts' } },
          { type: 'toolCall', name: 'read', args: { path: 'c.ts' } },
          { type: 'toolCall', name: 'read', args: { path: 'd.ts' } },
          { type: 'toolCall', name: 'read', args: { path: 'e.ts' } },
          { type: 'toolCall', name: 'read', args: { path: 'f.ts' } },
          { type: 'toolCall', name: 'read', args: { path: 'g.ts' } },
        ],
      })
      const text2 = textOf(
        renderIterativeRetrievalResult(makeResult(manyItems), false, theme),
      )
      const arrowCount = (text2.match(/\u2192 /gu) ?? []).length
      expect(arrowCount).toBe(5)
      expect(text2).toContain('c.ts')
      expect(text2).toContain('g.ts')
      expect(text2).not.toContain('a.ts')

      // Empty displays nothing
      const empty = makeDetails({ displayItems: [] })
      const text3 = textOf(
        renderIterativeRetrievalResult(makeResult(empty), false, theme),
      )
      expect(text3).not.toContain('\u2192')
    })
  })

  describe('expanded', () => {
    it('returns a Container with header, task, output, and handles empty content', () => {
      const details = makeDetails()
      const rendered = renderIterativeRetrievalResult(
        makeResult(
          details,
          '## Relevant Paths\n- src/auth.ts (relevance: 0.9) — reason: auth',
        ),
        true,
        theme,
      )
      const children = childrenOf(rendered)

      // Header
      expect(isMockTextInstance(children[0])).toBe(true)
      expect(textOf(children[0])).toContain(
        '<toolTitle><bold>Iterative Retrieval</bold></toolTitle>',
      )
      // Spacers
      expect(children[1]).toMatchObject({ kind: 'Spacer', size: 1 })
      // Task section
      expect(textOf(children[2])).toContain('Task')
      expect(textOf(children[3])).toContain('test task')
      expect(children[4]).toMatchObject({ kind: 'Spacer', size: 1 })
      // Output section
      expect(textOf(children[5])).toContain('Output')
      expect(children[6]).toMatchObject({ kind: 'Spacer', size: 1 })
      // Markdown
      expect(children[7]).toMatchObject({
        kind: 'Markdown',
        text: '## Relevant Paths\n- src/auth.ts (relevance: 0.9) — reason: auth',
      })

      // Empty content -> (no output)
      const noContentResult = renderIterativeRetrievalResult(
        { content: [], details },
        true,
        theme,
      )
      const noContentChildren = childrenOf(noContentResult)
      const last = noContentChildren.at(-1)
      if (isMockTextInstance(last))
        expect(textOf(last)).toContain('(no output)')
    })

    it('renders retrieval steps and usage in expanded view', () => {
      const details = makeDetails({
        model: 'claude-sonnet-4',
        usage: {
          input: 2300,
          output: 1100,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0.0123,
          contextTokens: 0,
          turns: 7,
        },
        displayItems: [
          { type: 'toolCall', name: 'read', args: { path: 'src/auth.ts' } },
          { type: 'toolCall', name: 'grep', args: { pattern: 'jwt' } },
        ],
      })
      const rendered = renderIterativeRetrievalResult(
        makeResult(
          details,
          '## Relevant Paths\n- src/auth.ts (relevance: 0.9) — reason: auth',
        ),
        true,
        theme,
      )
      const children = childrenOf(rendered)

      // Retrieval steps header
      const stepsHeader = children.find(
        (child) =>
          isMockTextInstance(child) &&
          textOf(child).includes('Retrieval Steps'),
      )
      expect(stepsHeader).toBeDefined()
      if (isMockTextInstance(stepsHeader)) {
        expect(textOf(stepsHeader)).toContain(
          '<muted>\u2500\u2500\u2500 Retrieval Steps \u2500\u2500\u2500</muted>',
        )
      }

      // Two arrow-prefixed tool call texts
      const toolCallTexts = children.filter(
        (child) =>
          isMockTextInstance(child) && textOf(child).includes('\u2192'),
      )
      expect(toolCallTexts.length).toBe(2)

      // Usage with model
      const usageChild = children.find(
        (child) =>
          isMockTextInstance(child) &&
          textOf(child).includes('claude-sonnet-4'),
      )
      expect(usageChild).toBeDefined()
      if (isMockTextInstance(usageChild)) {
        expect(textOf(usageChild)).toContain('7 turns')
        expect(textOf(usageChild)).toContain('$0.0123')
      }

      // Empty display items -> no retrieval steps
      const empty = makeDetails({ displayItems: [] })
      expect(
        childrenOf(
          renderIterativeRetrievalResult(
            makeResult(
              empty,
              '## Relevant Paths\n- src/auth.ts (relevance: 0.9)',
            ),
            true,
            theme,
          ),
        ).find(
          (c) => isMockTextInstance(c) && textOf(c).includes('Retrieval Steps'),
        ),
      ).toBeUndefined()

      // No usage -> no usage text
      const noUsage = makeDetails()
      expect(
        childrenOf(
          renderIterativeRetrievalResult(
            makeResult(
              noUsage,
              '## Relevant Paths\n- src/auth.ts (relevance: 0.9)',
            ),
            true,
            theme,
          ),
        ).find((c) => isMockTextInstance(c) && textOf(c).includes('turns')),
      ).toBeUndefined()
    })
  })

  describe('error cases', () => {
    it('renders error text when details absent', () => {
      const rendered = renderIterativeRetrievalResult(
        makeResult(),
        false,
        theme,
      )
      expect(textOf(rendered)).toBe(
        '## Relevant Paths\n- src/auth.ts (relevance: 0.9)',
      )
    })

    it('renders empty error when no text content', () => {
      const result: AgentToolResult<IterativeRetrievalDetails | undefined> = {
        content: [],
        details: undefined,
      }
      const rendered = renderIterativeRetrievalResult(result, false, theme)
      expect(textOf(rendered)).toBe('')
    })

    it('falls back to error text when details are invalid shape', () => {
      const rendered = renderIterativeRetrievalResult(
        { content: [{ type: 'text', text: 'bad details' }], details: {} },
        false,
        theme,
      )
      expect(textOf(rendered)).toBe('bad details')
    })
  })
})
