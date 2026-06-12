import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { Theme, type ThemeColor } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import { setToolOutputModeForTests } from '../../config/settings.js'
import { advisorTool } from '../advisor.js'
import { bashTool } from '../bash.js'
import { councilTool } from '../council.js'
import { editTool } from '../edit.js'
import { globTool } from '../glob.js'
import { grepTool } from '../grep.js'
import { iterativeRetrievalTool } from '../iterative-retrieval/index.js'
import { lsTool } from '../ls.js'
import { readTool } from '../read.js'
import { subagentTool } from '../subagent.js'
import { todoTool } from '../todo.js'
import { webFetchInternalTool } from '../webfetch/index.js'
import { webSearchInternalTool } from '../websearch/index.js'
import { writeTool } from '../write.js'

const fgColors: Record<ThemeColor, string> = {
  accent: '#ffffff',
  border: '#ffffff',
  borderAccent: '#ffffff',
  borderMuted: '#ffffff',
  success: '#ffffff',
  error: '#ffffff',
  warning: '#ffffff',
  muted: '#ffffff',
  dim: '#ffffff',
  text: '#ffffff',
  thinkingText: '#ffffff',
  userMessageText: '#ffffff',
  customMessageText: '#ffffff',
  customMessageLabel: '#ffffff',
  toolTitle: '#ffffff',
  toolOutput: '#ffffff',
  mdHeading: '#ffffff',
  mdLink: '#ffffff',
  mdLinkUrl: '#ffffff',
  mdCode: '#ffffff',
  mdCodeBlock: '#ffffff',
  mdCodeBlockBorder: '#ffffff',
  mdQuote: '#ffffff',
  mdQuoteBorder: '#ffffff',
  mdHr: '#ffffff',
  mdListBullet: '#ffffff',
  toolDiffAdded: '#ffffff',
  toolDiffRemoved: '#ffffff',
  toolDiffContext: '#ffffff',
  syntaxComment: '#ffffff',
  syntaxKeyword: '#ffffff',
  syntaxFunction: '#ffffff',
  syntaxVariable: '#ffffff',
  syntaxString: '#ffffff',
  syntaxNumber: '#ffffff',
  syntaxType: '#ffffff',
  syntaxOperator: '#ffffff',
  syntaxPunctuation: '#ffffff',
  thinkingOff: '#ffffff',
  thinkingMinimal: '#ffffff',
  thinkingLow: '#ffffff',
  thinkingMedium: '#ffffff',
  thinkingHigh: '#ffffff',
  thinkingXhigh: '#ffffff',
  bashMode: '#ffffff',
}

const mockTheme = new Theme(
  fgColors,
  {
    selectedBg: '#000000',
    userMessageBg: '#000000',
    customMessageBg: '#000000',
    toolPendingBg: '#000000',
    toolSuccessBg: '#000000',
    toolErrorBg: '#000000',
  },
  'truecolor',
)

function makeTextResult(
  text: string,
  details?: unknown,
): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text', text }],
    details,
  }
}

function makeResult(details?: unknown): AgentToolResult<unknown> {
  return makeTextResult('tool output', details)
}

function makeLongResult(): AgentToolResult<unknown> {
  return makeTextResult(
    ['line 1', 'line 2', 'line 3', 'line 4', 'line 5', 'line 6', 'line 7'].join(
      '\n',
    ),
  )
}

function makeContext(args: Record<string, unknown>, isError = false) {
  return {
    args,
    toolCallId: 'call_1',
    invalidate() {
      return
    },
    lastComponent: undefined,
    state: {},
    cwd: process.cwd(),
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    showImages: false,
    isError,
  }
}

function expectRendered(component: unknown): void {
  expect(component).toBeDefined()
}

interface Renderable {
  render(width: number): string[]
}

function renderLines(component: Renderable | undefined): string[] {
  expect(component).toBeDefined()
  return component?.render(80) ?? []
}

function expectEmptyRender(component: Renderable | undefined): void {
  expect(renderLines(component)).toHaveLength(0)
}

function expectHiddenDefaultTool(
  renderCall: () => unknown,
  renderResult: () => Renderable | undefined,
): void {
  expectRendered(renderCall())
  expectEmptyRender(renderResult())
}

const collapsedOptions = { expanded: false, isPartial: false }
const partialOptions = { expanded: false, isPartial: true }

