import { StringEnum } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'
import { Type, type Static } from 'typebox'
import { getOptionalString, isRecord } from '../utils/helpers.js'
import {
  renderCollapsedToolSummary,
  shouldRenderFullToolResult,
} from '../utils/tool-render.js'
import {
  buildCouncilRenderCall,
  buildCouncilRenderResult,
} from './council/render.js'
import { runCouncil, type CouncilOutput } from './council/runner.js'

const ComplexitySchema = StringEnum(['low', 'medium', 'high'] as const, {
  description: 'Task complexity for model selection',
})

const CouncilParameters = Type.Object({
  question: Type.String({
    description:
      'The decision question to put before the council. Be specific about what is being decided, constraints, and what counts as success.',
  }),
  context: Type.Optional(
    Type.String({
      description:
        'Relevant context for the decision (code snippets, project details, constraints). Keep compact.',
    }),
  ),
  complexity: Type.Optional(ComplexitySchema),
})

type CouncilParametersType = Static<typeof CouncilParameters>

export function parseCouncilParameters(
  value: unknown,
): CouncilParametersType | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value['question'] !== 'string' || value['question'].length === 0)
    return undefined

  const complexityValue = value['complexity']
  const context = getOptionalString(value, 'context')

  const complexity: CouncilParametersType['complexity'] =
    complexityValue === 'low' || complexityValue === 'high'
      ? complexityValue
      : 'medium'

  return {
    question: value['question'],
    complexity,
    ...(context !== undefined && { context }),
  }
}

/** @public */
export const councilTool = defineTool({
  name: 'council',
  label: 'Council',
  description: [
    'Convene a four-voice council (Architect, Skeptic, Pragmatist, Critic) for ambiguous decisions, tradeoffs, and go/no-go calls.',
    'Each voice analyzes the question independently in an isolated context. A synthesis agent merges the results into a structured verdict.',
    'Use when multiple valid paths exist and you need structured disagreement before choosing.',
  ].join(' '),
  parameters: CouncilParameters,

  async execute(_toolCallId, rawParameters, signal, _onUpdate, context) {
    const parameters = parseCouncilParameters(rawParameters)
    if (parameters === undefined) {
      const errorDetails: CouncilOutput = {
        verdict: '',
        voiceResults: [],
        error: 'Invalid parameters',
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Council error: Invalid parameters. Provide at least a "question" field.',
          },
        ],
        details: errorDetails,
        isError: true,
      }
    }

    try {
      const councilOutput = await runCouncil({
        question: parameters.question,
        context: parameters.context,
        complexity: parameters.complexity ?? 'medium',
        cwd: context.cwd,
        signal,
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: councilOutput.error ?? councilOutput.verdict,
          },
        ],
        details: councilOutput,
        isError: councilOutput.error !== undefined,
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      return {
        content: [
          {
            type: 'text' as const,
            text: `Council error: ${errorMessage}`,
          },
        ],
        details: {
          verdict: '',
          voiceResults: [],
          error: errorMessage,
        },
        isError: true,
      }
    }
  },

  renderCall(args, theme) {
    const parameters = parseCouncilParameters(args)
    if (parameters === undefined) {
      return new Text('Council (invalid parameters)', 0, 0)
    }
    return buildCouncilRenderCall(parameters, theme)
  },

  renderResult(result, options, theme, context) {
    const summary = renderCollapsedToolSummary(
      'council',
      '',
      options,
      theme,
      context,
    )
    if (summary) return summary
    return buildCouncilRenderResult(
      result,
      shouldRenderFullToolResult(options),
      theme,
    )
  },
})
