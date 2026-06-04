import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { advisorTool } from '../../advisor.js'
import { runAdvisor } from '../runner.js'

vi.mock('../runner.js', () => ({
  runAdvisor: vi.fn(),
}))

vi.mock('@earendil-works/pi-coding-agent', () => ({
  defineTool: vi.fn(
    <Definition>(definition: Definition): Definition => definition,
  ),
}))

const confirmMock = vi.fn((_title: string, _body: string) =>
  Promise.resolve(true),
)

function makeContext(): ExtensionContext {
  return {
    cwd: '/repo',
    hasUI: false,
    // @ts-expect-error minimal UI mock
    ui: { confirm: confirmMock },
  }
}

describe('advisorTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('executes with valid parameters', async () => {
    vi.mocked(runAdvisor).mockResolvedValue({
      output: 'some advice',
      result: {
        agent: 'advisor',
        agentSource: 'extension',
        exitCode: 0,
        messages: [],
        stderr: '',
        task: 'test',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0,
          contextTokens: 0,
          turns: 0,
        },
      },
    })

    const result = await advisorTool.execute(
      'call-1',
      { context: 'I need help' },
      undefined,
      undefined,
      makeContext(),
    )

    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: 'some advice',
    })
    expect(runAdvisor).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'I need help',
        cwd: '/repo',
      }),
    )
  })

  it('executes with files parameter', async () => {
    vi.mocked(runAdvisor).mockResolvedValue({
      output: 'advice with files',
      result: {
        agent: 'advisor',
        agentSource: 'extension',
        exitCode: 0,
        messages: [],
        stderr: '',
        task: 'test',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0,
          contextTokens: 0,
          turns: 0,
        },
      },
    })

    const result = await advisorTool.execute(
      'call-1',
      {
        context: 'I need help',
        files: ['cradle/index.ts', 'cradle/lib.ts'],
      },
      undefined,
      undefined,
      makeContext(),
    )

    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: 'advice with files',
    })
    expect(runAdvisor).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'I need help',
        files: ['cradle/index.ts', 'cradle/lib.ts'],
      }),
    )
  })

  it('returns error when parameters are invalid', async () => {
    const result = await advisorTool.execute(
      'call-1',
      {},
      undefined,
      undefined,
      makeContext(),
    )

    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Invalid parameters'),
    })
    expect(runAdvisor).not.toHaveBeenCalled()
  })

  it('returns error when runAdvisor throws', async () => {
    vi.mocked(runAdvisor).mockRejectedValue(
      new Error('Advisor model not configured'),
    )

    const result = await advisorTool.execute(
      'call-1',
      { context: 'I need help' },
      undefined,
      undefined,
      makeContext(),
    )

    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: 'Advisor error: Advisor model not configured',
    })
  })

  it('renders call with valid parameters', () => {
    const theme = {
      bold: (text: string) => text,
      fg: (_color: string, text: string) => text,
    }
    const options = { expanded: true, isPartial: false }
    const result = {
      content: [{ type: 'text' as const, text: 'advice' }],
      details: {
        mode: 'single' as const,
        projectAgentsDir: undefined,
        results: [],
      },
    }

    expect(
      // @ts-expect-error minimal context mock
      advisorTool.renderCall?.({ context: 'Help' }, theme, {}),
    ).toBeDefined()
    expect(
      // @ts-expect-error minimal context mock
      advisorTool.renderResult?.(result, options, theme, {}),
    ).toBeDefined()
  })

  it('renders call with invalid parameters', () => {
    const theme = {
      bold: (text: string) => text,
      fg: (_color: string, text: string) => text,
    }

    expect(
      // @ts-expect-error minimal context mock
      advisorTool.renderCall?.({}, theme, {}),
    ).toBeDefined()
  })
})
