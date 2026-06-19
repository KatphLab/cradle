import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { buildSessionContext } from '@earendil-works/pi-coding-agent'

import { isFileApproved, reconstructApprovalState } from './approval-state.js'
import { normalizePath } from './helpers.js'

/**
 * Check approval status for a file path and return a hint string if the file
 * is not in the approved scope. Returns undefined if no approval context exists
 * or if the file is approved for at least one write operation.
 *
 * Used by the read tool to give the model an early warning before
 * attempting edits that would fail.
 */
export function getApprovalHint(
  sessionManager:
    | { getEntries(): SessionEntry[]; getLeafId(): string | null }
    | undefined,
  filePath: string,
): string | undefined {
  if (sessionManager === undefined) return undefined

  const entries = sessionManager.getEntries()
  const leafId = sessionManager.getLeafId()
  const { messages } = buildSessionContext(entries, leafId)
  const approvalState = reconstructApprovalState(messages)

  const { approved, pending } = approvalState
  if (approved === undefined && pending === undefined) return undefined

  const normalizedPath = normalizePath(filePath)
  const editApproved = isFileApproved(approvalState, normalizedPath, 'edit')
  const writeApproved = isFileApproved(approvalState, normalizedPath, 'write')

  if (editApproved && writeApproved) return undefined

  const proposalId = approved?.id ?? pending?.id
  const reference = proposalId === undefined ? '' : ` (Proposal #${proposalId})`
  return `This file ${getApprovalStatusText(editApproved, writeApproved)}${reference}`
}

function getApprovalStatusText(
  editApproved: boolean,
  writeApproved: boolean,
): string {
  const suffix = 'unless you create a new proposal first.'
  if (editApproved) {
    return `is approved for edit but not write. Any write to this path will be blocked ${suffix}`
  }
  if (writeApproved) {
    return `is approved for write but not edit. Any edit to this path will be blocked ${suffix}`
  }
  return `is not in the current approved scope. Any edit or write to this path will be blocked ${suffix}`
}