describe('tool output mode renderers', () => {
  it('renders default tool calls and suppresses result bodies in hidden mode', () => {
    setToolOutputModeForTests('hidden')

    expectHiddenDefaultTool(
      () =>
        bashTool.renderCall?.(
          { command: 'echo hello', riskLevel: 'low', riskReason: 'test' },
          mockTheme,
          makeContext({ command: 'echo hello' }),
        ),
      () =>
        bashTool.renderResult?.(
          makeResult(),
          collapsedOptions,
          mockTheme,
          makeContext({ command: 'echo hello' }),
        ),
    )

    expectHiddenDefaultTool(
      () =>
        readTool.renderCall?.(
          { path: 'README.md' },
          mockTheme,
          makeContext({ path: 'README.md' }),
        ),
      () =>
        readTool.renderResult?.(
          makeResult(),
          collapsedOptions,
          mockTheme,
          makeContext({ path: 'README.md' }),
        ),
    )

    expectHiddenDefaultTool(
      () =>
        editTool.renderCall?.(
          { path: 'README.md', edits: [] },
          mockTheme,
          makeContext({ path: 'README.md' }),
        ),
      () =>
        editTool.renderResult?.(
          makeResult(),
          collapsedOptions,
          mockTheme,
          makeContext({ path: 'README.md' }),
        ),
    )

    expectHiddenDefaultTool(
      () =>
        writeTool.renderCall?.(
          { path: 'README.md', content: 'content' },
          mockTheme,
          makeContext({ path: 'README.md' }),
        ),
      () =>
        writeTool.renderResult?.(
          makeResult(),
          collapsedOptions,
          mockTheme,
          makeContext({ path: 'README.md' }),
        ),
    )

    expectHiddenDefaultTool(
      () =>
        grepTool.renderCall?.(
          { pattern: 'needle' },
          mockTheme,
          makeContext({ pattern: 'needle' }),
        ),
      () =>
        grepTool.renderResult?.(
          makeResult(),
          collapsedOptions,
          mockTheme,
          makeContext({ pattern: 'needle' }),
        ),
    )

    expectHiddenDefaultTool(
      () =>
        globTool.renderCall?.(
          { pattern: '**/*.ts' },
          mockTheme,
          makeContext({ pattern: '**/*.ts' }),
        ),
      () =>
        globTool.renderResult?.(
          makeResult(),
          collapsedOptions,
          mockTheme,
          makeContext({ pattern: '**/*.ts' }),
        ),
    )

    expectHiddenDefaultTool(
      () =>
        lsTool.renderCall?.(
          { path: '.' },
          mockTheme,
          makeContext({ path: '.' }),
        ),
      () =>
        lsTool.renderResult?.(
          makeResult(),
          collapsedOptions,
          mockTheme,
          makeContext({ path: '.' }),
        ),
    )
  })

  it('renders default tools with preview output unless full mode is selected', () => {
    const result = makeLongResult()
    const renderBashResult = () =>
      bashTool.renderResult?.(
        result,
        collapsedOptions,
        mockTheme,
        makeContext({ command: 'echo hello' }),
      )

    setToolOutputModeForTests('preview')
    const previewLines = renderLines(renderBashResult())
    expect(previewLines).toHaveLength(6)
    expect(previewLines.join('\n')).toContain('line 5')
    expect(previewLines.join('\n')).not.toContain('line 6')
    expect(previewLines.join('\n')).toContain('+2 lines')

    setToolOutputModeForTests('full')
    const fullLines = renderLines(renderBashResult())
    expect(fullLines).toHaveLength(7)
    expect(fullLines.join('\n')).toContain('line 7')

    expect(editTool.renderShell).toBe('default')
  })

  it('renders custom tools in header-only and hidden modes', () => {
    setToolOutputModeForTests('header-only')

    for (const tool of [
      subagentTool,
      advisorTool,
      councilTool,
      webFetchInternalTool,
      webSearchInternalTool,
      iterativeRetrievalTool,
    ]) {
      expect(
        tool.renderResult?.(
          makeResult(),
          collapsedOptions,
          mockTheme,
          makeContext({}, true),
        ),
      ).toBeDefined()
    }

    setToolOutputModeForTests('hidden')

    for (const tool of [
      subagentTool,
      advisorTool,
      councilTool,
      webFetchInternalTool,
      webSearchInternalTool,
      iterativeRetrievalTool,
    ]) {
      expect(
        tool.renderResult?.(
          makeResult(),
          collapsedOptions,
          mockTheme,
          makeContext({}),
        ),
      ).toBeDefined()
    }
  })

  it('renders todo output modes', () => {
    const todoDetails = {
      todos: [{ id: 1, description: 'Task', status: 'pending' as const }],
      changed: [],
    }
    const result: AgentToolResult<typeof todoDetails> = {
      content: [{ type: 'text', text: '1. [pending] Task' }],
      details: todoDetails,
    }

    setToolOutputModeForTests('header-only')
    expect(
      todoTool.renderResult?.(
        result,
        collapsedOptions,
        mockTheme,
        makeContext({}),
      ),
    ).toBeDefined()
    expect(
      todoTool.renderResult?.(
        result,
        partialOptions,
        mockTheme,
        makeContext({}),
      ),
    ).toBeDefined()

    setToolOutputModeForTests('hidden')
    expect(
      todoTool.renderResult?.(
        result,
        collapsedOptions,
        mockTheme,
        makeContext({}, true),
      ),
    ).toBeDefined()

    setToolOutputModeForTests('preview')
    expect(
      todoTool.renderResult?.(
        result,
        collapsedOptions,
        mockTheme,
        makeContext({}),
      ),
    ).toBeDefined()
  })
})
