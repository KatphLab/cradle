import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import {
  computeTodoDeltas,
  extractTodosFromToolResult,
  findLatestTodoToolResult,
  formatTodoList,
  formatTodoReminder,
  isTextContent,
  isTodoItem,
  parseTodoText,
  reconstructTodos,
  type TodoItem,
} from '../utils/todo-state.js'

import { todoTool, type TodoToolTodo } from './todo.js'

describe('parseTodoText', () => {
  it('parses valid todo list', () => {
    const input =
      '1. [pending] Implement Foo\n2. [in_progress] Write tests\n3. [completed] Set up CI'
    const result = parseTodoText(input)

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({
      id: 1,
      description: 'Implement Foo',
      status: 'pending',
    })
    expect(result[1]).toEqual({
      id: 2,
      description: 'Write tests',
      status: 'in_progress',
    })
    expect(result[2]).toEqual({
      id: 3,
      description: 'Set up CI',
      status: 'completed',
    })
  })

  it('rejects invalid lines', () => {
    const input = '1. [pending] Valid\ninvalid line\n2. [completed] Also valid'

    expect(() => parseTodoText(input)).toThrow('Line 2 must match')
  })

  it('returns empty array for empty input', () => {
    expect(parseTodoText('')).toEqual([])
    expect(parseTodoText('   \n   ')).toEqual([])
  })

  it('sorts by id', () => {
    const input = '3. [pending] Third\n1. [pending] First\n2. [pending] Second'
    const result = parseTodoText(input)

    expect(result.map((t) => t.id)).toEqual([1, 2, 3])
  })

  it('rejects lines with non-numeric id', () => {
    expect(() => parseTodoText('abc. [pending] Foo')).toThrow(
      'Line 1 must match',
    )
  })

  it('rejects lines without dot separator', () => {
    expect(() => parseTodoText('1 [pending] Foo')).toThrow('Line 1 must match')
  })

  it('rejects lines without opening bracket', () => {
    expect(() => parseTodoText('1. pending Foo')).toThrow('Line 1 must match')
  })

  it('rejects lines without closing bracket', () => {
    expect(() => parseTodoText('1. [pending Foo')).toThrow('Line 1 must match')
  })

  it('rejects lines with empty bracket', () => {
    expect(() => parseTodoText('1. [] Foo')).toThrow('Line 1 must match')
  })

  it('rejects lines with invalid status', () => {
    expect(() => parseTodoText('1. [invalid] Foo')).toThrow('Line 1 must match')
  })

  it('rejects lines with empty description', () => {
    expect(() => parseTodoText('1. [pending]')).toThrow('Line 1 must match')
    expect(() => parseTodoText('1. [pending] ')).toThrow('Line 1 must match')
  })
})

describe('computeTodoDeltas', () => {
  it('detects status changes', () => {
    const previous: TodoItem[] = [
      { id: 1, description: 'Foo', status: 'pending' },
      { id: 2, description: 'Bar', status: 'pending' },
    ]
    const current: TodoItem[] = [
      { id: 1, description: 'Foo', status: 'in_progress' },
      { id: 2, description: 'Bar', status: 'completed' },
    ]

    const deltas = computeTodoDeltas(previous, current)

    expect(deltas).toHaveLength(2)
    expect(deltas[0]).toEqual({
      id: 1,
      from: 'pending',
      to: 'in_progress',
    })
    expect(deltas[1]).toEqual({
      id: 2,
      from: 'pending',
      to: 'completed',
    })
  })

  it('detects new items', () => {
    const previous: TodoItem[] = [
      { id: 1, description: 'Foo', status: 'pending' },
    ]
    const current: TodoItem[] = [
      { id: 1, description: 'Foo', status: 'pending' },
      { id: 2, description: 'Bar', status: 'in_progress' },
    ]

    const deltas = computeTodoDeltas(previous, current)

    expect(deltas).toHaveLength(1)
    expect(deltas[0]).toEqual({
      id: 2,
      from: undefined,
      to: 'in_progress',
    })
  })

  it('returns empty when nothing changed', () => {
    const previous: TodoItem[] = [
      { id: 1, description: 'Foo', status: 'pending' },
    ]
    const current: TodoItem[] = [
      { id: 1, description: 'Foo', status: 'pending' },
    ]

    expect(computeTodoDeltas(previous, current)).toEqual([])
  })
})

