import { Type } from '@earendil-works/pi-ai'
import {
  createBashToolDefinition,
  defineTool,
} from '@earendil-works/pi-coding-agent'

import {
  classifyShellRisk,
  loadShellRiskPatterns,
  type RiskLevel,
} from '../config/shell-risk.js'

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
      summary: Type.String({
        description:
          'Short human-readable description of what this command does',
      }),
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
    const patterns = await loadShellRiskPatterns(context.cwd)
    const detected = classifyShellRisk(parameters.command, patterns)

    let effectiveRisk: RiskLevel
    let effectiveReason: string

    if (detected) {
      // Patterns loaded — override if the model under-declared the risk.
      effectiveRisk =
        riskRank(parameters.riskLevel) >= riskRank(detected.level)
          ? parameters.riskLevel
          : detected.level
      effectiveReason =
        effectiveRisk === detected.level
          ? detected.reason
          : parameters.riskReason
    } else {
      // No patterns loaded — trust what the LLM returned.
      effectiveRisk = parameters.riskLevel
      effectiveReason = parameters.riskReason
    }

    // Confirm high/critical commands with the user.
    if (effectiveRisk === 'high' || effectiveRisk === 'critical') {
      const allowed = await context.ui.confirm(
        `High-risk command: ${effectiveRisk}`,
        `${parameters.summary}\n\nCommand: ${parameters.command}${
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
})
