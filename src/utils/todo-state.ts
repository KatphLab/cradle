import type { AgentMessage } from '@earendil-works/pi-agent-core'

type TodoStatus = 'pending' | 'in_progress' | 'completed'

const VALID_STATUSES = new Set<string>(['pending', 'in_progress', 'completed'])

function isTodoStatus(value: string): value is TodoStatus {
  return VALID_STATUSES.has(value)
}

export interface TodoItem {
  id: number
  description: string
  status: TodoStatus
}

export interface TodoDetails {
  todos: TodoItem[]
  changed: { id: number; from: TodoStatus | undefined; to: TodoStatus }[]
}

interface TodoParseResult {
  todos: TodoItem[]
  errors: string[]
}

class TodoParseError extends Error {
  readonly errors: string[]

  constructor(errors: string[]) {
    super(`Invalid todo list:\n${errors.join('\n')}`)
    this.name = 'TodoParseError'
    this.errors = errors
  }
}

function parseTodoLine(line: string): TodoItem | undefined {
  const trimmed = line.trim()
  if (!trimmed) return undefined

  const dotIndex = trimmed.indexOf('.')
  if (dotIndex <= 0) return undefined

  const id = Number.parseInt(trimmed.slice(0, dotIndex).trim(), 10)
  if (Number.isNaN(id)) return undefined

  const afterDot = trimmed.slice(dotIndex + 1).trimStart()
  if (!afterDot.startsWith('[')) return undefined

  const closeBracket = afterDot.indexOf(']')
  if (closeBracket <= 1) return undefined

  const status = afterDot.slice(1, closeBracket).trim()
  if (!isTodoStatus(status)) return undefined

  const description = afterDot.slice(closeBracket + 1).trimStart()
  if (!description) return undefined

  return { id, description, status }
}

function validateTodoText(text: string): TodoParseResult {
  const todos: TodoItem[] = []
  const errors: string[] = []
  const lines = text.split('\n')

  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) continue

    const item = parseTodoLine(line)
    if (item) {
      todos.push(item)
    } else {
      errors.push(
        `Line ${String(index + 1)} must match: N. [pending|in_progress|completed] Description`,
      )
    }
  }

  return { todos: todos.toSorted((a, b) => a.id - b.id), errors }
}

function parseTodoText(text: string): TodoItem[] {
  const result = validateTodoText(text)
  if (result.errors.length > 0) {
    throw new TodoParseError(result.errors)
  }
  return result.todos
}

function findLatestTodoToolResult(
  messages: AgentMessage[],
): AgentMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message) continue
    if (
      message.role === 'toolResult' &&
      'toolName' in message &&
      message.toolName === 'todo' &&
      !message.isError
    ) {
      return message
    }
  }
  return undefined
}

function isTextContent(
  block: unknown,
): block is { type: 'text'; text: string } {
  if (typeof block !== 'object' || block === null) return false
  if (!('type' in block)) return false
  if (block.type !== 'text') return false
  if (!('text' in block)) return false
  return typeof block.text === 'string'
}

function extractTodosFromToolResult(message: AgentMessage): TodoItem[] {
  if (message.role !== 'toolResult') return []
  const content = message.content
  if (content.length === 0) return []
  const first = content[0]
  if (!first || !isTextContent(first)) return []
  return parseTodoText(first.text)
}

export function reconstructTodos(messages: AgentMessage[]): TodoItem[] {
  const result = findLatestTodoToolResult(messages)
  if (!result) return []
  return extractTodosFromToolResult(result)
}

export function computeTodoDeltas(
  previous: TodoItem[],
  current: TodoItem[],
): TodoDetails['changed'] {
  const changed: TodoDetails['changed'] = []
  const previousMap = new Map(previous.map((t) => [t.id, t]))

  for (const item of current) {
    const previousItem = previousMap.get(item.id)
    if (previousItem?.status !== item.status) {
      changed.push({
        id: item.id,
        from: previousItem?.status,
        to: item.status,
      })
    }
  }

  return changed
}

export function formatTodoList(todos: TodoItem[]): string {
  return todos.map((t) => `${t.id}. [${t.status}] ${t.description}`).join('\n')
}

export function formatTodoReminder(todos: TodoItem[]): string {
  const lines = [
    '## Current Todos',
    ...todos.map((t) => `${t.id}. [${t.status}] ${t.description}`),
  ]
  return lines.join('\n')
}
