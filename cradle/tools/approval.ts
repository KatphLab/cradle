import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import {
  buildSessionContext,
  defineTool,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'

import {
  isFileApproved,
  reconstructApprovalState,
  type AmendmentDetails,
  type ApprovalDetails,
  type ApprovalState,
  type BashScope,
  type CompleteDetails,
  type FileScope,
  type ProposalDetails,
  type ReplayDetails,
} from '../utils/approval-state.js'
import {
  reconstructDeferredOperations,
  type DeferredOperationDetails,
} from '../utils/deferred-operations.js'
import { executeApprovedEdit } from './edit.js'
import { executeApprovedWrite } from './write.js'

type ApprovalToolAction = 'proposal' | 'amendment' | 'complete' | 'replay'

export interface ApprovalToolParameters {
  action: ApprovalToolAction
  id: string
  summary?: string
  fileScopes?: FileScope[]
  bashScopes?: BashScope[]
  reason?: string
  operationIds?: string[]
}

const fileOperationSchema = Type.Union(
  [Type.Literal('edit'), Type.Literal('write')],
  { description: 'Kind of file operation included in the scope' },
)

const riskLevelSchema = Type.Union(
  [
    Type.Literal('low'),
    Type.Literal('medium'),
    Type.Literal('high'),
    Type.Literal('critical'),
  ],
  { description: 'Risk tier the command operates at' },
)

const fileScopeSchema = Type.Object(
  {
    path: Type.String({ description: 'Path the operation targets' }),
    operation: fileOperationSchema,
    intent: Type.String({
      description: 'Why this file scope is part of the proposal',
    }),
  },
  { additionalProperties: false },
)

const bashScopeSchema = Type.Object(
  {
    pattern: Type.String({
      description: 'Command or substring the scope matches against',
    }),
    riskLevel: riskLevelSchema,
    intent: Type.String({
      description: 'Why this bash scope is part of the proposal',
    }),
    allowedPaths: Type.Array(Type.String(), {
      description: 'Side-effect paths this command is allowed to modify',
    }),
  },
  { additionalProperties: false },
)

const parametersSchema = Type.Object(
  {
    action: Type.Union(
      [
        Type.Literal('proposal'),
        Type.Literal('amendment'),
        Type.Literal('complete'),
        Type.Literal('replay'),
      ],
      {
        description:
          'Approval lifecycle action: record a new proposal, amend an existing one, replay deferred operations, or mark one complete.',
      },
    ),
    id: Type.String({ description: 'Stable proposal identifier' }),
    summary: Type.Optional(
      Type.String({ description: 'Optional human-readable summary' }),
    ),
    fileScopes: Type.Optional(
      Type.Array(fileScopeSchema, { description: 'File operation scopes' }),
    ),
    bashScopes: Type.Optional(
      Type.Array(bashScopeSchema, { description: 'Bash command scopes' }),
    ),
    reason: Type.Optional(
      Type.String({
        description: 'Optional note attached to the complete action',
      }),
    ),
    operationIds: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Deferred operation ids to replay',
      }),
    ),
  },
  { additionalProperties: false },
)

function buildProposalDetails(
  parameters: ApprovalToolParameters,
): ProposalDetails {
  const base: ProposalDetails = {
    action: 'proposal',
    id: parameters.id,
    fileScopes: parameters.fileScopes ?? [],
    bashScopes: parameters.bashScopes ?? [],
  }
  if (parameters.summary !== undefined) {
    return { ...base, summary: parameters.summary }
  }
  return base
}

function buildAmendmentDetails(
  parameters: ApprovalToolParameters,
): AmendmentDetails {
  const base: AmendmentDetails = { action: 'amendment', id: parameters.id }
  if (parameters.fileScopes !== undefined) {
    return { ...base, fileScopes: parameters.fileScopes }
  }
  if (parameters.bashScopes !== undefined) {
    return { ...base, bashScopes: parameters.bashScopes }
  }
  return base
}

function buildCompleteDetails(
  parameters: ApprovalToolParameters,
): CompleteDetails {
  if (parameters.reason !== undefined) {
    return {
      action: 'complete',
      id: parameters.id,
      reason: parameters.reason,
    }
  }
  return { action: 'complete', id: parameters.id }
}

