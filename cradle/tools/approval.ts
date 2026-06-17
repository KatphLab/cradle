import { Type } from '@earendil-works/pi-ai'
import {
  buildSessionContext,
  defineTool,
  type Theme,
} from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'

import {
  isApprovalDetails,
  reconstructApprovalState,
  type AmendmentDetails,
  type ApprovalDetails,
  type ApprovalState,
  type BashScope,
  type CompleteDetails,
  type FileScope,
  type ProposalDetails,
} from '../utils/approval-state.js'
import { createModeRenderResult } from '../utils/tool-render.js'

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

function summarize(parameters: ApprovalToolParameters): string {
  switch (parameters.action) {
    case 'proposal': {
      const total = countScopes(parameters)
      const label = total === 1 ? 'scope' : 'scopes'
      return parameters.summary === undefined
        ? `Proposal #${parameters.id} recorded with ${String(total)} ${label}.`
        : `Proposal #${parameters.id}: ${parameters.summary} — recorded with ${String(total)} ${label}.`
    }
    case 'amendment': {
      const total = countScopes(parameters)
      const label = total === 1 ? 'scope' : 'scopes'
      return `Amendment #${parameters.id} recorded with ${String(total)} ${label}.`
    }
    case 'complete': {
      return `Proposal #${parameters.id} marked complete.`
    }
  }
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

function formatHeader(details: unknown, isError: boolean, theme: Theme): Text {
  const title = theme.fg('toolTitle', theme.bold('approval'))
  if (isError) return new Text(`${title} ${theme.fg('error', '✗')}`, 0, 0)
  if (isApprovalDetails(details)) {
    return new Text(`${title} ${theme.fg('success', '✓')}`, 0, 0)
  }
  return new Text(`${title} ${theme.fg('warning', '…')}`, 0, 0)
}

function formatHidden(isError: boolean, theme: Theme): Text {
  const icon = isError ? theme.fg('error', '✗') : theme.fg('success', '✓')
  return new Text(`${icon} ${theme.fg('toolTitle', 'approval')}`, 0, 0)
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
      content: [{ type: 'text', text: summarize(parameters) }],
      details,
    })
  },

  renderResult: createModeRenderResult<ApprovalDetails>({
    formatHeader: (details, isError, _isPartial, theme) =>
      formatHeader(details, isError, theme),
    formatHidden: (isError, _isPartial, theme) => formatHidden(isError, theme),
  }),
})
