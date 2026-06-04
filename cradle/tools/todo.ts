import { Type } from '@earendil-works/pi-ai'
import {
  buildSessionContext,
  defineTool,
} from '@earendil-works/pi-coding-agent'

import {
  computeTodoDeltas,
  formatTodoList,
  reconstructTodos,
  type TodoDetails,
  type TodoItem,
} from '../utils/todo-state.js'

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
})
