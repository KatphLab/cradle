import { defineTool } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'
import { Type, type Static } from 'typebox'
import {
  buildAdvisorRenderCall,
  buildAdvisorRenderResult,
} from './advisor/render.js'
import { runAdvisor } from './advisor/runner.js'

const AdvisorParameters = Type.Object({
  context: Type.String({
    description:
      'What you are struggling with or want validated. Be as detailed as possible.',
  }),
  code: Type.Optional(
    Type.String({
      description: 'Relevant code snippet for context',
    }),
  ),
  error: Type.Optional(
    Type.String({
      description: 'Error message or unexpected output you received',
    }),
  ),
  attempted: Type.Optional(
    Type.String({
      description: 'What you have already tried',
    }),
  ),
  files: Type.Optional(
    Type.Array(Type.String(), {
      description: 'File paths for the advisor to examine',
    }),
  ),
})

type AdvisorParametersType = Static<typeof AdvisorParameters>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getOptionalString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function normalizeFilesField(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const files = value.filter((f): f is string => typeof f === 'string')
  return files.length > 0 ? files : undefined
}

function parseAdvisorParameters(
  value: unknown,
): AdvisorParametersType | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value['context'] !== 'string') return undefined

  const code = getOptionalString(value, 'code')
  const error = getOptionalString(value, 'error')
  const attempted = getOptionalString(value, 'attempted')
  const files = normalizeFilesField(value['files'])

  const result: AdvisorParametersType = { context: value['context'] }
  if (code !== undefined) result.code = code
  if (error !== undefined) result.error = error
  if (attempted !== undefined) result.attempted = attempted
  if (files !== undefined) result.files = files
  return result
}

/** @public */
export const advisorTool = defineTool({
  name: 'advisor',
  label: 'Advisor',
  description: [
    'Consult an expert advisor for analysis and recommendations.',
    'Use when you need a second opinion, are stuck on a problem, or want to validate your approach.',
    'The advisor has read-only access to files and can examine code to provide informed advice.',
  ].join(' '),
  parameters: AdvisorParameters,

  async execute(_toolCallId, rawParameters, signal, onUpdate, context) {
    const parameters = parseAdvisorParameters(rawParameters)
    if (parameters === undefined) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Advisor error: Invalid parameters. Provide at least a "context" field.',
          },
        ],
        details: {
          mode: 'single' as const,
          projectAgentsDir: undefined,
          results: [],
        },
        isError: true,
      }
    }

    try {
      const result = await runAdvisor({
        context: parameters.context,
        code: parameters.code,
        error: parameters.error,
        attempted: parameters.attempted,
        files: parameters.files,
        cwd: context.cwd,
        signal,
        onUpdate: onUpdate
          ? (partial) => {
              onUpdate({
                content: partial.content,
                details: partial.details,
              })
            }
          : undefined,
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: result.output,
          },
        ],
        details: {
          mode: 'single' as const,
          projectAgentsDir: undefined,
          results: [result.result],
        },
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      return {
        content: [
          {
            type: 'text' as const,
            text: `Advisor error: ${errorMessage}`,
          },
        ],
        details: {
          mode: 'single' as const,
          projectAgentsDir: undefined,
          results: [],
        },
        isError: true,
      }
    }
  },

  renderCall(args, theme) {
    const parameters = parseAdvisorParameters(args)
    if (parameters === undefined) {
      return new Text('Advisor (invalid parameters)', 0, 0)
    }
    return buildAdvisorRenderCall(parameters, theme)
  },

  renderResult(result, { expanded }, theme) {
    return buildAdvisorRenderResult(result, expanded, theme)
  },
})
