import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'

/** @public */
export interface AskUserOption {
  label: string
  value: string
}

/** @public */
export interface AskUserQuestion {
  id: string
  question: string
  options?: AskUserOption[]
  allowCustomAnswer?: boolean
}

const optionSchema = Type.Object(
  {
    label: Type.String({ description: 'Option label shown to the user' }),
    value: Type.String({ description: 'Value returned when selected' }),
  },
  { additionalProperties: false },
)

const questionSchema = Type.Object(
  {
    id: Type.String({ description: 'Stable question identifier' }),
    question: Type.String({ description: 'Question text to display' }),
    options: Type.Optional(
      Type.Array(optionSchema, {
        description:
          'Available options. If omitted, the user must type a free-form answer.',
      }),
    ),
    allowCustomAnswer: Type.Optional(
      Type.Boolean({
        default: true,
        description: 'Allow a custom answer not in the options',
      }),
    ),
  },
  { additionalProperties: false },
)

const parametersSchema = Type.Object(
  {
    questions: Type.Array(questionSchema, {
      minItems: 1,
      maxItems: 4,
      description: 'Questions to ask the user (1–4)',
    }),
    preamble: Type.Optional(
      Type.String({
        description: 'Optional context shown before questions',
      }),
    ),
  },
  { additionalProperties: false },
)

/** @public */
export const askUserTool = defineTool({
  name: 'ask_user',
  label: 'Ask User',
  description:
    'Present a focused 1–4 question questionnaire to the user with ' +
    'explicit options. After calling this tool, the agent loop is ' +
    'immediately aborted. Do not emit text or call other tools — wait ' +
    "silently for the user's answer.",
  parameters: parametersSchema,
  execute(
    _toolCallId,
    parameters: { questions: AskUserQuestion[]; preamble?: string },
    _signal,
    _onUpdate,
    _context,
  ): Promise<{
    content: { type: 'text'; text: string }[]
    details: { type: 'ask_user' }
  }> {
    const payload = {
      preamble: parameters.preamble,
      questions: parameters.questions.map((question) => ({
        id: question.id,
        question: question.question,
        options: question.options,
        allowCustomAnswer: question.allowCustomAnswer,
      })),
    }

    const jsonText = JSON.stringify(payload, undefined, 2)

    return Promise.resolve({
      content: [{ type: 'text', text: jsonText }],
      details: { type: 'ask_user' },
    })
  },
})
