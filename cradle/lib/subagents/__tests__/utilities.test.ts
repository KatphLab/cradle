import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Message } from '@earendil-works/pi-ai'
import { withFileMutationQueue } from '@earendil-works/pi-coding-agent'

import type { SingleResult } from '../types.js'
import {
  PER_TASK_OUTPUT_CAP,
  formatTokens,
  formatToolCall,
  formatUsageStats,
  getDisplayItems,
  getFinalOutput,
  getPiInvocation,
  getResultOutput,
  isFailedResult,
  mapWithConcurrencyLimit,
  truncateParallelOutput,
  writePromptToTemporaryFile,
} from '../utilities.js'

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
    promises: {
      mkdtemp: vi.fn(),
      writeFile: vi.fn(),
    },
  },
}))

vi.mock('node:os', () => ({
  default: {
    homedir: vi.fn(),
    tmpdir: vi.fn(),
  },
}))

vi.mock('@earendil-works/pi-coding-agent', () => ({
  withFileMutationQueue: vi.fn(),
}))

const themeFg = (color: string, text: string) => `<${color}>${text}</${color}>`
const originalArgv = [...process.argv]
const originalExecPath = process.execPath

type AssistantTestMessage = Extract<Message, { role: 'assistant' }>
type AssistantContent = AssistantTestMessage['content']
type UserContent = Extract<Message, { role: 'user' }>['content']
type TestMessageRole = 'assistant' | 'user'

