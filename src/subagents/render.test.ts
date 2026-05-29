import os from 'node:os'
import path from 'node:path'

import { getMarkdownTheme } from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildChainResultCollapsed,
  buildChainResultExpanded,
  buildParallelResultCollapsed,
  buildParallelResultExpanded,
  buildSingleResultCollapsed,
  buildSingleResultExpanded,
} from './render.js'
import type { SingleResult, SubagentDetails, UsageStats } from './types.js'

const mocks = vi.hoisted(() => ({
  markdownTheme: { kind: 'markdown-theme' },
}))

interface MockContainerInstance {
  kind: 'Container'
  children: unknown[]
}

interface MockTextInstance {
  kind: 'Text'
  text: string
}

interface MockMarkdownInstance {
  kind: 'Markdown'
  text: string
  theme: unknown
}

interface MockSpacerInstance {
  kind: 'Spacer'
  size: number
}

vi.mock('@earendil-works/pi-coding-agent', () => ({
  getMarkdownTheme: vi.fn(() => mocks.markdownTheme),
}))

vi.mock('@earendil-works/pi-tui', () => ({
  Container: class MockContainer {
    kind = 'Container'
    children: unknown[] = []

    addChild(child: unknown): void {
      this.children.push(child)
    }
  },
  Markdown: class MockMarkdown {
    kind = 'Markdown'
    text: string
    x: number
    y: number
    theme: unknown

    constructor(text: string, x: number, y: number, theme: unknown) {
      this.text = text
      this.x = x
      this.y = y
      this.theme = theme
    }
  },
  Spacer: class MockSpacer {
    kind = 'Spacer'
    size: number

    constructor(size: number) {
      this.size = size
    }
  },
  Text: class MockText {
    kind = 'Text'
    text: string
    x: number
    y: number

    constructor(text: string, x: number, y: number) {
      this.text = text
      this.x = x
      this.y = y
    }
  },
}))

const theme = {
  bold: vi.fn((text: string) => `<bold>${text}</bold>`),
  fg: vi.fn((color: string, text: string) => `<${color}>${text}</${color}>`),
}

function makeUsage(overrides: Partial<UsageStats> = {}): UsageStats {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    contextTokens: 0,
    turns: 0,
    ...overrides,
  }
}

function isTestMessage(
  value: unknown,
): value is SingleResult['messages'][number] {
  return (
    typeof value === 'object' &&
    value !== null &&
    'role' in value &&
    value.role === 'assistant' &&
    'content' in value &&
    Array.isArray(value.content)
  )
}

function isTestMessages(value: unknown): value is SingleResult['messages'] {
  return (
    Array.isArray(value) && value.every((message) => isTestMessage(message))
  )
}

function makeMessages(...content: unknown[]): SingleResult['messages'] {
  const messages = [{ role: 'assistant', content }]
  if (isTestMessages(messages)) return messages
  throw new TypeError('Expected test messages')
}

function makeTextMessages(count: number): SingleResult['messages'] {
  const messages = Array.from({ length: count }, (_, index) => ({
    role: 'assistant',
    content: [{ type: 'text', text: `item ${index + 1}` }],
  }))
  if (isTestMessages(messages)) return messages
  throw new TypeError('Expected test messages')
}

function makeResult(overrides: Partial<SingleResult> = {}): SingleResult {
  return {
    agent: 'reviewer',
    agentSource: 'project',
    task: 'Review the implementation',
    exitCode: 0,
    messages: [],
    stderr: '',
    usage: makeUsage(),
    ...overrides,
  }
}

function makeDetails(
  mode: SubagentDetails['mode'],
  results: SingleResult[],
): SubagentDetails {
  return { mode, agentScope: 'both', projectAgentsDir: undefined, results }
}

function isMockContainer(value: unknown): value is MockContainerInstance {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'Container' &&
    'children' in value &&
    Array.isArray(value.children)
  )
}

function isMockText(value: unknown): value is MockTextInstance {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'Text' &&
    'text' in value &&
    typeof value.text === 'string'
  )
}

