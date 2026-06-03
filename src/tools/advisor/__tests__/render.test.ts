import type { Message } from '@earendil-works/pi-ai'
import { Text } from '@earendil-works/pi-tui'
import { describe, expect, it } from 'vitest'
import { buildAdvisorRenderCall, buildAdvisorRenderResult } from '../render.js'

const theme = {
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
}

function makeMessage(text: string): Message {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'test',
    provider: 'test',
    model: 'test',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: 0,
  }
}

describe('buildAdvisorRenderCall', () => {
  it('renders basic call', () => {
    const result = buildAdvisorRenderCall({ context: 'Help with bug' }, theme)
    expect(result).toBeInstanceOf(Text)
  })

  it('renders call with files', () => {
    const result = buildAdvisorRenderCall(
      { context: 'Help with bug', files: ['a.ts', 'b.ts'] },
      theme,
    )
    expect(result).toBeInstanceOf(Text)
  })
})

describe('buildAdvisorRenderResult', () => {
  it('renders fallback for empty result', () => {
    const result = buildAdvisorRenderResult(
      { content: [], details: undefined },
      false,
      theme,
    )
    expect(result).toBeInstanceOf(Text)
  })

  it('renders expanded result', () => {
    const result = buildAdvisorRenderResult(
      {
        content: [{ type: 'text', text: 'advice' }],
        details: {
          mode: 'single',
          projectAgentsDir: undefined,
          results: [
            {
              agent: 'advisor',
              agentSource: 'extension',
              task: 'test',
              exitCode: 0,
              messages: [makeMessage('some advice')],
              stderr: '',
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
          ],
        },
      },
      true,
      theme,
    )
    expect(result).toBeInstanceOf(Text)
  })

  it('renders collapsed result', () => {
    const result = buildAdvisorRenderResult(
      {
        content: [{ type: 'text', text: 'advice' }],
        details: {
          mode: 'single',
          projectAgentsDir: undefined,
          results: [
            {
              agent: 'advisor',
              agentSource: 'extension',
              task: 'test',
              exitCode: 0,
              messages: [makeMessage('line1\nline2\nline3\nline4')],
              stderr: '',
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
          ],
        },
      },
      false,
      theme,
    )
    expect(result).toBeInstanceOf(Text)
  })
})
