import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import {
  buildSessionContext,
  defineTool,
} from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'

import {
  reconstructApprovalState,
  type AmendmentDetails,
  type ApprovalDetails,
  type ApprovalState,
  type BashScope,
  type CompleteDetails,
  type FileScope,
  type ProposalDetails,
} from '../utils/approval-state.js'

type ApprovalToolAction = 'proposal' | 'amendment' | 'complete'

export interface ApprovalToolParameters {
  action: ApprovalToolAction
  id: string
  summary?: string
  fileScopes?: FileScope[]
  bashScopes?: BashScope[]
  reason?: string
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

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
      ],
      {
        description:
          'Approval lifecycle action: record a new proposal, amend an existing one, or mark one complete.',
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
  },
  { additionalProperties: false },
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function buildDetails(parameters: ApprovalToolParameters): ApprovalDetails {
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
        'Confirm if you want me to proceed.',
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
        'Confirm if you want me to proceed.',
      ].join('\n')
    }
    case 'complete': {
      return `Proposal #${parameters.id} marked complete.`
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

function reconstructState(context: {
  sessionManager: {
    getEntries: () => Parameters<typeof buildSessionContext>[0]
    getLeafId: () => string | null
  }
}): ApprovalState {
  const entries = context.sessionManager.getEntries()
  const leafId = context.sessionManager.getLeafId()
  const { messages } = buildSessionContext(entries, leafId)
  return reconstructApprovalState(messages)
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

/** @public */
export const approvalTool = defineTool({
  name: 'approval',
  label: 'Approval',
  description:
    'Manage the user-approved scope that gates subsequent file and bash operations. ' +
    'Use action="proposal" to record a new proposal listing the files you intend to edit/write and the bash commands you intend to run, with intent for each. ' +
    'Use action="amendment" to extend the scope of a pending or approved proposal. ' +
    'Use action="complete" once the proposal is fully delivered; the approved scope is then cleared. ' +
    'The tool never approves a proposal itself: approval is derived from later user messages containing phrases such as "proceed" or "yes", and applies only to the most recent pending proposal.',
  parameters: parametersSchema,
  execute(
    _toolCallId,
    parameters: ApprovalToolParameters,
    _signal,
    _onUpdate,
    context,
  ): Promise<{
    content: { type: 'text'; text: string }[]
    details: ApprovalDetails
  }> {
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
