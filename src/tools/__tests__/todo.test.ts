import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import { todoTool, type TodoToolTodo } from '../todo.js'

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
