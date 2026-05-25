import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  classifyShellRisk,
  clearShellRiskCache,
  loadShellRiskPatterns,
  type ShellRiskPattern,
} from './shell-risk.js'

let tempDirectory: string

beforeAll(async () => {
  tempDirectory = await mkdtemp(path.join(tmpdir(), 'pi-shell-risk-test-'))
})

afterAll(async () => {
  await rm(tempDirectory, { force: true, recursive: true })
})

beforeEach(() => {
  clearShellRiskCache()
})

describe('loadShellRiskPatterns', () => {
  it('returns empty array when file does not exist', async () => {
    const directory = path.join(tempDirectory, 'no-file')
    const result = await loadShellRiskPatterns(directory)
    expect(result).toEqual([])
  })

  it('loads patterns from SHELL_RISK_PATTERNS.json', async () => {
    const directory = path.join(tempDirectory, 'with-patterns')
    await mkdir(directory, { recursive: true })
    await writeFile(
      path.join(directory, 'SHELL_RISK_PATTERNS.json'),
      JSON.stringify([
        { pattern: String.raw`\brm\b`, level: 'critical', reason: 'Deletion' },
      ]),
    )
    const result = await loadShellRiskPatterns(directory)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      level: 'critical',
      reason: 'Deletion',
    })
    expect(result[0]?.pattern.test('rm -rf /')).toBe(true)
    expect(result[0]?.pattern.test('ls -la')).toBe(false)
  })

  it('returns empty array for empty JSON array', async () => {
    const directory = path.join(tempDirectory, 'empty-patterns')
    await mkdir(directory, { recursive: true })
    await writeFile(
      path.join(directory, 'SHELL_RISK_PATTERNS.json'),
      JSON.stringify([]),
    )
    const result = await loadShellRiskPatterns(directory)
    expect(result).toEqual([])
  })

  it('ignores invalid entries and keeps valid ones', async () => {
    const directory = path.join(tempDirectory, 'mixed')
    await mkdir(directory, { recursive: true })
    await writeFile(
      path.join(directory, 'SHELL_RISK_PATTERNS.json'),
      JSON.stringify([
        { pattern: String.raw`\bsudo\b`, level: 'high', reason: 'Elevated' },
        { pattern: 'invalid', level: 'invalid', reason: 'Bad level' },
        { pattern: 'also-invalid' },
        'not-an-object',
      ]),
    )
    const result = await loadShellRiskPatterns(directory)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      level: 'high',
      reason: 'Elevated',
    })
  })

  it('throws on malformed JSON', async () => {
    const directory = path.join(tempDirectory, 'malformed')
    await mkdir(directory, { recursive: true })
    await writeFile(
      path.join(directory, 'SHELL_RISK_PATTERNS.json'),
      'not json',
    )
    await expect(loadShellRiskPatterns(directory)).rejects.toThrow()
  })

  it('throws when JSON is not an array', async () => {
    const directory = path.join(tempDirectory, 'object-json')
    await mkdir(directory, { recursive: true })
    await writeFile(
      path.join(directory, 'SHELL_RISK_PATTERNS.json'),
      JSON.stringify({ pattern: 'test' }),
    )
    await expect(loadShellRiskPatterns(directory)).rejects.toThrow(
      'must be an array',
    )
  })
})

describe('classifyShellRisk', () => {
  const testPatterns: ShellRiskPattern[] = [
    { pattern: /\brm -rf\b/, level: 'critical', reason: 'Deletion' },
    { pattern: /\bsudo\b/, level: 'high', reason: 'Elevated' },
  ]

  it('returns undefined when no patterns provided', () => {
    expect(classifyShellRisk('rm -rf /', [])).toBeUndefined()
  })

  it('classifies matching command', () => {
    expect(classifyShellRisk('rm -rf /', testPatterns)).toEqual({
      level: 'critical',
      reason: 'Deletion',
    })
  })

  it('returns low for non-matching command', () => {
    expect(classifyShellRisk('ls -la', testPatterns)).toEqual({
      level: 'low',
      reason: 'No known risk patterns detected',
    })
  })

  it('uses first matching pattern', () => {
    const patterns: ShellRiskPattern[] = [
      { pattern: /\bsudo\b/, level: 'high', reason: 'Elevated' },
      { pattern: /\bsudo\b/, level: 'critical', reason: 'Also elevated' },
    ]
    expect(classifyShellRisk('sudo apt update', patterns)).toEqual({
      level: 'high',
      reason: 'Elevated',
    })
  })
})