describe('reconstructTodos', () => {
  it('reconstructs from tool result text content', () => {
    const messages: AgentMessage[] = [
      {
        role: 'toolResult',
        toolName: 'todo',
        toolCallId: 'call_1',
        content: [
          { type: 'text', text: '1. [pending] Foo\n2. [completed] Bar' },
        ],
        isError: false,
        timestamp: 1,
      },
    ]
    const todos = reconstructTodos(messages)

    expect(todos).toHaveLength(2)
    expect(todos[0]).toEqual({ id: 1, description: 'Foo', status: 'pending' })
    expect(todos[1]).toEqual({ id: 2, description: 'Bar', status: 'completed' })
  })

  it('ignores non-todo tool results', () => {
    const messages: AgentMessage[] = [
      {
        role: 'toolResult',
        toolName: 'bash',
        toolCallId: 'call_1',
        content: [{ type: 'text', text: 'output' }],
        isError: false,
        timestamp: 1,
      },
    ]

    expect(reconstructTodos(messages)).toEqual([])
  })

  it('ignores user messages', () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: 'hello', timestamp: 1 },
    ]

    expect(reconstructTodos(messages)).toEqual([])
  })

  it('finds latest when multiple todo results exist', () => {
    const messages: AgentMessage[] = [
      {
        role: 'toolResult',
        toolName: 'todo',
        toolCallId: 'call_1',
        content: [{ type: 'text', text: '1. [completed] Old' }],
        isError: false,
        timestamp: 1,
      },
      {
        role: 'toolResult',
        toolName: 'todo',
        toolCallId: 'call_2',
        content: [{ type: 'text', text: '1. [in_progress] New' }],
        isError: false,
        timestamp: 2,
      },
    ]

    const todos = reconstructTodos(messages)
    expect(todos).toHaveLength(1)
    expect(todos[0]).toEqual({
      id: 1,
      description: 'New',
      status: 'in_progress',
    })
  })

  it('returns empty for non-text content', () => {
    const messages: AgentMessage[] = [
      {
        role: 'toolResult',
        toolName: 'todo',
        toolCallId: 'call_1',
        content: [{ type: 'image', data: 'base64data', mimeType: 'image/png' }],
        isError: false,
        timestamp: 1,
      },
    ]

    expect(reconstructTodos(messages)).toEqual([])
  })

  it('returns empty for content missing text property', () => {
    const message: AgentMessage = {
      role: 'toolResult',
      toolName: 'todo',
      toolCallId: 'call_1',
      // @ts-expect-error testing invalid content
      content: [{ type: 'text' }],
      isError: false,
      timestamp: 1,
    }

    expect(reconstructTodos([message])).toEqual([])
  })

  it('returns empty for content with non-string text', () => {
    const message: AgentMessage = {
      role: 'toolResult',
      toolName: 'todo',
      toolCallId: 'call_1',
      // @ts-expect-error testing invalid content
      content: [{ type: 'text', text: 42 }],
      isError: false,
      timestamp: 1,
    }

    expect(reconstructTodos([message])).toEqual([])
  })

  it('returns empty when no messages', () => {
    expect(reconstructTodos([])).toEqual([])
  })
})