function isMockMarkdown(value: unknown): value is MockMarkdownInstance {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'Markdown' &&
    'text' in value &&
    typeof value.text === 'string'
  )
}

function isMockSpacer(value: unknown): value is MockSpacerInstance {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'Spacer' &&
    'size' in value &&
    typeof value.size === 'number'
  )
}

function asMockContainer(value: unknown): MockContainerInstance {
  if (isMockContainer(value)) return value
  throw new TypeError('Expected mock container')
}

function asMockText(value: unknown): MockTextInstance {
  if (isMockText(value)) return value
  throw new TypeError('Expected mock text')
}

function getTextChildren(container: unknown): string[] {
  return asMockContainer(container)
    .children.filter(isMockText)
    .map((child) => child.text)
}

function getMarkdownChildren(container: unknown): MockMarkdownInstance[] {
  return asMockContainer(container).children.filter(isMockMarkdown)
}

describe('subagent render builders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('buildSingleResultExpanded', () => {
    it('renders a successful expanded result with task, tool call, markdown output, and usage', () => {
      const sourcePath = path.join(os.tmpdir(), 'source.ts')
      const result = makeResult({
        agent: 'coder',
        agentSource: 'user',
        messages: makeMessages(
          {
            type: 'toolCall',
            name: 'read',
            arguments: { path: sourcePath, offset: 2, limit: 3 },
          },
          { type: 'text', text: '  final answer  ' },
        ),
        model: 'claude-sonnet-4',
        usage: makeUsage({ input: 1200, output: 345, cost: 0.01, turns: 1 }),
      })

      const rendered = buildSingleResultExpanded(result, theme)
      const container = asMockContainer(rendered)
      const texts = getTextChildren(rendered)
      const markdown = getMarkdownChildren(rendered)

      expect(getMarkdownTheme).toHaveBeenCalledTimes(1)
      expect(container.children.some((child) => isMockSpacer(child))).toBe(true)
      expect(texts[0]).toBe(
        '<success>✓</success> <toolTitle><bold>coder</bold></toolTitle><muted> (user)</muted>',
      )
      expect(texts).toContain('<muted>─── Task ───</muted>')
      expect(texts).toContain('<dim>Review the implementation</dim>')
      expect(texts).toContain('<muted>─── Output ───</muted>')
      expect(texts).toContain(
        `<muted>→ </muted><muted>read </muted><accent>${sourcePath}</accent><warning>:2-4</warning>`,
      )
      expect(markdown).toEqual([
        {
          kind: 'Markdown',
          text: 'final answer',
          x: 0,
          y: 0,
          theme: mocks.markdownTheme,
        },
      ])
      expect(texts).toContain(
        '<dim>1 turn ↑1.2k ↓345 $0.0100 claude-sonnet-4</dim>',
      )
    })

    it('renders expanded error details and a no-output placeholder', () => {
      const result = makeResult({
        exitCode: 1,
        stopReason: 'error',
        errorMessage: 'Tool failed',
        messages: [],
      })

      const texts = getTextChildren(buildSingleResultExpanded(result, theme))

      expect(texts[0]).toContain('<error>✗</error>')
      expect(texts[0]).toContain('<error>[error]</error>')
      expect(texts).toContain('<error>Error: Tool failed</error>')
      expect(texts).toContain('<muted>(no output)</muted>')
    })
  })

  describe('buildSingleResultCollapsed', () => {
    it('renders collapsed output previews with skipped items, usage, and expand hint', () => {
      const result = makeResult({
        messages: makeTextMessages(11),
        model: 'opus',
        usage: makeUsage({
          input: 10_000,
          output: 2500,
          cacheRead: 50,
          cacheWrite: 25,
          contextTokens: 1_500_000,
          turns: 2,
        }),
      })

      const text = asMockText(buildSingleResultCollapsed(result, theme)).text

      expect(text).toContain('<success>✓</success>')
      expect(text).toContain('<muted>... 1 earlier items\n</muted>')
      expect(text).not.toContain('item 1\n')
      expect(text).toContain('<toolOutput>item 2</toolOutput>')
      expect(text).toContain('<toolOutput>item 11</toolOutput>')
      expect(text).toContain('<muted>(Ctrl+O to expand)</muted>')
      expect(text).toContain(
        '<dim>2 turns ↑10k ↓2.5k R50 W25 ctx:1.5M opus</dim>',
      )
    })

    it('truncates multiline text previews in collapsed output', () => {
      const result = makeResult({
        messages: makeMessages({
          type: 'text',
          text: 'line 1\nline 2\nline 3\nline 4',
        }),
      })

      const text = asMockText(buildSingleResultCollapsed(result, theme)).text

      expect(text).toContain('<toolOutput>line 1\nline 2\nline 3</toolOutput>')
      expect(text).not.toContain('line 4')
    })

    it('renders no-output and error-message collapsed branches', () => {
      const noOutput = asMockText(
        buildSingleResultCollapsed(makeResult(), theme),
      ).text
      const error = asMockText(
        buildSingleResultCollapsed(
          makeResult({
            exitCode: 0,
            stopReason: 'aborted',
            errorMessage: 'User aborted',
          }),
          theme,
        ),
      ).text

      expect(noOutput).toContain('<muted>(no output)</muted>')
      expect(error).toContain('<error>✗</error>')
      expect(error).toContain('<error>[aborted]</error>')
      expect(error).toContain('<error>Error: User aborted</error>')
    })
  })

  describe('buildChainResultExpanded', () => {
    it('renders each chain step with per-step output and aggregate usage', () => {
      const first = makeResult({
        agent: 'planner',
        step: 1,
        task: 'Plan it',
        messages: makeMessages({ type: 'text', text: 'Plan complete' }),
        usage: makeUsage({ input: 100, output: 20, turns: 1 }),
      })
      const second = makeResult({
        agent: 'coder',
        step: 2,
        task: 'Build it',
        messages: makeMessages(
          {
            type: 'toolCall',
            name: 'bash',
            arguments: { command: 'pnpm test' },
          },
          { type: 'text', text: 'Tests pass' },
        ),
        usage: makeUsage({ input: 200, output: 30, cost: 0.02 }),
      })

      const rendered = buildChainResultExpanded(
        makeDetails('chain', [first, second]),
        theme,
      )
      const texts = getTextChildren(rendered)
      const markdown = getMarkdownChildren(rendered)

      expect(texts[0]).toBe(
        '<success>✓</success> <toolTitle><bold>chain </bold></toolTitle><accent>2/2 steps</accent>',
      )
      expect(texts).toContain(
        '<muted>─── Step 1: </muted><accent>planner</accent> <success>✓</success>',
      )
      expect(texts).toContain('<muted>Task: </muted><dim>Plan it</dim>')
      expect(texts).toContain(
        '<muted>─── Step 2: </muted><accent>coder</accent> <success>✓</success>',
      )
      expect(texts).toContain(
        '<muted>→ </muted><muted>$ </muted><toolOutput>pnpm test</toolOutput>',
      )
      expect(markdown.map((child) => child.text)).toEqual([
        'Plan complete',
        'Tests pass',
      ])
      expect(texts).toContain('<dim>Total: 1 turn ↑300 ↓50 $0.0200</dim>')
    })
  })

  describe('buildChainResultCollapsed', () => {
    it('renders failed chain status, step placeholders, aggregate usage, and expand hint', () => {
      const success = makeResult({
        agent: 'planner',
        step: 1,
        messages: makeMessages({ type: 'text', text: 'ready' }),
        usage: makeUsage({ input: 10 }),
      })
      const failure = makeResult({
        agent: 'tester',
        step: 2,
        exitCode: 1,
        messages: [],
        usage: makeUsage({ output: 5 }),
      })

      const text = asMockText(
        buildChainResultCollapsed(
          makeDetails('chain', [success, failure]),
          theme,
        ),
      ).text

      expect(text).toContain(
        '<error>✗</error> <toolTitle><bold>chain </bold></toolTitle><accent>1/2 steps</accent>',
      )
      expect(text).toContain(
        '<muted>─── Step 1: </muted><accent>planner</accent> <success>✓</success>',
      )
      expect(text).toContain('<toolOutput>ready</toolOutput>')
      expect(text).toContain(
        '<muted>─── Step 2: </muted><accent>tester</accent> <error>✗</error>',
      )
      expect(text).toContain('<muted>(no output)</muted>')
      expect(text).toContain('<dim>Total: ↑10 ↓5</dim>')
      expect(text).toContain('<muted>(Ctrl+O to expand)</muted>')
    })
  })

  describe('buildParallelResultExpanded', () => {
    it('renders parallel headings and treats running expanded results as failed', () => {
      const running = makeResult({
        agent: 'lint',
        task: 'Run lint',
        exitCode: -1,
        messages: [],
      })
      const done = makeResult({
        agent: 'test',
        task: 'Run tests',
        messages: makeMessages({ type: 'text', text: 'green' }),
        usage: makeUsage({ turns: 1 }),
      })

      const texts = getTextChildren(
        buildParallelResultExpanded(
          makeDetails('parallel', [running, done]),
          theme,
        ),
      )

      expect(texts[0]).toBe(
        '<warning>⏳</warning> <toolTitle><bold>parallel </bold></toolTitle><accent>1/2 done, 1 running</accent>',
      )
      expect(texts).toContain(
        '<muted>─── </muted><accent>lint</accent> <error>✗</error>',
      )
      expect(texts).toContain('<muted>Task: </muted><dim>Run lint</dim>')
      expect(texts).toContain(
        '<muted>─── </muted><accent>test</accent> <success>✓</success>',
      )
      expect(texts).toContain('<dim>Total: 1 turn</dim>')
    })
  })

  describe('buildParallelResultCollapsed', () => {
    it('renders running summary, running placeholder, and omits aggregate usage while running', () => {
      const done = makeResult({
        agent: 'docs',
        messages: makeMessages({ type: 'text', text: 'documented' }),
        usage: makeUsage({ input: 100 }),
      })
      const running = makeResult({
        agent: 'lint',
        exitCode: -1,
        messages: [],
        usage: makeUsage({ output: 50 }),
      })

      const text = asMockText(
        buildParallelResultCollapsed(
          makeDetails('parallel', [done, running]),
          theme,
        ),
      ).text

      expect(text).toContain(
        '<warning>⏳</warning> <toolTitle><bold>parallel </bold></toolTitle><accent>1/2 done, 1 running</accent>',
      )
      expect(text).toContain(
        '<muted>─── </muted><accent>docs</accent> <success>✓</success>',
      )
      expect(text).toContain('<toolOutput>documented</toolOutput>')
      expect(text).toContain(
        '<muted>─── </muted><accent>lint</accent> <warning>⏳</warning>',
      )
      expect(text).toContain('<muted>(running...)</muted>')
      expect(text).not.toContain('Total:')
      expect(text).toContain('<muted>(Ctrl+O to expand)</muted>')
    })

    it('renders partial failure and success summaries with aggregate usage when complete', () => {
      const failure = makeResult({
        agent: 'review',
        exitCode: 1,
        messages: [],
        usage: makeUsage({ input: 25 }),
      })
      const success = makeResult({
        agent: 'build',
        messages: makeMessages({ type: 'text', text: 'built' }),
        usage: makeUsage({ output: 75 }),
      })
      const allSuccess = makeDetails('parallel', [success])

      const partialText = asMockText(
        buildParallelResultCollapsed(
          makeDetails('parallel', [failure, success]),
          theme,
        ),
      ).text
      const successText = asMockText(
        buildParallelResultCollapsed(allSuccess, theme),
      ).text

      expect(partialText).toContain(
        '<warning>◐</warning> <toolTitle><bold>parallel </bold></toolTitle><accent>1/2 tasks</accent>',
      )
      expect(partialText).toContain('<muted>(no output)</muted>')
      expect(partialText).toContain('<dim>Total: ↑25 ↓75</dim>')
      expect(successText).toContain(
        '<success>✓</success> <toolTitle><bold>parallel </bold></toolTitle><accent>1/1 tasks</accent>',
      )
    })
  })
})