function buildReplayDetails(
  parameters: ApprovalToolParameters,
  replayedIds: string[],
): ReplayDetails {
  return {
    action: 'replay',
    id: parameters.id,
    operationIds: parameters.operationIds ?? [],
    replayedIds,
  }
}

function buildDetails(
  parameters: ApprovalToolParameters,
  replayedIds: string[] = [],
): ApprovalDetails {
  switch (parameters.action) {
    case 'proposal': {
      return buildProposalDetails(parameters)
    }
    case 'amendment': {
      return buildAmendmentDetails(parameters)
    }
    case 'complete': {
      return buildCompleteDetails(parameters)
    }
    case 'replay': {
      return buildReplayDetails(parameters, replayedIds)
    }
  }
}

function countScopes(parameters: ApprovalToolParameters): number {
  return (
    (parameters.fileScopes?.length ?? 0) + (parameters.bashScopes?.length ?? 0)
  )
}

function formatFileScopes(scopes: FileScope[]): string[] {
  if (scopes.length === 0) return []

  return [
    '### File operations',
    ...scopes.map(
      (scope) => `- ${scope.operation} \`${scope.path}\` — ${scope.intent}`,
    ),
  ]
}

function formatBashScopes(scopes: BashScope[]): string[] {
  if (scopes.length === 0) return []

  return [
    '### Bash operations',
    ...scopes.map((scope) => {
      const paths =
        scope.allowedPaths.length === 0
          ? 'none'
          : scope.allowedPaths.map((path) => `\`${path}\``).join(', ')
      return `- \`${scope.pattern}\` (risk=${scope.riskLevel}, allowed paths: ${paths}) — ${scope.intent}`
    }),
  ]
}

function formatRequestedScope(parameters: ApprovalToolParameters): string[] {
  const sections = [
    ...formatFileScopes(parameters.fileScopes ?? []),
    ...formatBashScopes(parameters.bashScopes ?? []),
  ]

  if (sections.length === 0) return []
  return ['', ...sections]
}

function formatApprovalResponse(parameters: ApprovalToolParameters): string {
  switch (parameters.action) {
    case 'proposal': {
      const lines = [`## Approval proposal #${parameters.id}`]
      if (parameters.summary !== undefined) lines.push('', parameters.summary)
      lines.push(
        '',
        'I need approval for the following scope:',
        ...formatRequestedScope(parameters),
        '',
        'Reply with exactly `<yes>`, `<approve>`, or `<proceed>` to approve this scope. Until then, this proposal is not authorization.',
      )
      return lines.join('\n')
    }
    case 'amendment': {
      return [
        `## Approval amendment #${parameters.id}`,
        '',
        'I need approval for this additional scope:',
        ...formatRequestedScope(parameters),
        '',
        'Reply with exactly `<yes>`, `<approve>`, or `<proceed>` to approve this additional scope. Until then, this amendment is not authorization.',
      ].join('\n')
    }
    case 'complete': {
      return `Proposal #${parameters.id} marked complete.`
    }
    case 'replay': {
      const ids = parameters.operationIds ?? []
      const formattedIds = ids.map((id) => `#${id}`).join(', ')
      return `Replayed deferred operation(s): ${formattedIds}.`
    }
  }
}

function formatResultText(result: AgentToolResult<ApprovalDetails>): string {
  return result.content
    .filter(
      (item): item is { type: 'text'; text: string } => item.type === 'text',
    )
    .map((item) => item.text)
    .join('\n')
}

function reconstructSession(context: {
  sessionManager: {
    getEntries: () => Parameters<typeof buildSessionContext>[0]
    getLeafId: () => string | null
  }
}): { state: ApprovalState; deferred: DeferredOperationDetails[] } {
  const entries = context.sessionManager.getEntries()
  const leafId = context.sessionManager.getLeafId()
  const { messages } = buildSessionContext(entries, leafId)
  return {
    state: reconstructApprovalState(messages),
    deferred: reconstructDeferredOperations(messages).operations,
  }
}

function reconstructState(context: {
  sessionManager: {
    getEntries: () => Parameters<typeof buildSessionContext>[0]
    getLeafId: () => string | null
  }
}): ApprovalState {
  return reconstructSession(context).state
}

async function executeDeferredOperation(
  operation: DeferredOperationDetails,
  context: ExtensionContext,
): Promise<AgentToolResult<unknown>> {
  if (operation.toolName === 'edit') {
    return executeApprovedEdit(
      `replay-${operation.id}`,
      operation.parameters,
      context.signal,
      undefined,
      context,
    )
  }

  return executeApprovedWrite(
    `replay-${operation.id}`,
    operation.parameters,
    context.signal,
    undefined,
    context,
  )
}