describe('findLatestTodoToolResult', () => {
  it('returns undefined for empty messages', () => {
    expect(findLatestTodoToolResult([])).toBeUndefined()
  })

  it('returns undefined for user messages', () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: 'hello', timestamp: 1 },
    ]
    expect(findLatestTodoToolResult(messages)).toBeUndefined()
  })

  it('returns undefined for non-todo tool results', () => {
    const messages: AgentMessage[] = [
      {
        role: 'toolResult',
        toolName: 'bash',
        toolCallId: 'call_1',
        content: [{ type: 'text', text: 'output' }],
        isError: false,
        timestamp: 1,
      },
    ]
    expect(findLatestTodoToolResult(messages)).toBeUndefined()
  })

  it('finds the latest todo tool result', () => {
    const messages: AgentMessage[] = [
      {
        role: 'toolResult',
        toolName: 'todo',
        toolCallId: 'call_1',
        content: [{ type: 'text', text: '1. [completed] Old' }],
        isError: false,
        timestamp: 1,
      },
      {
        role: 'toolResult',
        toolName: 'todo',
        toolCallId: 'call_2',
        content: [{ type: 'text', text: '1. [in_progress] New' }],
        isError: false,
        timestamp: 2,
      },
    ]
    const result = findLatestTodoToolResult(messages)
    expect(result).toBeDefined()
    expect(result?.role).toBe('toolResult')
    expect(result && 'toolCallId' in result ? result.toolCallId : '').toBe(
      'call_2',
    )
  })
})

describe('isTextContent', () => {
  it('rejects primitive number', () => {
    expect(isTextContent(0)).toBe(false)
  })

  it('rejects primitive string', () => {
    expect(isTextContent('text')).toBe(false)
  })

  it('rejects plain object', () => {
    expect(isTextContent({})).toBe(false)
  })

  it('rejects object with wrong type', () => {
    expect(isTextContent({ type: 'image' })).toBe(false)
  })

  it('rejects object missing text', () => {
    expect(isTextContent({ type: 'text' })).toBe(false)
  })

  it('rejects object with non-string text', () => {
    expect(isTextContent({ type: 'text', text: 42 })).toBe(false)
  })

  it('accepts valid text content', () => {
    expect(isTextContent({ type: 'text', text: 'hello' })).toBe(true)
  })
})

describe('extractTodosFromToolResult', () => {
  it('returns empty for non-toolResult', () => {
    const message = {
      role: 'user',
      content: 'hello',
      timestamp: 1,
    } as AgentMessage
    expect(extractTodosFromToolResult(message)).toEqual([])
  })

  it('returns empty for empty content', () => {
    const message: AgentMessage = {
      role: 'toolResult',
      toolName: 'todo',
      toolCallId: 'call_1',
      content: [],
      isError: false,
      timestamp: 1,
    }
    expect(extractTodosFromToolResult(message)).toEqual([])
  })

  it('returns empty for image content', () => {
    const message: AgentMessage = {
      role: 'toolResult',
      toolName: 'todo',
      toolCallId: 'call_1',
      content: [{ type: 'image', data: 'base64', mimeType: 'image/png' }],
      isError: false,
      timestamp: 1,
    }
    expect(extractTodosFromToolResult(message)).toEqual([])
  })

  it('extracts todos from text content', () => {
    const message: AgentMessage = {
      role: 'toolResult',
      toolName: 'todo',
      toolCallId: 'call_1',
      content: [{ type: 'text', text: '1. [pending] Foo' }],
      isError: false,
      timestamp: 1,
    }
    expect(extractTodosFromToolResult(message)).toEqual([
      { id: 1, description: 'Foo', status: 'pending' },
    ])
  })
})

describe('isTodoItem', () => {
  it('accepts valid todo item', () => {
    expect(isTodoItem({ id: 1, description: 'Foo', status: 'pending' })).toBe(
      true,
    )
    expect(isTodoItem({ id: 2, description: 'Bar', status: 'completed' })).toBe(
      true,
    )
  })

  it('rejects invalid todo item', () => {
    expect(isTodoItem({ id: '1', description: 'Foo', status: 'pending' })).toBe(
      false,
    )
    expect(isTodoItem({ id: 1, description: 'Foo', status: 'done' })).toBe(
      false,
    )
    expect(isTodoItem({ id: 1, status: 'pending' })).toBe(false)
    expect(isTodoItem(void 0)).toBe(false)
    expect(isTodoItem('string')).toBe(false)
    expect(isTodoItem({ description: 'Foo', status: 'pending' })).toBe(false)
    expect(isTodoItem({ id: 1, description: 'Foo' })).toBe(false)
  })
})

