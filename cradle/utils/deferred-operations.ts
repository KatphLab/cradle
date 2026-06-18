import type {
  AgentMessage,
  AgentToolResult,
} from '@earendil-works/pi-agent-core'

import {
  extractUserText,
  hasApprovalPhrase,
  type FileOperation,
  type FileScope,
} from './approval-state.js'
import { normalizePath } from './helpers.js'
import { isRecord } from './type-guards.js'

export type DeferredToolName = 'edit' | 'write'

export interface DeferredEditParameters {
  path: string
  edits: {
    from: number
    fromHash: string
    to: number
    toHash: string
    newText: string
  }[]
}

export interface DeferredWriteParameters {
  path: string
  content: string
}

export type DeferredOperationParameters =
  | DeferredEditParameters
  | DeferredWriteParameters

interface BaseDeferredOperationDetails {
  kind: 'deferred-operation'
  id: string
  path: string
  requiredScope: FileScope
  reason: string
}

export interface DeferredEditOperationDetails extends BaseDeferredOperationDetails {
  toolName: 'edit'
  operation: 'edit'
  parameters: DeferredEditParameters
}

export interface DeferredWriteOperationDetails extends BaseDeferredOperationDetails {
  toolName: 'write'
  operation: 'write'
  parameters: DeferredWriteParameters
}

export type DeferredOperationDetails =
  | DeferredEditOperationDetails
  | DeferredWriteOperationDetails

export interface DeferredOperationsState {
  operations: DeferredOperationDetails[]
}

interface ReplayDetailsLike {
  action: 'replay'
  replayedIds: string[]
}

function isEditParameter(value: unknown): value is DeferredEditParameters {
  if (!isRecord(value)) return false
  const edits = value['edits']
  return (
    typeof value['path'] === 'string' &&
    Array.isArray(edits) &&
    edits.every(
      (edit) =>
        isRecord(edit) &&
        typeof edit['from'] === 'number' &&
        typeof edit['fromHash'] === 'string' &&
        typeof edit['to'] === 'number' &&
        typeof edit['toHash'] === 'string' &&
        typeof edit['newText'] === 'string',
    )
  )
}

function isWriteParameter(value: unknown): value is DeferredWriteParameters {
  return (
    isRecord(value) &&
    typeof value['path'] === 'string' &&
    typeof value['content'] === 'string'
  )
}

function hasBaseDeferredFields(value: Record<string, unknown>): boolean {
  return (
    value['kind'] === 'deferred-operation' &&
    typeof value['id'] === 'string' &&
    typeof value['path'] === 'string' &&
    typeof value['reason'] === 'string'
  )
}

function hasRequiredScope(value: Record<string, unknown>): boolean {
  const requiredScope = value['requiredScope']
  return (
    isRecord(requiredScope) &&
    requiredScope['path'] === value['path'] &&
    requiredScope['operation'] === value['operation'] &&
    typeof requiredScope['intent'] === 'string'
  )
}

function hasDeferredEditShape(value: Record<string, unknown>): boolean {
  return (
    value['toolName'] === 'edit' &&
    value['operation'] === 'edit' &&
    isEditParameter(value['parameters'])
  )
}

function hasDeferredWriteShape(value: Record<string, unknown>): boolean {
  return (
    value['toolName'] === 'write' &&
    value['operation'] === 'write' &&
    isWriteParameter(value['parameters'])
  )
}

export function isDeferredOperationDetails(
  value: unknown,
): value is DeferredOperationDetails {
  if (!isRecord(value)) return false
  if (!hasBaseDeferredFields(value)) return false
  if (!hasRequiredScope(value)) return false
  return hasDeferredEditShape(value) || hasDeferredWriteShape(value)
}

function isReplayDetailsLike(value: unknown): value is ReplayDetailsLike {
  return (
    isRecord(value) &&
    value['action'] === 'replay' &&
    Array.isArray(value['replayedIds']) &&
    value['replayedIds'].every((id) => typeof id === 'string')
  )
}

function buildDeferredResult<T extends DeferredOperationDetails>(
  details: T,
  blockedText: string,
): AgentToolResult<T> & { isError: true } {
  return {
    content: [
      {
        type: 'text',
        text: [
          blockedText,
          `Deferred operation #${details.id} was captured. After approval, replay it with approval action="replay" and operationIds=["${details.id}"].`,
        ].join('\n'),
      },
    ],
    details,
    isError: true,
  }
}

export function createDeferredOperationResult(
  toolCallId: string,
  toolName: 'edit',
  parameters: DeferredEditParameters,
  blockedText: string,
): AgentToolResult<DeferredEditOperationDetails> & { isError: true }
export function createDeferredOperationResult(
  toolCallId: string,
  toolName: 'write',
  parameters: DeferredWriteParameters,
  blockedText: string,
): AgentToolResult<DeferredWriteOperationDetails> & { isError: true }
export function createDeferredOperationResult(
  toolCallId: string,
  toolName: DeferredToolName,
  parameters: DeferredOperationParameters,
  blockedText: string,
): AgentToolResult<DeferredOperationDetails> & { isError: true } {
  const path = normalizePath(parameters.path)
  const id = `deferred-${toolCallId}`
  const operation: FileOperation = toolName
  const requiredScope: FileScope = {
    path,
    operation,
    intent: `Replay deferred ${operation} to ${path}`,
  }

  if (toolName === 'edit' && isEditParameter(parameters)) {
    return buildDeferredResult(
      {
        kind: 'deferred-operation',
        id,
        toolName,
        path,
        operation: toolName,
        parameters,
        requiredScope,
        reason: blockedText,
      },
      blockedText,
    )
  }

  if (toolName === 'write' && isWriteParameter(parameters)) {
    return buildDeferredResult(
      {
        kind: 'deferred-operation',
        id,
        toolName,
        path,
        operation: toolName,
        parameters,
        requiredScope,
        reason: blockedText,
      },
      blockedText,
    )
  }

  throw new Error(`Cannot defer invalid ${toolName} parameters.`)
}

function applyToolResultMessage(
  message: AgentMessage,
  operationsById: Map<string, DeferredOperationDetails>,
): boolean {
  if (message.role !== 'toolResult') return false

  const details: unknown = message.details
  if (isDeferredOperationDetails(details)) {
    operationsById.set(details.id, details)
    return true
  }

  if (isReplayDetailsLike(details)) {
    for (const id of details.replayedIds) {
      operationsById.delete(id)
    }
    return true
  }

  return false
}

function isNonApprovalUserMessage(message: AgentMessage): boolean {
  return message.role === 'user' && !hasApprovalPhrase(extractUserText(message))
}

export function reconstructDeferredOperations(
  messages: AgentMessage[],
): DeferredOperationsState {
  const operationsById = new Map<string, DeferredOperationDetails>()

  for (const message of messages) {
    if (applyToolResultMessage(message, operationsById)) continue
    if (isNonApprovalUserMessage(message)) operationsById.clear()
  }

  return { operations: [...operationsById.values()] }
}