async function executeReplay(
  parameters: ApprovalToolParameters,
  context: ExtensionContext,
): Promise<AgentToolResult<ApprovalDetails>> {
  const operationIds = parameters.operationIds ?? []
  if (operationIds.length === 0) {
    throw new Error(`Approval replay #${parameters.id} requires operationIds.`)
  }

  const { state, deferred } = reconstructSession(context)
  const approvedId = state.approved?.id
  if (approvedId !== parameters.id) {
    const approvedLabel = approvedId === undefined ? 'none' : `#${approvedId}`
    throw new Error(
      `Cannot replay approval #${parameters.id}: currently approved proposal is ${approvedLabel}.`,
    )
  }

  const operationsById = new Map(
    deferred.map((operation) => [operation.id, operation]),
  )
  const selectedOperations = operationIds.map((id) => {
    const operation = operationsById.get(id)
    if (operation === undefined) {
      throw new Error(`Cannot replay deferred operation #${id}: not found.`)
    }
    if (!isFileApproved(state, operation.path, operation.operation)) {
      throw new Error(
        `Cannot replay deferred operation #${id}: ${operation.operation} to \`${operation.path}\` is outside the active approved scope.`,
      )
    }
    return operation
  })

  const replayedIds: string[] = []
  const lines: string[] = []

  for (const operation of selectedOperations) {
    const result = await executeDeferredOperation(operation, context)
    if ('isError' in result && result.isError === true) {
      return {
        content: [
          {
            type: 'text',
            text: [
              ...lines,
              `Deferred operation #${operation.id} failed during replay.`,
              ...result.content
                .filter(
                  (item): item is { type: 'text'; text: string } =>
                    item.type === 'text',
                )
                .map((item) => item.text),
            ].join('\n'),
          },
        ],
        details: buildReplayDetails(parameters, replayedIds),
        isError: true,
      } as AgentToolResult<ApprovalDetails>
    }

    replayedIds.push(operation.id)
    lines.push(`Replayed deferred operation #${operation.id}.`)
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    details: buildReplayDetails(parameters, replayedIds),
  }
}

/** @public */
export const approvalTool = defineTool({
  name: 'approval',
  label: 'Approval',
  description:
    'Manage the user-approved scope that gates subsequent file and bash operations. ' +
    'Use action="proposal" to record a new proposal listing the files you intend to edit/write and the bash commands you intend to run, with intent for each. ' +
    'Use action="amendment" to extend the scope of a pending or approved proposal. ' +
    'Use action="replay" with operationIds to replay previously blocked write/edit calls after their file scope is approved. ' +
    'Use action="complete" once the proposal is fully delivered; the approved scope is then cleared. ' +
    'The tool never approves a proposal itself: approval is derived from later user messages containing tags such as "<proceed>" or "<yes>", and applies only to the most recent pending proposal.',
  parameters: parametersSchema,
  execute(
    _toolCallId,
    parameters: ApprovalToolParameters,
    _signal,
    _onUpdate,
    context,
  ): Promise<AgentToolResult<ApprovalDetails>> {
    if (
      (parameters.action === 'proposal' || parameters.action === 'amendment') &&
      countScopes(parameters) === 0
    ) {
      return Promise.reject(
        new Error(
          `Approval ${parameters.action} #${parameters.id} requires at least one file or bash scope.`,
        ),
      )
    }

    if (parameters.action === 'complete') {
      const state = reconstructState(context)
      const approvedId = state.approved?.id
      if (approvedId !== parameters.id) {
        const approvedLabel =
          approvedId === undefined ? 'none' : `#${approvedId}`
        return Promise.reject(
          new Error(
            `Cannot complete approval #${parameters.id}: currently approved proposal is ${approvedLabel}.`,
          ),
        )
      }
    }

    if (parameters.action === 'replay') {
      return executeReplay(parameters, context)
    }

    const details = buildDetails(parameters)
    return Promise.resolve({
      content: [{ type: 'text', text: formatApprovalResponse(parameters) }],
      details,
    })
  },

  renderResult(result, _options, theme) {
    return new Text(theme.fg('toolOutput', formatResultText(result)), 0, 0)
  },
})
