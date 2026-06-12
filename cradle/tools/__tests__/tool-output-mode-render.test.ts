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

function makeResult(details?: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text', text: 'tool output' }],
    details,
  }
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

const collapsedOptions = { expanded: false, isPartial: false }
const partialOptions = { expanded: false, isPartial: true }

describe('tool output mode renderers', () => {
  it('renders default tools in hidden mode', () => {
    setToolOutputModeForTests('hidden')

    expect(
      bashTool.renderResult?.(
        makeResult(),
        collapsedOptions,
        mockTheme,
        makeContext({ command: 'echo hello' }),
      ),
    ).toBeDefined()
    expect(
      readTool.renderResult?.(
        makeResult(),
        collapsedOptions,
        mockTheme,
        makeContext({ path: 'README.md' }),
      ),
    ).toBeDefined()
    expect(
      editTool.renderResult?.(
        makeResult(),
        collapsedOptions,
        mockTheme,
        makeContext({ path: 'README.md' }),
      ),
    ).toBeDefined()
    expect(
      writeTool.renderResult?.(
        makeResult(),
        collapsedOptions,
        mockTheme,
        makeContext({ path: 'README.md' }),
      ),
    ).toBeDefined()
    expect(
      grepTool.renderResult?.(
        makeResult(),
        collapsedOptions,
        mockTheme,
        makeContext({ pattern: 'needle' }),
      ),
    ).toBeDefined()
    expect(
      globTool.renderResult?.(
        makeResult(),
        collapsedOptions,
        mockTheme,
        makeContext({ pattern: '**/*.ts' }),
      ),
    ).toBeDefined()
    expect(
      lsTool.renderResult?.(
        makeResult(),
        collapsedOptions,
        mockTheme,
        makeContext({ path: '.' }),
      ),
    ).toBeDefined()
  })

  it('renders default tools in preview mode', () => {
    setToolOutputModeForTests('preview')

    expect(
      bashTool.renderResult?.(
        makeResult(),
        collapsedOptions,
        mockTheme,
        makeContext({ command: 'echo hello' }),
      ),
    ).toBeDefined()
    expect(
      readTool.renderResult?.(
        makeResult(),
        collapsedOptions,
        mockTheme,
        makeContext({ path: 'README.md' }),
      ),
    ).toBeDefined()
    expect(
      editTool.renderResult?.(
        makeResult(),
        collapsedOptions,
        mockTheme,
        makeContext({ path: 'README.md' }),
      ),
    ).toBeDefined()
    expect(
      writeTool.renderResult?.(
        makeResult(),
        collapsedOptions,
        mockTheme,
        makeContext({ path: 'README.md' }),
      ),
    ).toBeDefined()
    expect(
      grepTool.renderResult?.(
        makeResult(),
        collapsedOptions,
        mockTheme,
        makeContext({ pattern: 'needle' }),
      ),
    ).toBeDefined()
    expect(
      globTool.renderResult?.(
        makeResult(),
        collapsedOptions,
        mockTheme,
        makeContext({ pattern: '**/*.ts' }),
      ),
    ).toBeDefined()
    expect(
      lsTool.renderResult?.(
        makeResult(),
        collapsedOptions,
        mockTheme,
        makeContext({ path: '.' }),
      ),
    ).toBeDefined()
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
