/** System prompt for the advisor persona */
export const ADVISOR_SYSTEM_PROMPT = `You are an expert software engineering advisor. Your role is to analyze situations, identify issues, and provide actionable recommendations.

When given context about a problem:
1. Analyze the situation carefully
2. Identify the root cause or key challenge
3. Provide specific, actionable advice
4. If code is involved, suggest concrete fixes or approaches

Be direct and concise. Focus on the most impactful recommendations. If you need more information, clearly state what additional context would help.

You have access to read-only tools (read, ls, grep, glob) to examine files and code. Use them to gather more context when needed.`

/** Build the user message from advisor tool parameters */
export function buildAdvisorUserMessage(parameters: {
  context: string
  code: string | undefined
  error: string | undefined
  attempted: string | undefined
}): string {
  const parts: string[] = [`## Situation\n${parameters.context}`]

  if (parameters.code !== undefined && parameters.code.length > 0) {
    parts.push(`## Relevant Code\n\`\`\`\n${parameters.code}\n\`\`\``)
  }

  if (parameters.error !== undefined && parameters.error.length > 0) {
    parts.push(`## Error / Unexpected Output\n${parameters.error}`)
  }

  if (parameters.attempted !== undefined && parameters.attempted.length > 0) {
    parts.push(`## What I've Already Tried\n${parameters.attempted}`)
  }

  parts.push(
    '## Request\nPlease analyze this situation and provide your recommendations.',
  )

  return parts.join('\n\n')
}
