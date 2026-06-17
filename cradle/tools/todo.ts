import { Type } from '@earendil-works/pi-ai'
import {
  buildSessionContext,
  defineTool,
  type Theme,
} from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'

import {
  computeTodoDeltas,
  formatTodoList,
  reconstructTodos,
  type TodoDetails,
  type TodoItem,
} from '../utils/todo-state.js'
import { createModeRenderResult } from '../utils/tool-render.js'
import { isPlainRecord } from '../utils/type-guards.js'

export interface TodoToolTodo {
  id: number
  description: string
  status: TodoItem['status']
}

export interface TodoToolParameters {
  todos: TodoToolTodo[]
}

const todoStatusSchema = Type.Union(
  [
    Type.Literal('pending'),
    Type.Literal('in_progress'),
    Type.Literal('completed'),
  ],
  { description: 'Todo status' },
)

const todoItemSchema = Type.Object(
  {
    id: Type.Number({ description: 'Stable numeric todo id' }),
    description: Type.String({ description: 'Todo description' }),
    status: todoStatusSchema,
  },
  { additionalProperties: false },
)

function toTodoItems(parameters: TodoToolParameters): TodoItem[] {
  return parameters.todos
    .map((todo) => ({
      id: todo.id,
      description: todo.description,
      status: todo.status,
    }))
    .toSorted((a, b) => a.id - b.id)
}

function getTodoCount(details: unknown): number {
  if (!isPlainRecord(details)) return 0
  const todos = details['todos']
  return Array.isArray(todos) ? todos.length : 0
}

function getTodoStatusText(
  isError: boolean | undefined,
  isPartial: boolean,
  theme: Theme,
): string {
  if (isError === true) return theme.fg('error', '✗')
  if (isPartial) return theme.fg('warning', '…')
  return ''
}

function getTodoHiddenStatusIcon(
  isError: boolean | undefined,
  isPartial: boolean,
  theme: Theme,
): string {
  const status = getTodoStatusText(isError, isPartial, theme)
  return status.length > 0 ? status : theme.fg('success', '✓')
}

function formatTodoHeaderOnly(
  details: unknown,
  isError: boolean,
  isPartial: boolean,
  theme: Theme,
): Text {
  const countLabel = theme.fg(
    'accent',
    `${String(getTodoCount(details))} items`,
  )
  const status = getTodoStatusText(isError, isPartial, theme)
  const header = `${theme.fg('toolTitle', theme.bold('todo'))} ${countLabel}`
  const finalText = status.length > 0 ? `${header} ${status}` : header
  return new Text(finalText, 0, 0)
}

function formatTodoHidden(
  isError: boolean,
  isPartial: boolean,
  theme: Theme,
): Text {
  const icon = getTodoHiddenStatusIcon(isError, isPartial, theme)
  return new Text(`${icon} ${theme.fg('toolTitle', 'todo')}`, 0, 0)
}

/** @public */
export const todoTool = defineTool({
  name: 'todo',
  label: 'Todo',
  description:
    'Update the task list. Provide the full current todo list as structured todo objects. ' +
    'Include all items every time — this replaces the previous list. ' +
    'Use status pending for not-started work, in_progress for current work, and completed for finished work. ' +
    'Call this tool before starting multi-step work, when progress changes, and before final response.',
  parameters: Type.Object(
    {
      todos: Type.Array(todoItemSchema, {
        description:
          'Full current todo list. Use an empty array to clear all todos.',
      }),
    },
    { additionalProperties: false },
  ),
  execute(
    _toolCallId,
    parameters: TodoToolParameters,
    _signal,
    _onUpdate,
    context,
  ): Promise<{
    content: { type: 'text'; text: string }[]
    details: TodoDetails
  }> {
    const currentTodos = toTodoItems(parameters)
    const entries = context.sessionManager.getEntries()
    const leafId = context.sessionManager.getLeafId()
    const { messages } = buildSessionContext(entries, leafId)
    const previousTodos = reconstructTodos(messages)
    const changed = computeTodoDeltas(previousTodos, currentTodos)

    return Promise.resolve({
      content: [{ type: 'text', text: formatTodoList(currentTodos) }],
      details: { todos: currentTodos, changed },
    })
  },

  renderResult: createModeRenderResult<TodoDetails>({
    formatHeader: formatTodoHeaderOnly,
    formatHidden: formatTodoHidden,
  }),
})
