import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { buildSessionContext } from '@earendil-works/pi-coding-agent'

import { normalizePath } from './helpers.js'
import { isRecord } from './type-guards.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileOperation = 'edit' | 'write'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface FileScope {
  path: string
  operation: FileOperation
  intent: string
}

export interface BashScope {
  pattern: string
  riskLevel: RiskLevel
  intent: string
  allowedPaths: string[]
}

// Discriminated union for tool result details coming from the approval tool

export interface ProposalDetails {
  action: 'proposal'
  id: string
  summary?: string
  fileScopes: FileScope[]
  bashScopes: BashScope[]
}

export interface AmendmentDetails {
  action: 'amendment'
  id: string
  fileScopes?: FileScope[]
  bashScopes?: BashScope[]
}

export interface CompleteDetails {
  action: 'complete'
  id: string
  reason?: string
}

export type ApprovalDetails =
  | ProposalDetails
  | AmendmentDetails
  | CompleteDetails

interface ApprovedProposal {
  id: string
  fileScopes: FileScope[]
  bashScopes: BashScope[]
  pendingAmendment?: { fileScopes: FileScope[]; bashScopes: BashScope[] }
}

interface PendingProposal {
  id: string
  fileScopes: FileScope[]
  bashScopes: BashScope[]
  pendingAmendment?: { fileScopes: FileScope[]; bashScopes: BashScope[] }
}

