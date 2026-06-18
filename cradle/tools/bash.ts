import { Type } from '@earendil-works/pi-ai'
import {
  buildSessionContext,
  createBashToolDefinition,
  defineTool,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import path from 'node:path'

import { assertPermission } from '../config/settings.js'
import {
  classifyShellRisk,
  loadShellRiskPatterns,
  type RiskLevel,
} from '../config/shell-risk.js'
import {
  formatBlockedBashFileWriteMessage,
  formatBlockedBashMessage,
  isBashApproved,
  reconstructApprovalState,
  type ApprovalState,
} from '../utils/approval-state.js'
import {
  detectBashFileWrites,
  type BashFileWriteDetection,
} from '../utils/bash-file-write-detector.js'
import { normalizePath } from '../utils/helpers.js'
import {
  renderToolCallWithMode,
  renderToolResultWithMode,
} from '../utils/tool-render.js'

function resolveEffectiveRisk(
  declaredRisk: RiskLevel,
  declaredReason: string,
  detected: { level: RiskLevel; reason: string } | undefined,
): { effectiveRisk: RiskLevel; effectiveReason: string } {
  if (detected) {
    // Override if the model under-declared the risk.
    const upgraded = riskRank(declaredRisk) >= riskRank(detected.level)
    return {
      effectiveRisk: upgraded ? declaredRisk : detected.level,
      effectiveReason: upgraded ? declaredReason : detected.reason,
    }
  }
  return { effectiveRisk: declaredRisk, effectiveReason: declaredReason }
}

function riskRank(level: RiskLevel): number {
  switch (level) {
    case 'low': {
      return 1
    }
    case 'medium': {
      return 2
    }
    case 'high': {
      return 3
    }
    case 'critical': {
      return 4
    }
  }
}

interface BashToolParameters {
  command: string
  summary?: string
  description?: string
  riskLevel: RiskLevel
  riskReason: string
  timeout?: number
}

function textResult(text: string): {
  content: { type: 'text'; text: string }[]
  details: undefined
} {
  return { content: [{ type: 'text', text }], details: undefined }
}

function reconstructToolApprovalState(
  context: ExtensionContext,
): ApprovalState {
  const entries = context.sessionManager.getEntries()
  const leafId = context.sessionManager.getLeafId()
  const { messages } = buildSessionContext(entries, leafId)
  return reconstructApprovalState(messages)
}

async function assessCommandRisk(
  parameters: BashToolParameters,
  cwd: string,
): Promise<{
  detected: { level: RiskLevel; reason: string } | undefined
  effectiveRisk: RiskLevel
  effectiveReason: string
}> {
  const patterns = await loadShellRiskPatterns(cwd)
  const detected = classifyShellRisk(parameters.command, patterns)
  return {
    detected,
    ...resolveEffectiveRisk(
      parameters.riskLevel,
      parameters.riskReason,
      detected,
    ),
  }
}

interface WritePathResolution {
  fileWrite: BashFileWriteDetection | undefined
  writePaths: string[]
}

function resolveWritePaths(command: string, cwd: string): WritePathResolution {
  const fileWrite = detectBashFileWrites(command)
  const writePaths =
    fileWrite?.paths.map((filePath) =>
      path.resolve(cwd, normalizePath(filePath)),
    ) ?? []
  return { fileWrite, writePaths }
}

async function assertWritePermissions(
  writePaths: readonly string[],
  cwd: string,
): Promise<void> {
  await Promise.all(
    writePaths.map((writePath) => assertPermission(writePath, cwd, 'write')),
  )
}

function isFileWriteBlocked(
  approvalState: ApprovalState,
  parameters: BashToolParameters,
  effectiveRisk: RiskLevel,
  fileWrite: BashFileWriteDetection | undefined,
  writePaths: readonly string[],
): boolean {
  if (fileWrite === undefined) return false
  if (fileWrite.hasUnknownTarget) return true
  return !isBashApproved(
    approvalState,
    parameters.command,
    effectiveRisk,
    writePaths,
  )
}

function isApprovedScopedBashBlocked(
  approvalState: ApprovalState,
  parameters: BashToolParameters,
): boolean {
  return (
    parameters.riskLevel !== 'low' &&
    !isBashApproved(approvalState, parameters.command, parameters.riskLevel)
  )
}

function shouldConfirmRisk(risk: RiskLevel): boolean {
  return risk === 'high' || risk === 'critical'
}

function formatHighRiskPrompt(
  summary: string,
  parameters: BashToolParameters,
  detected: { level: RiskLevel; reason: string } | undefined,
  effectiveRisk: RiskLevel,
  effectiveReason: string,
): string {
  const detectedText = detected
    ? `\nDetected risk: ${detected.level} (${detected.reason})`
    : ''
  return `${summary}\n\nCommand: ${parameters.command}${detectedText}\nDeclared risk: ${parameters.riskLevel} (${parameters.riskReason})\nEffective risk: ${effectiveRisk} (${effectiveReason})`
}

async function confirmHighRiskCommand(
  context: ExtensionContext,
  summary: string,
  parameters: BashToolParameters,
  detected: { level: RiskLevel; reason: string } | undefined,
  effectiveRisk: RiskLevel,
  effectiveReason: string,
): Promise<boolean> {
  if (!shouldConfirmRisk(effectiveRisk)) return true
  return context.ui.confirm(
    `High-risk command: ${effectiveRisk}`,
    formatHighRiskPrompt(
      summary,
      parameters,
      detected,
      effectiveRisk,
      effectiveReason,
    ),
  )
}

/** @public */
export const bashTool = defineTool({
  name: 'bash',
  label: 'Bash',
  description:
    'Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 50KB (whichever hits first). Every command must include a summary, riskLevel, and riskReason. Risk is classified as low (read-only inspection), medium (reversible local changes), high (deletes, network writes, credential access), or critical (destructive broad commands, remote code execution, secret exfiltration).',
  parameters: Type.Object(
    {
      command: Type.String({
        description: 'The shell command to execute',
      }),
      summary: Type.Optional(
        Type.String({
          description:
            'Short human-readable description of what this command does',
        }),
      ),
      description: Type.Optional(
        Type.String({
          description:
            'Alias for summary — what this command does. Prefer summary.',
        }),
      ),
      riskLevel: Type.Union(
        [
          Type.Literal('low'),
          Type.Literal('medium'),
          Type.Literal('high'),
          Type.Literal('critical'),
        ],
        { description: 'Model-assessed risk level' },
      ),
      riskReason: Type.String({
        description: 'Explanation for the chosen risk level',
      }),
      timeout: Type.Optional(
        Type.Number({ description: 'Timeout in seconds' }),
      ),
    },
    { additionalProperties: false },
  ),
  async execute(toolCallId, parameters, signal, onUpdate, context) {
    const summary =
      parameters.summary ?? parameters.description ?? 'Bash command'
    await assertPermission(context.cwd, context.cwd, 'bash')

    const approvalState = reconstructToolApprovalState(context)
    if (isApprovedScopedBashBlocked(approvalState, parameters)) {
      return textResult(
        formatBlockedBashMessage(
          approvalState,
          parameters.command,
          parameters.riskLevel,
        ),
      )
    }

    const { detected, effectiveRisk, effectiveReason } =
      await assessCommandRisk(parameters, context.cwd)
    const { fileWrite, writePaths } = resolveWritePaths(
      parameters.command,
      context.cwd,
    )
    await assertWritePermissions(writePaths, context.cwd)

    if (
      isFileWriteBlocked(
        approvalState,
        parameters,
        effectiveRisk,
        fileWrite,
        writePaths,
      )
    ) {
      return textResult(
        formatBlockedBashFileWriteMessage(
          approvalState,
          parameters.command,
          writePaths,
          fileWrite?.reasons ?? [],
        ),
      )
    }

    const allowed = await confirmHighRiskCommand(
      context,
      summary,
      parameters,
      detected,
      effectiveRisk,
      effectiveReason,
    )
    if (!allowed) {
      return {
        content: [
          { type: 'text', text: `Blocked by user: ${effectiveReason}` },
        ],
        details: { blocked: true, reason: effectiveReason },
      }
    }

    const piBash = createBashToolDefinition(context.cwd)
    return piBash.execute(
      toolCallId,
      {
        command: parameters.command,
        ...(parameters.timeout !== undefined && {
          timeout: parameters.timeout,
        }),
      },
      signal,
      onUpdate,
      context,
    )
  },

  renderCall(args, theme, context) {
    return renderToolCallWithMode(
      'bash',
      `$ ${args.command.slice(0, 60)}`,
      theme,
      context,
    )
  },

  renderResult: renderToolResultWithMode,
})
