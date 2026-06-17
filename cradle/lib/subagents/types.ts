import type { Message } from '@earendil-works/pi-ai'

export type AgentSource = 'user' | 'project' | 'extension'

export type TaskComplexity = 'low' | 'medium' | 'high'

export interface AgentConfig {
  name: string
  description: string
  tools?: string[]
  model?: string
  systemPrompt: string
  source: AgentSource
  filePath: string
}

export interface AgentDiscoveryResult {
  agents: AgentConfig[]
  projectAgentsDir: string | undefined
}

export interface UsageStats {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
  contextTokens: number
  turns: number
}

export interface SubagentSessionInfo {
  id: string
  cwd: string
  inspectCommand: string
  continueHint: string
  file?: string
  name?: string
}

export interface SingleResult {
  agent: string
  agentSource: AgentSource | 'unknown'
  task: string
  exitCode: number
  messages: Message[]
  stderr: string
  usage: UsageStats
  model?: string
  stopReason?: string
  errorMessage?: string
  session?: SubagentSessionInfo
  step?: number
}

export interface SubagentDetails {
  mode: 'single' | 'parallel' | 'chain'
  projectAgentsDir: string | undefined
  results: SingleResult[]
}

export type DisplayItem =
  | { type: 'text'; text: string }
  | { type: 'toolCall'; name: string; args: Record<string, unknown> }
