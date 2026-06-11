import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { Text } from '@earendil-works/pi-tui'
import type { ThemeLike } from '../../utils/helpers.js'
import type { CouncilOutput } from './runner.js'

function renderQuestionPreview(question: string, limit: number): string {
  if (question.length > limit) {
    return `${question.slice(0, limit)}...`
  }
  return question
}

export function buildCouncilRenderCall(
  args: {
    question: string
    context?: string
    complexity?: string
  },
  theme: ThemeLike,
): Text {
  const preview = renderQuestionPreview(args.question, 60)
  let text = theme.fg('toolTitle', theme.bold('council '))
  text += theme.fg('accent', 'convening')
  text += '\n  '
  text += theme.fg('dim', preview)

  const hasContext = args.context !== undefined && args.context.length > 0
  if (hasContext || args.complexity !== undefined) {
    const tags: string[] = []
    if (hasContext) tags.push('+context')
    if (args.complexity !== undefined) tags.push(args.complexity)
    text += '\n  '
    text += theme.fg('muted', tags.join(' '))
  }

  return new Text(text, 0, 0)
}

function isCouncilOutput(value: unknown): value is CouncilOutput {
  if (typeof value !== 'object' || value === null) return false
  if (
    !('verdict' in value) ||
    !('voiceResults' in value) ||
    !('error' in value)
  )
    return false
  return (
    typeof (value as Record<string, unknown>)['verdict'] === 'string' &&
    Array.isArray((value as Record<string, unknown>)['voiceResults'])
  )
}

function buildCouncilErrorResult(
  councilOutput: CouncilOutput | undefined,
  outputText: string,
  theme: ThemeLike,
): Text {
  const errorMessage = councilOutput?.error ?? outputText
  return new Text(theme.fg('error', `Council error: ${errorMessage}`), 0, 0)
}

function buildCouncilExpandedResult(
  outputText: string,
  theme: ThemeLike,
): Text {
  const header = theme.fg('accent', theme.bold('Council Verdict'))
  const separator = theme.fg('dim', '─'.repeat(40))
  return new Text(`${header}\n${separator}\n${outputText}`, 0, 0)
}

function buildCouncilCompactResult(outputText: string, theme: ThemeLike): Text {
  const lines = outputText.split('\n')
  const preview = lines.slice(0, 5).join('\n')
  if (lines.length <= 5) {
    return new Text(preview, 0, 0)
  }
  const remainingText = `... +${String(lines.length - 5)} lines`
  return new Text(`${preview}\n${theme.fg('dim', remainingText)}`, 0, 0)
}

export function buildCouncilRenderResult(
  result: AgentToolResult<unknown>,
  expanded: boolean,
  theme: ThemeLike,
): Text {
  const councilOutput = isCouncilOutput(result.details)
    ? result.details
    : undefined
  const outputText =
    result.content.length > 0 && result.content[0]?.type === 'text'
      ? result.content[0].text
      : '(no output)'

  if (councilOutput?.error !== undefined) {
    return buildCouncilErrorResult(councilOutput, outputText, theme)
  }

  if (outputText.length === 0) {
    return new Text('(no verdict)', 0, 0)
  }

  if (expanded) {
    return buildCouncilExpandedResult(outputText, theme)
  }

  return buildCouncilCompactResult(outputText, theme)
}
