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
  })

  describe('expanded', () => {
    it('returns a Container with header, task, and markdown output', () => {
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

      // Header Text
      const headerText = children[0]
      expect(isMockTextInstance(headerText)).toBe(true)
      expect(textOf(headerText)).toContain('<success>\u2713</success>')
      expect(textOf(headerText)).toContain(
        '<toolTitle><bold>Iterative Retrieval</bold></toolTitle>',
      )

      // Spacer(1) after header
      const spacer1 = children[1]
      expect(spacer1).toMatchObject({ kind: 'Spacer', size: 1 })

      // "─── Task ───" Text
      const taskHeader = children[2]
      expect(isMockTextInstance(taskHeader)).toBe(true)
      expect(textOf(taskHeader)).toContain(
        '<muted>\u2500\u2500\u2500 Task \u2500\u2500\u2500</muted>',
      )

      // Task text
      const taskText = children[3]
      expect(isMockTextInstance(taskText)).toBe(true)
      expect(textOf(taskText)).toContain('<dim>test task</dim>')

      // Spacer(1) after task section
      const spacer2 = children[4]
      expect(spacer2).toMatchObject({ kind: 'Spacer', size: 1 })

      // "─── Output ───" Text
      const outputHeader = children[5]
      expect(isMockTextInstance(outputHeader)).toBe(true)
      expect(textOf(outputHeader)).toContain(
        '<muted>\u2500\u2500\u2500 Output \u2500\u2500\u2500</muted>',
      )

      // Spacer(1) before Markdown
      const spacer3 = children[6]
      expect(spacer3).toMatchObject({ kind: 'Spacer', size: 1 })

      // Markdown output
      const markdown = children[7]
      expect(markdown).toMatchObject({
        kind: 'Markdown',
        text: '## Relevant Paths\n- src/auth.ts (relevance: 0.9) — reason: auth',
        x: 0,
        y: 0,
      })
    })

    it('shows (no output) when content is empty', () => {
      const details = makeDetails()
      const rendered = renderIterativeRetrievalResult(
        {
          content: [],
          details,
        },
        true,
        theme,
      )
      const children = childrenOf(rendered)

      // Last child should be the no-output Text
      const lastChild = children.at(-1)
      expect(isMockTextInstance(lastChild)).toBe(true)
      expect(textOf(lastChild)).toContain('<muted>(no output)</muted>')
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
