import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { isRecord } from '../utils/type-guards.js'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface ShellRiskPattern {
  pattern: RegExp
  level: RiskLevel
  reason: string
}

function isValidLevel(level: string): level is RiskLevel {
  return ['low', 'medium', 'high', 'critical'].includes(level)
}

const patternCache = new Map<string, ShellRiskPattern[]>()

/** @public */
export function clearShellRiskCache(): void {
  patternCache.clear()
}

function isShellRiskPatternEntry(
  entry: unknown,
): entry is { pattern: string; level: RiskLevel; reason: string } {
  if (!isRecord(entry)) {
    return false
  }
  return (
    typeof entry['pattern'] === 'string' &&
    typeof entry['level'] === 'string' &&
    typeof entry['reason'] === 'string' &&
    isValidLevel(entry['level'])
  )
}

function parseShellRiskPatterns(raw: unknown[]): ShellRiskPattern[] {
  const patterns: ShellRiskPattern[] = []
  for (const entry of raw) {
    if (isShellRiskPatternEntry(entry)) {
      patterns.push({
        pattern: new RegExp(entry.pattern),
        level: entry.level,
        reason: entry.reason,
      })
    }
  }
  return patterns
}

/** @public */
export async function loadShellRiskPatterns(
  cwd: string,
): Promise<ShellRiskPattern[]> {
  const cached = patternCache.get(cwd)
  if (cached !== undefined) {
    return cached
  }

  try {
    const content = await readFile(
      path.join(cwd, 'SHELL_RISK_PATTERNS.json'),
      'utf8',
    )
    const raw = JSON.parse(content) as unknown

    if (!Array.isArray(raw)) {
      throw new TypeError('SHELL_RISK_PATTERNS.json must be an array')
    }

    const patterns = parseShellRiskPatterns(raw)
    patternCache.set(cwd, patterns)
    return patterns
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      patternCache.set(cwd, [])
      return []
    }
    throw error
  }
}

/** Auto-detect risk level from a shell command string using loaded patterns. */
export function classifyShellRisk(
  command: string,
  patterns: ShellRiskPattern[],
): { level: RiskLevel; reason: string } | undefined {
  if (patterns.length === 0) {
    return undefined
  }
  for (const { pattern, level, reason } of patterns) {
    if (pattern.test(command)) {
      return { level, reason }
    }
  }
  return { level: 'low', reason: 'No known risk patterns detected' }
}
