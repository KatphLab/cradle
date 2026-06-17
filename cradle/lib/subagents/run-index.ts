import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

import {
  getAgentDir,
  withFileMutationQueue,
} from '@earendil-works/pi-coding-agent'

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

function getRunIndexPath(): string {
  return path.join(getAgentDir(), 'subagents', 'runs.jsonl')
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
