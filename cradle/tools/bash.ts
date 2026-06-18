import { Type } from '@earendil-works/pi-ai'
import {
  buildSessionContext,
  createBashToolDefinition,
  defineTool,
} from '@earendil-works/pi-coding-agent'

import { assertPermission } from '../config/settings.js'
import {
  classifyShellRisk,
  loadShellRiskPatterns,
  type RiskLevel,
} from '../config/shell-risk.js'
import {
  formatBlockedBashMessage,
  isBashApproved,
  reconstructApprovalState,
} from '../utils/approval-state.js'
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

    // Check approval scope for state-changing commands
    const entries = context.sessionManager.getEntries()
    const leafId = context.sessionManager.getLeafId()
    const { messages } = buildSessionContext(entries, leafId)
    const approvalState = reconstructApprovalState(messages)
    if (
      parameters.riskLevel !== 'low' &&
      !isBashApproved(approvalState, parameters.command, parameters.riskLevel)
    ) {
      return {
        content: [
          {
            type: 'text',
            text: formatBlockedBashMessage(
              approvalState,
              parameters.command,
              parameters.riskLevel,
            ),
          },
        ],
        details: undefined,
      }
    }

    const patterns = await loadShellRiskPatterns(context.cwd)
    const detected = classifyShellRisk(parameters.command, patterns)

    const { effectiveRisk, effectiveReason } = resolveEffectiveRisk(
      parameters.riskLevel,
      parameters.riskReason,
      detected,
    )

    // Confirm high/critical commands with the user.
    if (effectiveRisk === 'high' || effectiveRisk === 'critical') {
      const allowed = await context.ui.confirm(
        `High-risk command: ${effectiveRisk}`,
        `${summary}\n\nCommand: ${parameters.command}${
          detected
            ? `\nDetected risk: ${detected.level} (${detected.reason})`
            : ''
        }\nDeclared risk: ${parameters.riskLevel} (${parameters.riskReason})\nEffective risk: ${effectiveRisk} (${effectiveReason})`,
      )
      if (!allowed) {
        return {
          content: [
            { type: 'text', text: `Blocked by user: ${effectiveReason}` },
          ],
          details: { blocked: true, reason: effectiveReason },
        }
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
