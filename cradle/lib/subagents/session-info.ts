import { randomUUID } from 'node:crypto'

import { SessionManager } from '@earendil-works/pi-coding-agent'

import { appendSubagentRunRecord } from './run-index.js'
import type { SingleResult, SubagentSessionInfo } from './types.js'

export type PiSessionMode = 'new' | 'resume'

export function createSubagentSessionInfo(
  agentName: string,
  task: string,
  cwd: string,
  sessionId: string,
  sessionMode: PiSessionMode,
): SubagentSessionInfo {
  const session: SubagentSessionInfo = {
    id: sessionId,
    cwd,
    inspectCommand: `pi --session ${sessionId}`,
    continueHint: `Call subagent again with agent "${agentName}" and sessionId "${sessionId}".`,
  }
  if (sessionMode === 'new') {
    session.name = `subagent:${agentName}: ${previewTaskForName(task)}`
  }
  return session
}

export function createRunId(): string {
  return randomUUID()
}

export function createSessionId(existingSessionId: string | undefined): string {
  return existingSessionId ?? randomUUID()
}

export function getSessionMode(
  existingSessionId: string | undefined,
): PiSessionMode {
  return existingSessionId === undefined ? 'new' : 'resume'
}

export async function applySessionFile(result: SingleResult): Promise<void> {
  const session = result.session
  if (session === undefined) return
  try {
    const sessions = await SessionManager.list(session.cwd)
    const match = sessions.find((item) => item.id === session.id)
    if (match !== undefined) session.file = match.path
  } catch {
    // Keep the session id/resume command even if session file lookup fails.
  }
}

export function getRunStatus(result: SingleResult): 'succeeded' | 'failed' {
  return result.exitCode !== 0 ||
    result.stopReason === 'error' ||
    result.stopReason === 'aborted'
    ? 'failed'
    : 'succeeded'
}

export async function recordRunStatus(
  runId: string,
  result: SingleResult,
  status: 'running' | 'succeeded' | 'failed',
): Promise<void> {
  const session = result.session
  if (session === undefined) return
  await appendSubagentRunRecord({
    runId,
    agent: result.agent,
    task: result.task,
    cwd: session.cwd,
    sessionId: session.id,
    status,
    timestamp: new Date().toISOString(),
    ...(status !== 'running' && { exitCode: result.exitCode }),
    ...(session.file !== undefined && { sessionFile: session.file }),
    ...(result.step !== undefined && { step: result.step }),
  })
}

function previewTaskForName(task: string): string {
  const cleanTask = task.replaceAll(/\s+/g, ' ').trim()
  return cleanTask.length > 48 ? `${cleanTask.slice(0, 48)}...` : cleanTask
}