describe('formatTodoList', () => {
  it('formats todos', () => {
    const todos: TodoItem[] = [
      { id: 1, description: 'Foo', status: 'pending' },
      { id: 2, description: 'Bar', status: 'completed' },
    ]

    expect(formatTodoList(todos)).toBe('1. [pending] Foo\n2. [completed] Bar')
  })
})

describe('formatTodoReminder', () => {
  it('formats reminder with header', () => {
    const todos: TodoItem[] = [
      { id: 1, description: 'Foo', status: 'in_progress' },
      { id: 2, description: 'Bar', status: 'pending' },
    ]

    const reminder = formatTodoReminder(todos)

    expect(reminder).toContain('## Current Todos')
    expect(reminder).toContain('1. [in_progress] Foo')
    expect(reminder).toContain('2. [pending] Bar')
  })
})

function executeTodo(
  todos: TodoToolTodo[],
  entries: SessionEntry[] = [],
  leafId: string | null = null,
) {
  const context = {
    sessionManager: {
      getEntries: () => entries,
      getLeafId: () => leafId,
    },
  }

  // @ts-expect-error minimal context mock
  return todoTool.execute('test-call', { todos }, undefined, undefined, context)
}

describe('todoTool', () => {
  it('clears todos when input is empty', async () => {
    const result = await executeTodo([])
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: '',
    })
    expect(result.details.todos).toEqual([])
    expect(result.details.changed).toEqual([])
  })

  it('creates todos with no previous state', async () => {
    const result = await executeTodo([
      { id: 1, description: 'Task A', status: 'pending' },
    ])
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: '1. [pending] Task A',
    })
    expect(result.details.todos).toHaveLength(1)
    expect(result.details.changed).toHaveLength(1)
    expect(result.details.changed[0]).toEqual({
      id: 1,
      from: undefined,
      to: 'pending',
    })
  })

  it('sorts structured todo input by id', async () => {
    const result = await executeTodo([
      { id: 2, description: 'Task B', status: 'pending' },
      { id: 1, description: 'Task A', status: 'in_progress' },
    ])

    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: '1. [in_progress] Task A\n2. [pending] Task B',
    })
    expect(result.details.todos.map((todo) => todo.id)).toEqual([1, 2])
  })

  it('detects changes against previous state', async () => {
    const mockEntry: SessionEntry = {
      type: 'message',
      id: 'entry1',
      parentId: null,
      timestamp: '2024-01-01T00:00:00.000Z',
      message: {
        role: 'toolResult',
        toolName: 'todo',
        toolCallId: 'call_prev',
        content: [{ type: 'text', text: '1. [pending] Task A' }],
        isError: false,
        timestamp: 1,
      },
    }
    const result = await executeTodo(
      [{ id: 1, description: 'Task A', status: 'completed' }],
      [mockEntry],
      'entry1',
    )
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: '1. [completed] Task A',
    })
    expect(result.details.changed).toHaveLength(1)
    expect(result.details.changed[0]).toEqual({
      id: 1,
      from: 'pending',
      to: 'completed',
    })
  })

  it('reports no changes when state matches', async () => {
    const mockEntry: SessionEntry = {
      type: 'message',
      id: 'entry1',
      parentId: null,
      timestamp: '2024-01-01T00:00:00.000Z',
      message: {
        role: 'toolResult',
        toolName: 'todo',
        toolCallId: 'call_prev',
        content: [{ type: 'text', text: '1. [pending] Task A' }],
        isError: false,
        timestamp: 1,
      },
    }
    const result = await executeTodo(
      [{ id: 1, description: 'Task A', status: 'pending' }],
      [mockEntry],
      'entry1',
    )
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: '1. [pending] Task A',
    })
    expect(result.details.changed).toEqual([])
  })
})
