import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { bashTool } from '../bash.js'

let withPatternsDirectory: string
let withoutPatternsDirectory: string

beforeAll(async () => {
  withPatternsDirectory = await mkdtemp(path.join(tmpdir(), 'pi-bash-with-'))
  withoutPatternsDirectory = await mkdtemp(
    path.join(tmpdir(), 'pi-bash-without-'),
  )

  const riskPatterns = [
    {
      pattern: String.raw`\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?-[a-zA-Z]*f`,
      level: 'critical',
      reason: 'Recursive force deletion',
    },
    {
      pattern: String.raw`\bsudo\b`,
      level: 'high',
      reason: 'Elevated privileges',
    },
    {
      pattern: String.raw`\bchmod\s+.*777`,
      level: 'medium',
      reason: 'Broad permission change',
    },
  ]

  await writeFile(
    path.join(withPatternsDirectory, 'SHELL_RISK_PATTERNS.json'),
    JSON.stringify(riskPatterns),
  )
})

afterAll(async () => {
  await rm(withPatternsDirectory, { force: true, recursive: true })
  await rm(withoutPatternsDirectory, { force: true, recursive: true })
})

describe('bashTool', () => {
  it('executes low-risk command without confirmation', async () => {
    const confirmSpy = vi.fn()
    const result = await bashTool.execute(
      'test-call',
      {
        command: 'echo hello',
        summary: 'Print hello',
        riskLevel: 'low',
        riskReason: 'Harmless',
      },
      new AbortController().signal,
      vi.fn(),
      // @ts-expect-error minimal context mock
      { cwd: withPatternsDirectory, ui: { confirm: confirmSpy } },
    )

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect(result.content[0]).toHaveProperty(
      'text',
      expect.stringContaining('hello'),
    )
  })

  it('accepts timeout parameter', async () => {
    const confirmSpy = vi.fn()
    const result = await bashTool.execute(
      'test-call',
      {
        command: 'echo timeout-test',
        summary: 'Test timeout',
        riskLevel: 'low',
        riskReason: 'Harmless',
        timeout: 5,
      },
      new AbortController().signal,
      vi.fn(),
      // @ts-expect-error minimal context mock
      { cwd: withPatternsDirectory, ui: { confirm: confirmSpy } },
    )

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })
  })

  it('blocks high-risk command when user denies', async () => {
    const confirmSpy = vi.fn().mockResolvedValue(false)
    const result = await bashTool.execute(
      'test-call',
      {
        command: 'echo sudo apt update',
        summary: 'Print sudo string',
        riskLevel: 'low',
        riskReason: 'Just cleanup',
      },
      new AbortController().signal,
      vi.fn(),
      // @ts-expect-error minimal context mock
      { cwd: withPatternsDirectory, ui: { confirm: confirmSpy } },
    )

    expect(confirmSpy).toHaveBeenCalled()
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Blocked'),
    })
  })

  it('executes high-risk command when user allows', async () => {
    const confirmSpy = vi.fn().mockResolvedValue(true)
    const result = await bashTool.execute(
      'test-call',
      {
        command: 'echo sudo apt update',
        summary: 'Print sudo string',
        riskLevel: 'high',
        riskReason: 'Elevated privileges',
      },
      new AbortController().signal,
      vi.fn(),
      // @ts-expect-error minimal context mock
      { cwd: withPatternsDirectory, ui: { confirm: confirmSpy } },
    )

    expect(confirmSpy).toHaveBeenCalled()
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })
  })

  it('overrides under-declared risk and confirms', async () => {
    const confirmSpy = vi.fn().mockResolvedValue(true)
    const result = await bashTool.execute(
      'test-call',
      {
        command: 'echo rm -rf /',
        summary: 'Print scary string',
        riskLevel: 'low',
        riskReason: 'Low risk',
      },
      new AbortController().signal,
      vi.fn(),
      // @ts-expect-error minimal context mock
      { cwd: withPatternsDirectory, ui: { confirm: confirmSpy } },
    )

    expect(confirmSpy).toHaveBeenCalled()
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })
  })

  it('blocks under-declared critical when user denies', async () => {
    const confirmSpy = vi.fn().mockResolvedValue(false)
    const result = await bashTool.execute(
      'test-call',
      {
        command: 'echo rm -rf /',
        summary: 'Print scary string',
        riskLevel: 'low',
        riskReason: 'Low risk',
      },
      new AbortController().signal,
      vi.fn(),
      // @ts-expect-error minimal context mock
      { cwd: withPatternsDirectory, ui: { confirm: confirmSpy } },
    )

    expect(confirmSpy).toHaveBeenCalled()
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Blocked'),
    })
  })

  it('handles medium-risk command without confirmation', async () => {
    const confirmSpy = vi.fn()
    const result = await bashTool.execute(
      'test-call',
      {
        command: 'echo chmod 777 example',
        summary: 'Print permissions',
        riskLevel: 'medium',
        riskReason: 'Permission change',
      },
      new AbortController().signal,
      vi.fn(),
      // @ts-expect-error minimal context mock
      { cwd: withPatternsDirectory, ui: { confirm: confirmSpy } },
    )

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })
  })

  it('uses declared reason when declared risk exceeds detected', async () => {
    const confirmSpy = vi.fn().mockResolvedValue(true)
    await bashTool.execute(
      'test-call',
      {
        command: 'echo chmod 777 example',
        summary: 'Print permissions',
        riskLevel: 'high',
        riskReason: 'Intentional broad permissions',
      },
      new AbortController().signal,
      vi.fn(),
      // @ts-expect-error minimal context mock
      { cwd: withPatternsDirectory, ui: { confirm: confirmSpy } },
    )

    expect(confirmSpy).toHaveBeenCalled()
    expect(confirmSpy).toHaveBeenCalledWith(
      'High-risk command: high',
      expect.stringContaining('Intentional broad permissions'),
    )
  })

  it('trusts LLM when no patterns file exists', async () => {
    const confirmSpy = vi.fn()
    const result = await bashTool.execute(
      'test-call',
      {
        command: 'echo rm -rf /',
        summary: 'Print scary string',
        riskLevel: 'low',
        riskReason: 'Low risk',
      },
      new AbortController().signal,
      vi.fn(),
      // @ts-expect-error minimal context mock
      { cwd: withoutPatternsDirectory, ui: { confirm: confirmSpy } },
    )

    // No patterns loaded — trust the LLM's declared low risk.
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })
  })
})
