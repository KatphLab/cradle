import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export interface RegisteredHandler {
  event: string
  fn: unknown
}

interface TestContext {
  cwd: string
}

interface TestSessionContext extends TestContext {
  ui: {
    notify: (message: string, level: string) => void
  }
}

interface TestBeforeAgentStartEvent {
  systemPrompt: string
}

interface TestMessageUpdateContext extends TestContext {
  abort: () => void
  isIdle: () => boolean
}

interface TestMessageUpdateEvent {
  message: AgentMessage
  assistantMessageEvent: {
    delta: string
    type: string
  }
}

type ContextHandler = (
  event: { messages: AgentMessage[] },
  context: TestContext,
) => Promise<{ messages?: AgentMessage[] } | undefined>

type SessionStartHandler = (
  event: unknown,
  context: TestSessionContext,
) => unknown

type BeforeAgentStartHandler = (
  event: TestBeforeAgentStartEvent,
  context: TestSessionContext,
) => Promise<
  | {
      message?: {
        customType: string
        content: string
        display: boolean
      }
      systemPrompt?: string
    }
  | undefined
>

type MessageUpdateHandler = (
  event: TestMessageUpdateEvent,
  context: TestMessageUpdateContext,
) => unknown

type BeforeProviderRequestHandler = (event: { payload: unknown }) => unknown

const noopSendUserMessage = (() => {
  return
}) as ExtensionAPI['sendUserMessage']

export function createPi(
  handlers: RegisteredHandler[],
  sendUserMessage: ExtensionAPI['sendUserMessage'] = noopSendUserMessage,
): Pick<ExtensionAPI, 'on' | 'sendUserMessage'> {
  return {
    on: (event, handler) => {
      handlers.push({ event, fn: handler })
    },
    sendUserMessage,
  }
}

function isContextHandler(value: unknown): value is ContextHandler {
  return typeof value === 'function'
}

function isSessionStartHandler(value: unknown): value is SessionStartHandler {
  return typeof value === 'function'
}

function isBeforeAgentStartHandler(
  value: unknown,
): value is BeforeAgentStartHandler {
  return typeof value === 'function'
}

function isMessageUpdateHandler(value: unknown): value is MessageUpdateHandler {
  return typeof value === 'function'
}

function isBeforeProviderRequestHandler(
  value: unknown,
): value is BeforeProviderRequestHandler {
  return typeof value === 'function'
}

export function getContextHandler(
  handlers: RegisteredHandler[],
): ContextHandler {
  const handler = handlers.find((entry) => entry.event === 'context')
  if (!handler) throw new Error('Expected context handler to be registered')
  if (!isContextHandler(handler.fn)) {
    throw new TypeError('Expected registered handler to be callable')
  }
  return handler.fn
}

export function getSessionStartHandler(
  handlers: RegisteredHandler[],
): SessionStartHandler {
  const handler = handlers.find((entry) => entry.event === 'session_start')
  if (!handler) {
    throw new Error('Expected session_start handler to be registered')
  }
  if (!isSessionStartHandler(handler.fn)) {
    throw new TypeError('Expected registered handler to be callable')
  }
  return handler.fn
}

export function getBeforeAgentStartHandler(
  handlers: RegisteredHandler[],
): BeforeAgentStartHandler {
  const handler = handlers.find((entry) => entry.event === 'before_agent_start')
  if (!handler) {
    throw new Error('Expected before_agent_start handler to be registered')
  }
  if (!isBeforeAgentStartHandler(handler.fn)) {
    throw new TypeError('Expected registered handler to be callable')
  }
  return handler.fn
}

export function getMessageUpdateHandler(
  handlers: RegisteredHandler[],
): MessageUpdateHandler {
  const handler = handlers.find((entry) => entry.event === 'message_update')
  if (!handler) {
    throw new Error('Expected message_update handler to be registered')
  }
  if (!isMessageUpdateHandler(handler.fn)) {
    throw new TypeError('Expected registered handler to be callable')
  }
  return handler.fn
}

export function getBeforeProviderRequestHandler(
  handlers: RegisteredHandler[],
): BeforeProviderRequestHandler {
  const handler = handlers.find(
    (entry) => entry.event === 'before_provider_request',
  )
  if (!handler) {
    throw new Error('Expected before_provider_request handler to be registered')
  }
  if (!isBeforeProviderRequestHandler(handler.fn)) {
    throw new TypeError('Expected registered handler to be callable')
  }
  return handler.fn
}

export function createUserMessage(content: string): AgentMessage {
  return {
    role: 'user',
    content,
    timestamp: Date.now(),
  }
}

export function createAssistantMessage(content: string): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'thinking', thinking: content }],
    api: 'test-api',
    provider: 'test-provider',
    model: 'test-model',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  }
}

export function createStaleReminder(content: string): AgentMessage {
  return {
    role: 'custom',
    customType: 'cradle-system-reminder',
    content,
    display: false,
    timestamp: Date.now(),
  }
}

export function createTodoToolResult(text: string): AgentMessage {
  return {
    role: 'toolResult',
    toolName: 'todo',
    toolCallId: 'call_1',
    content: [{ type: 'text', text }],
    isError: false,
    timestamp: Date.now(),
  }
}

export async function writeCradleSettings(
  _cwd: string,
  settings: Record<string, unknown>,
): Promise<void> {
  const configDirectory = path.join(homedir(), '.pi', 'cradle')
  await mkdir(configDirectory, { recursive: true })
  await writeFile(
    path.join(configDirectory, 'settings.json'),
    JSON.stringify(settings, undefined, 2),
  )
}
