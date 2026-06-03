import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { registerShellHook } from '../shell.js'

let withPatternsDirectory: string
let withoutPatternsDirectory: string

beforeAll(async () => {
  withPatternsDirectory = await mkdtemp(
    path.join(tmpdir(), 'pi-shell-hook-with-'),
  )
  withoutPatternsDirectory = await mkdtemp(
    path.join(tmpdir(), 'pi-shell-hook-without-'),
  )

  await writeFile(
    path.join(withPatternsDirectory, 'SHELL_RISK_PATTERNS.json'),
    JSON.stringify([
      {
        pattern: String.raw`\bsudo\b`,
        level: 'high',
        reason: 'Elevated privileges',
      },
      {
        pattern: String.raw`\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?-[a-zA-Z]*f`,
        level: 'critical',
        reason: 'Recursive force deletion',
      },
    ]),
  )
})

afterAll(async () => {
  await rm(withPatternsDirectory, { force: true, recursive: true })
  await rm(withoutPatternsDirectory, { force: true, recursive: true })
})

describe('registerShellHook', () => {
  it('notifies for high-risk bash commands', async () => {
    const handlers: { event: string; fn: unknown }[] = []
    const notifySpy = vi.fn()

    const pi: Pick<ExtensionAPI, 'on'> = {
      on: (event, handler) => {
        handlers.push({ event, fn: handler })
      },
    }

    registerShellHook(pi)

    const bashEvent = {
      type: 'tool_call',
      toolCallId: '1',
      toolName: 'bash',
      input: { command: 'echo sudo apt update' },
    }

    expect(handlers[0]).toBeDefined()
    // @ts-expect-error minimal context mock
    await handlers[0]?.fn(bashEvent, {
      cwd: withPatternsDirectory,
      ui: { notify: notifySpy },
    })

    expect(notifySpy).toHaveBeenCalledWith(
      expect.stringContaining('high'),
      'warning',
    )
  })

  it('notifies for critical-risk bash commands with error severity', async () => {
    const handlers: { event: string; fn: unknown }[] = []
    const notifySpy = vi.fn()

    const pi: Pick<ExtensionAPI, 'on'> = {
      on: (event, handler) => {
        handlers.push({ event, fn: handler })
      },
    }

    registerShellHook(pi)

    const bashEvent = {
      type: 'tool_call',
      toolCallId: '2',
      toolName: 'bash',
      input: { command: 'echo rm -rf /' },
    }

    // @ts-expect-error minimal context mock
    await handlers[0]?.fn(bashEvent, {
      cwd: withPatternsDirectory,
      ui: { notify: notifySpy },
    })

    expect(notifySpy).toHaveBeenCalledWith(
      expect.stringContaining('critical'),
      'error',
    )
  })

  it('does not notify for low-risk bash commands', async () => {
    const handlers: { event: string; fn: unknown }[] = []
    const notifySpy = vi.fn()

    const pi: Pick<ExtensionAPI, 'on'> = {
      on: (event, handler) => {
        handlers.push({ event, fn: handler })
      },
    }

    registerShellHook(pi)

    const bashEvent = {
      type: 'tool_call',
      toolCallId: '3',
      toolName: 'bash',
      input: { command: 'ls -la' },
    }

    // @ts-expect-error minimal context mock
    await handlers[0]?.fn(bashEvent, {
      cwd: withPatternsDirectory,
      ui: { notify: notifySpy },
    })

    expect(notifySpy).not.toHaveBeenCalled()
  })

  it('does not notify when no patterns file exists', async () => {
    const handlers: { event: string; fn: unknown }[] = []
    const notifySpy = vi.fn()

    const pi: Pick<ExtensionAPI, 'on'> = {
      on: (event, handler) => {
        handlers.push({ event, fn: handler })
      },
    }

    registerShellHook(pi)

    const bashEvent = {
      type: 'tool_call',
      toolCallId: '4',
      toolName: 'bash',
      input: { command: 'echo rm -rf /' },
    }

    // @ts-expect-error minimal context mock
    await handlers[0]?.fn(bashEvent, {
      cwd: withoutPatternsDirectory,
      ui: { notify: notifySpy },
    })

    expect(notifySpy).not.toHaveBeenCalled()
  })

  it('ignores non-bash tool calls', async () => {
    const handlers: { event: string; fn: unknown }[] = []
    const notifySpy = vi.fn()

    const pi: Pick<ExtensionAPI, 'on'> = {
      on: (event, handler) => {
        handlers.push({ event, fn: handler })
      },
    }

    registerShellHook(pi)

    const readEvent = {
      type: 'tool_call',
      toolCallId: '5',
      toolName: 'read',
      input: { path: '/tmp' },
    }

    // @ts-expect-error minimal context mock
    await handlers[0]?.fn(readEvent, {
      cwd: withPatternsDirectory,
      ui: { notify: notifySpy },
    })

    expect(notifySpy).not.toHaveBeenCalled()
  })
})
