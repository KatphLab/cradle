import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import {
  getAgentDir,
  withFileMutationQueue,
} from '@earendil-works/pi-coding-agent'
import { isPlainRecord } from '../../utils/type-guards.js'

type SubagentRunStatus = 'running' | 'succeeded' | 'failed'

export interface SubagentRunRecord {
  runId: string
  agent: string
  task: string
  cwd: string
  sessionId: string
  status: SubagentRunStatus
  timestamp: string
  exitCode?: number
  sessionFile?: string
  step?: number
}

function isSubagentRunStatus(value: unknown): value is SubagentRunStatus {
  return value === 'running' || value === 'succeeded' || value === 'failed'
}

function isSubagentRunRecord(value: unknown): value is SubagentRunRecord {
  if (!isPlainRecord(value)) {
    return false
  }
  return (
    typeof value['runId'] === 'string' &&
    typeof value['agent'] === 'string' &&
    typeof value['task'] === 'string' &&
    typeof value['cwd'] === 'string' &&
    typeof value['sessionId'] === 'string' &&
    isSubagentRunStatus(value['status']) &&
    typeof value['timestamp'] === 'string'
  )
}

function parseRunRecordLine(line: string): SubagentRunRecord | undefined {
  if (line.trim().length === 0) return undefined
  try {
    const parsed: unknown = JSON.parse(line)
    return isSubagentRunRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function getRunIndexPath(): string {
  return path.join(getAgentDir(), 'subagents', 'runs.jsonl')
}

export async function listSubagentRunRecords(): Promise<SubagentRunRecord[]> {
  try {
    const content = await readFile(getRunIndexPath(), 'utf8')
    return content
      .split('\n')
      .map((line) => parseRunRecordLine(line))
      .filter((record): record is SubagentRunRecord => record !== undefined)
  } catch {
    return []
  }
}

export async function appendSubagentRunRecord(
  record: SubagentRunRecord,
): Promise<void> {
  try {
    const indexPath = getRunIndexPath()
    await mkdir(path.dirname(indexPath), { recursive: true })
    await withFileMutationQueue(indexPath, async () => {
      await appendFile(indexPath, `${JSON.stringify(record)}\n`, 'utf8')
    })
  } catch {
    // Best-effort diagnostics index: subagent execution must not fail because
    // its auxiliary run index could not be written.
  }
}