export interface ApprovalState {
  pending: PendingProposal | undefined
  approved: ApprovedProposal | undefined
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_FILE_OPERATIONS: ReadonlySet<string> = new Set(['edit', 'write'])
const VALID_RISK_LEVELS: ReadonlySet<string> = new Set([
  'low',
  'medium',
  'high',
  'critical',
])
const VALID_ACTIONS: ReadonlySet<string> = new Set([
  'proposal',
  'amendment',
  'complete',
])

const APPROVAL_PHRASE_RE =
  /\b(?:yes|proceed|approved|do it|go ahead|looks good)\b/i

const RISK_RANK: Readonly<Record<RiskLevel, number>> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isFileOperation(value: string): value is FileOperation {
  return VALID_FILE_OPERATIONS.has(value)
}

function isRiskLevel(value: string): value is RiskLevel {
  return VALID_RISK_LEVELS.has(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isFileScope(value: unknown): value is FileScope {
  if (!isRecord(value)) return false

  const operation = value['operation']
  return (
    typeof value['path'] === 'string' &&
    typeof operation === 'string' &&
    isFileOperation(operation) &&
    typeof value['intent'] === 'string'
  )
}

function isBashScope(value: unknown): value is BashScope {
  if (!isRecord(value)) return false

  const riskLevel = value['riskLevel']
  return (
    typeof value['pattern'] === 'string' &&
    typeof riskLevel === 'string' &&
    isRiskLevel(riskLevel) &&
    typeof value['intent'] === 'string' &&
    isStringArray(value['allowedPaths'])
  )
}

// ---------------------------------------------------------------------------
// Public: isApprovalDetails
// ---------------------------------------------------------------------------

function isProposalDetails(object: Record<string, unknown>): boolean {
  const fileScopes = object['fileScopes']
  if (!Array.isArray(fileScopes)) return false
  if (!fileScopes.every(isFileScope)) return false

  const bashScopes = object['bashScopes']
  if (!Array.isArray(bashScopes)) return false
  if (!bashScopes.every(isBashScope)) return false

  return (
    object['summary'] === undefined || typeof object['summary'] === 'string'
  )
}

function isAmendmentDetails(object: Record<string, unknown>): boolean {
  const fileScopes = object['fileScopes']
  if (fileScopes !== undefined) {
    if (!Array.isArray(fileScopes)) return false
    if (!fileScopes.every(isFileScope)) return false
  }

  const bashScopes = object['bashScopes']
  if (bashScopes !== undefined) {
    if (!Array.isArray(bashScopes)) return false
    if (!bashScopes.every(isBashScope)) return false
  }
  return true
}

function isCompleteDetails(object: Record<string, unknown>): boolean {
  return object['reason'] === undefined || typeof object['reason'] === 'string'
}

export function isApprovalDetails(value: unknown): value is ApprovalDetails {
  if (!isRecord(value)) return false

  const action = value['action']
  if (typeof action !== 'string') return false
  if (!VALID_ACTIONS.has(action)) return false
  if (typeof value['id'] !== 'string') return false

  switch (action) {
    case 'proposal': {
      return isProposalDetails(value)
    }
    case 'amendment': {
      return isAmendmentDetails(value)
    }
    case 'complete': {
      return isCompleteDetails(value)
    }
    default: {
      return false
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers for message scanning
// ---------------------------------------------------------------------------

function isTextBlock(block: unknown): block is { type: 'text'; text: string } {
  return (
    isRecord(block) &&
    block['type'] === 'text' &&
    typeof block['text'] === 'string'
  )
}

function extractUserText(message: AgentMessage): string {
  if (message.role !== 'user') return ''
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = content.filter(isTextBlock).map((block) => block.text)
  return parts.join(' ')
}

function isApprovalToolResult(
  message: AgentMessage,
): message is AgentMessage & { details: unknown } {
  if (message.role !== 'toolResult') return false
  if (message.toolName !== 'approval') return false
  if (message.isError) return false
  return true
}

// ---------------------------------------------------------------------------
// State machine helpers
// ---------------------------------------------------------------------------

function handleProposal(details: ProposalDetails, state: ApprovalState): void {
  // Supersede any existing pending
  state.pending = {
    id: details.id,
    fileScopes: [...details.fileScopes],
    bashScopes: [...details.bashScopes],
  }
}

function handleAmendment(
  details: AmendmentDetails,
  state: ApprovalState,
): void {
  const amendmentScopes: { fileScopes: FileScope[]; bashScopes: BashScope[] } =
    {
      fileScopes: details.fileScopes ?? [],
      bashScopes: details.bashScopes ?? [],
    }

  // Attach to approved proposal if one exists
  if (state.approved === undefined) {
    // Otherwise attach to pending
    const p = state.pending
    if (p !== undefined) {
      p.pendingAmendment = amendmentScopes
    }
  } else {
    state.approved = {
      ...state.approved,
      pendingAmendment: amendmentScopes,
    }
  }
}

function handleComplete(_details: CompleteDetails, state: ApprovalState): void {
  state.approved = undefined
}

function promotePendingToApproved(state: ApprovalState): void {
  const p = state.pending
  if (p === undefined) return

  const approvedFileScopes = [...p.fileScopes]
  const approvedBashScopes = [...p.bashScopes]
  const amend = p.pendingAmendment

  if (amend !== undefined) {
    approvedFileScopes.push(...amend.fileScopes)
    approvedBashScopes.push(...amend.bashScopes)
  }

  state.approved = {
    id: p.id,
    fileScopes: approvedFileScopes,
    bashScopes: approvedBashScopes,
  }
  state.pending = undefined
}

function promoteApprovedAmendment(state: ApprovalState): void {
  const a = state.approved
  if (a === undefined) return
  const amend = a.pendingAmendment
  if (amend === undefined) return

  const mergedFileScopes = [...a.fileScopes, ...amend.fileScopes]
  const mergedBashScopes = [...a.bashScopes, ...amend.bashScopes]

  state.approved = {
    id: a.id,
    fileScopes: mergedFileScopes,
    bashScopes: mergedBashScopes,
  }
}

function hasApprovalPhrase(text: string): boolean {
  return APPROVAL_PHRASE_RE.test(text)
}

function handleUserMessage(message: AgentMessage, state: ApprovalState): void {
  const text = extractUserText(message)
  if (!hasApprovalPhrase(text)) return

  if (state.pending !== undefined) {
    promotePendingToApproved(state)
  } else if (state.approved?.pendingAmendment !== undefined) {
    promoteApprovedAmendment(state)
  }
}

function processMessage(message: AgentMessage, state: ApprovalState): void {
  if (isApprovalToolResult(message) && isApprovalDetails(message.details)) {
    switch (message.details.action) {
      case 'proposal': {
        handleProposal(message.details, state)
        break
      }
      case 'amendment': {
        handleAmendment(message.details, state)
        break
      }
      case 'complete': {
        handleComplete(message.details, state)
        break
      }
    }
    return
  }

  if (message.role === 'user') {
    handleUserMessage(message, state)
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function reconstructApprovalState(
  messages: AgentMessage[],
): ApprovalState {
  const state: ApprovalState = {
    pending: undefined,
    approved: undefined,
  }

  for (const message of messages) {
    processMessage(message, state)
  }

  return state
}

export function formatApprovalReminder(
  state: ApprovalState,
): string | undefined {
  const approved = state.approved
  if (approved === undefined) return undefined
  if (approved.fileScopes.length === 0 && approved.bashScopes.length === 0) {
    return undefined
  }

  const lines: string[] = [
    `## Approved Scope (Proposal #${approved.id})`,
    'The following operations are pre-approved by the user:',
  ]

  if (approved.fileScopes.length > 0) {
    lines.push('', '### File operations')
    for (const scope of approved.fileScopes) {
      lines.push(`- ${scope.operation} \`${scope.path}\` — ${scope.intent}`)
    }
  }

  if (approved.bashScopes.length > 0) {
    lines.push('', '### Bash operations')
    for (const scope of approved.bashScopes) {
      lines.push(
        `- \`${scope.pattern}\` (risk=${scope.riskLevel}) — ${scope.intent}`,
      )
    }
  }

  lines.push(
    '',
    'Anything outside this scope requires an amendment proposal followed by explicit user approval.',
  )

  return lines.join('\n')
}

export function isFileApproved(
  state: ApprovalState,
  filePath: string,
  operation: FileOperation,
): boolean {
  const approved = state.approved
  if (approved === undefined) return false

  return approved.fileScopes.some(
    (scope) => scope.path === filePath && scope.operation === operation,
  )
}

export function isBashApproved(
  state: ApprovalState,
  command: string,
  riskLevel: RiskLevel,
): boolean {
  const approved = state.approved
  if (approved === undefined) return false

  const attemptedRank = RISK_RANK[riskLevel]

  return approved.bashScopes.some((scope) => {
    if (RISK_RANK[scope.riskLevel] < attemptedRank) return false
    if (scope.pattern === command) return true
    if (command.includes(scope.pattern)) return true
    return false
  })
}

function formatBlockedFileMessage(
  state: ApprovalState,
  filePath: string,
  operation: FileOperation,
): string {
  const pendingId = state.pending?.id ?? state.approved?.id
  const reference =
    pendingId === undefined ? '' : ` See Proposal #${pendingId}.`

  return `Blocked: ${operation} to \`${filePath}\` is outside the active approved scope.${reference} Create an amendment proposal listing this path, operation, and intent, then wait for user approval.`
}

export function formatBlockedBashMessage(
  state: ApprovalState,
  command: string,
  riskLevel: RiskLevel,
): string {
  const pendingId = state.pending?.id ?? state.approved?.id
  const reference =
    pendingId === undefined ? '' : ` See Proposal #${pendingId}.`

  return `Blocked: bash command \`${command}\` (risk=${riskLevel}) is outside the active approved scope.${reference} Create an amendment proposal listing this command pattern, risk level, intent, and allowed paths, then wait for user approval.`
}

export function checkFileBlocked(
  sessionManager: { getEntries(): SessionEntry[]; getLeafId(): string | null },
  filePath: string,
  operation: FileOperation,
):
  | {
      content: { type: 'text'; text: string }[]
      details: undefined
      isError: true
    }
  | undefined {
  const entries = sessionManager.getEntries()
  const leafId = sessionManager.getLeafId()
  const { messages } = buildSessionContext(entries, leafId)
  const approvalState = reconstructApprovalState(messages)
  const normalizedPath = normalizePath(filePath)
  if (!isFileApproved(approvalState, normalizedPath, operation)) {
    return {
      content: [
        {
          type: 'text',
          text: formatBlockedFileMessage(
            approvalState,
            normalizedPath,
            operation,
          ),
        },
      ],
      details: undefined,
      isError: true,
    }
  }
  return undefined
}