function isRecordStringUnknown(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toAssistantContent(content: unknown): AssistantContent {
  if (!Array.isArray(content)) return []

  const assistantContent: AssistantContent = []
  let toolCallIndex = 0
  for (const part of content) {
    if (!isRecordStringUnknown(part)) continue

    const text = part['text']
    if (part['type'] === 'text' && typeof text === 'string') {
      assistantContent.push({ text, type: 'text' })
      continue
    }

    const toolArguments = part['arguments']
    const toolName = part['name']
    if (
      part['type'] === 'toolCall' &&
      typeof toolName === 'string' &&
      isRecordStringUnknown(toolArguments)
    ) {
      assistantContent.push({
        arguments: toolArguments,
        id: `tool-${toolCallIndex.toString()}`,
        name: toolName,
        type: 'toolCall',
      })
      toolCallIndex += 1
    }
  }

  return assistantContent
}

function toUserContentParts(content: unknown): Exclude<UserContent, string> {
  if (!Array.isArray(content)) return []

  const userContent: Exclude<UserContent, string> = []
  for (const part of content) {
    if (!isRecordStringUnknown(part)) continue

    const text = part['text']
    if (part['type'] === 'text' && typeof text === 'string') {
      userContent.push({ text, type: 'text' })
      continue
    }

    const data = part['data']
    const mimeType = part['mimeType']
    if (
      part['type'] === 'image' &&
      typeof data === 'string' &&
      typeof mimeType === 'string'
    ) {
      userContent.push({ data, mimeType, type: 'image' })
    }
  }

  return userContent
}

function message(role: TestMessageRole, content: unknown): Message {
  if (role === 'user') {
    return {
      content:
        typeof content === 'string' ? content : toUserContentParts(content),
      role,
      timestamp: 0,
    }
  }

  return {
    api: 'test',
    content: toAssistantContent(content),
    model: 'test',
    provider: 'test',
    role,
    stopReason: 'stop',
    timestamp: 0,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: {
        cacheRead: 0,
        cacheWrite: 0,
        input: 0,
        output: 0,
        total: 0,
      },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  }
}

function makeResult(overrides: Partial<SingleResult>): SingleResult {
  return {
    agent: 'agent-one',
    agentSource: 'project',
    task: 'do work',
    exitCode: 0,
    messages: [],
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
    ...overrides,
  }
}

function setProcessInvocation(execPath: string, argv1: string | undefined) {
  Object.defineProperty(process, 'execPath', {
    configurable: true,
    value: execPath,
  })
  process.argv = argv1 === undefined ? ['node'] : ['node', argv1]
}

describe('subagent utilities', () => {
  beforeEach(() => {
    vi.mocked(os.homedir).mockReturnValue('/home/tester')
    vi.mocked(os.tmpdir).mockReturnValue('/tmp')
    vi.mocked(fs.existsSync).mockReset()
    vi.mocked(fs.promises.mkdtemp).mockReset()
    vi.mocked(fs.promises.writeFile).mockReset()
    vi.mocked(withFileMutationQueue).mockReset()
    vi.mocked(withFileMutationQueue).mockImplementation(async (_filePath, fn) =>
      fn(),
    )
    setProcessInvocation(originalExecPath, originalArgv[1])
  })

  afterEach(() => {
    process.argv = [...originalArgv]
    Object.defineProperty(process, 'execPath', {
      configurable: true,
      value: originalExecPath,
    })
    vi.clearAllMocks()
  })

  describe('formatTokens', () => {
    it('formats raw, thousands, rounded thousands, and millions', () => {
      expect(formatTokens(999)).toBe('999')
      expect(formatTokens(1000)).toBe('1.0k')
      expect(formatTokens(9999)).toBe('10.0k')
      expect(formatTokens(10_000)).toBe('10k')
      expect(formatTokens(999_499)).toBe('999k')
      expect(formatTokens(1_000_000)).toBe('1.0M')
    })
  })

  describe('formatUsageStats', () => {
    it('formats empty, populated, and singular usage stats', () => {
      expect(
        formatUsageStats({
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0,
          contextTokens: 0,
          turns: 0,
        }),
      ).toBe('')

      expect(
        formatUsageStats(
          {
            input: 1500,
            output: 23,
            cacheRead: 999,
            cacheWrite: 10_000,
            cost: 0.123_45,
            contextTokens: 1_000_000,
            turns: 2,
          },
          'claude-sonnet',
        ),
      ).toBe('2 turns ↑1.5k ↓23 R999 W10k $0.1235 ctx:1.0M claude-sonnet')

      expect(
        formatUsageStats({
          input: 0,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0,
          contextTokens: -1,
          turns: 1,
        }),
      ).toBe('1 turn ↓1')
    })
  })

  describe('formatToolCall', () => {
    it('formats bash, read, write, and edit calls', () => {
      const longCommand = 'x'.repeat(61)

      expect(formatToolCall('bash', { command: longCommand }, themeFg)).toBe(
        `<muted>$ </muted><toolOutput>${'x'.repeat(60)}...</toolOutput>`,
      )
      expect(formatToolCall('bash', {}, themeFg)).toBe(
        '<muted>$ </muted><toolOutput>...</toolOutput>',
      )

      expect(
        formatToolCall(
          'read',
          { file_path: '/home/tester/project/file.ts', limit: 3, offset: 5 },
          themeFg,
        ),
      ).toBe(
        '<muted>read </muted><accent>~/project/file.ts</accent><warning>:5-7</warning>',
      )
      expect(
        formatToolCall('read', { limit: 10, path: 'notes.md' }, themeFg),
      ).toBe(
        '<muted>read </muted><accent>notes.md</accent><warning>:1-10</warning>',
      )

      expect(
        formatToolCall(
          'write',
          { content: 'one\ntwo', file_path: '/home/tester/out.md' },
          themeFg,
        ),
      ).toBe(
        '<muted>write </muted><accent>~/out.md</accent><dim> (2 lines)</dim>',
      )
      expect(
        formatToolCall('write', { path: 'single.md', content: 'one' }, themeFg),
      ).toBe('<muted>write </muted><accent>single.md</accent>')
      expect(formatToolCall('edit', { path: '' }, themeFg)).toBe(
        '<muted>edit </muted><accent>...</accent>',
      )
    })

    it('formats ls, find, grep, and default calls', () => {
      expect(formatToolCall('ls', {}, themeFg)).toBe(
        '<muted>ls </muted><accent>.</accent>',
      )
      expect(formatToolCall('ls', { path: '/home/tester/src' }, themeFg)).toBe(
        '<muted>ls </muted><accent>~/src</accent>',
      )
      expect(
        formatToolCall('find', { path: '/tmp', pattern: '*.ts' }, themeFg),
      ).toBe('<muted>find </muted><accent>*.ts</accent><dim> in /tmp</dim>')
      expect(formatToolCall('find', {}, themeFg)).toBe(
        '<muted>find </muted><accent>*</accent><dim> in .</dim>',
      )
      expect(
        formatToolCall('grep', { path: 'src', pattern: 'todo' }, themeFg),
      ).toBe('<muted>grep </muted><accent>/todo/</accent><dim> in src</dim>')
      expect(formatToolCall('grep', {}, themeFg)).toBe(
        '<muted>grep </muted><accent>//</accent><dim> in .</dim>',
      )
      expect(formatToolCall('custom', { ok: true }, themeFg)).toBe(
        '<accent>custom</accent><dim> {"ok":true}</dim>',
      )
      expect(
        formatToolCall('custom', { value: 'x'.repeat(60) }, themeFg),
      ).toContain('<dim> {"value":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx...')
    })
  })

  describe('message display helpers', () => {
    it('returns the final assistant text output or empty string', () => {
      const messages = [
        message('assistant', [{ type: 'text', text: 'first' }]),
        message('user', [{ type: 'text', text: 'ignored' }]),
        message('assistant', [
          { type: 'toolCall', name: 'bash', arguments: {} },
        ]),
        message('assistant', [{ type: 'text', text: 'last' }]),
      ]

      expect(getFinalOutput(messages)).toBe('last')
      expect(
        getFinalOutput([
          message('assistant', 'plain text'),
          message('assistant', [{ type: 'text', text: 123 }]),
        ]),
      ).toBe('')
    })

    it('extracts displayable text and tool call items', () => {
      expect(
        getDisplayItems([
          message('user', [{ type: 'text', text: 'ignored' }]),
          message('assistant', [
            { type: 'text', text: 'hello' },
            { type: 'toolCall', name: 'read', arguments: { path: 'a.ts' } },
            { type: 'toolCall', name: 1, arguments: {} },
            null,
          ]),
        ]),
      ).toEqual([
        { type: 'text', text: 'hello' },
        { type: 'toolCall', name: 'read', args: { path: 'a.ts' } },
      ])
    })
  })

  describe('result helpers', () => {
    it('detects failed results and prefers error message then stderr', () => {
      expect(isFailedResult(makeResult({ exitCode: 1 }))).toBe(true)
      expect(isFailedResult(makeResult({ stopReason: 'error' }))).toBe(true)
      expect(isFailedResult(makeResult({ stopReason: 'aborted' }))).toBe(true)
      expect(isFailedResult(makeResult({ stopReason: 'complete' }))).toBe(false)

      expect(
        getResultOutput(
          makeResult({
            errorMessage: 'boom',
            exitCode: 1,
            stderr: 'stderr text',
          }),
        ),
      ).toBe('boom')
      expect(
        getResultOutput(makeResult({ exitCode: 1, stderr: 'stderr text' })),
      ).toBe('stderr text')
      expect(
        getResultOutput(
          makeResult({
            exitCode: 1,
            stderr: 'stderr text',
            session: {
              id: 'session-1',
              cwd: '/repo',
              inspectCommand: 'pi --session session-1',
              continueHint:
                'Call subagent again with agent "agent-one" and sessionId "session-1".',
            },
          }),
        ),
      ).toContain('Subagent session:\n- id: session-1')
    })

    it('returns final assistant output or fallback text', () => {
      expect(
        getResultOutput(
          makeResult({
            messages: [message('assistant', [{ type: 'text', text: 'done' }])],
          }),
        ),
      ).toBe('done')
      expect(getResultOutput(makeResult({ messages: [] }))).toBe('(no output)')
      expect(getResultOutput(makeResult({ exitCode: 1 }))).toBe('(no output)')
    })
  })

  describe('truncateParallelOutput', () => {
    it('returns small or multibyte output unchanged', () => {
      expect(truncateParallelOutput('short')).toBe('short')

      const truncated = truncateParallelOutput('😀'.repeat(PER_TASK_OUTPUT_CAP))
      const visibleOutput = truncated.split('\n\n[')[0] ?? ''

      expect(Buffer.byteLength(visibleOutput, 'utf8')).toBeLessThanOrEqual(
        PER_TASK_OUTPUT_CAP,
      )
      expect(truncated).toContain('bytes omitted')
    })

    it('truncates output beyond the byte cap and reports omitted bytes', () => {
      const output = `${'a'.repeat(PER_TASK_OUTPUT_CAP)}tail`
      const truncated = truncateParallelOutput(output)

      expect(truncated).toContain(
        '[Output truncated: 4 bytes omitted. Full output preserved in tool details.]',
      )
      expect(Buffer.byteLength(truncated.split('\n\n[')[0] ?? '', 'utf8')).toBe(
        PER_TASK_OUTPUT_CAP,
      )
    })
  })

  describe('writePromptToTemporaryFile', () => {
    it('writes prompts to a secure temporary file with a sanitized agent name', async () => {
      const temporaryDirectory = path.join(os.tmpdir(), 'pi-subagent-abc')
      const filePath = path.join(
        temporaryDirectory,
        'prompt-agent_one_.._.._name.md',
      )
      vi.mocked(fs.promises.mkdtemp).mockResolvedValue(temporaryDirectory)

      await expect(
        writePromptToTemporaryFile('agent one/../../name', 'prompt text'),
      ).resolves.toEqual({
        directory: temporaryDirectory,
        filePath,
      })

      expect(fs.promises.mkdtemp).toHaveBeenCalledWith(
        path.join(os.tmpdir(), 'pi-subagent-'),
      )
      expect(withFileMutationQueue).toHaveBeenCalledWith(
        filePath,
        expect.any(Function),
      )
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        filePath,
        'prompt text',
        { encoding: 'utf8', mode: 0o600 },
      )
    })
  })

  describe('getPiInvocation', () => {
    it('invokes the current script through the current runtime or uses non-generic paths', () => {
      setProcessInvocation('/usr/local/bin/node', '/repo/bin/pi.js')
      vi.mocked(fs.existsSync).mockReturnValue(true)

      expect(getPiInvocation(['subagent', 'run'])).toEqual({
        command: '/usr/local/bin/node',
        args: ['/repo/bin/pi.js', 'subagent', 'run'],
      })

      setProcessInvocation('/opt/bin/custom-pi', undefined)
      expect(getPiInvocation(['--help'])).toEqual({
        command: '/opt/bin/custom-pi',
        args: ['--help'],
      })
    })

    it('falls back to pi for generic runtimes and bun virtual scripts', () => {
      setProcessInvocation('/usr/bin/node', '/$bunfs/root/pi.js')
      vi.mocked(fs.existsSync).mockReturnValue(true)

      expect(getPiInvocation(['agent'])).toEqual({
        command: 'pi',
        args: ['agent'],
      })
    })
  })

  describe('mapWithConcurrencyLimit', () => {
    it('returns empty results and clamps concurrency to at least one', async () => {
      const mapper = vi.fn<() => Promise<string>>()

      await expect(mapWithConcurrencyLimit([], 2, mapper)).resolves.toEqual([])
      expect(mapper).not.toHaveBeenCalled()

      let active = 0
      let maxActive = 0

      const result = await mapWithConcurrencyLimit<number | undefined, string>(
        [1, undefined, 3],
        0,
        async (item) => {
          active += 1
          maxActive = Math.max(maxActive, active)
          await Promise.resolve()
          active -= 1
          return String(item)
        },
      )

      expect(result).toEqual(['1', undefined, '3'])
      expect(maxActive).toBe(1)
    })

    it('preserves order, passes indices, and respects concurrency', async () => {
      let active = 0
      let maxActive = 0

      const result = await mapWithConcurrencyLimit(
        [1, 2, 3, 4],
        2,
        async (item, index) => {
          active += 1
          maxActive = Math.max(maxActive, active)
          await new Promise((resolve) => setTimeout(resolve, 5))
          active -= 1
          return `${index}:${item}`
        },
      )

      expect(result).toEqual(['0:1', '1:2', '2:3', '3:4'])
      expect(maxActive).toBeLessThanOrEqual(2)
    })
  })
})
