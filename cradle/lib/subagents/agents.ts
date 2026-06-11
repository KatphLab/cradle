import * as fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import type { AgentConfig, AgentDiscoveryResult, AgentSource } from './types.js'
import { validateAgent } from './validate.js'

function readDirectoryEntries(directory: string): fs.Dirent[] {
  if (!fs.existsSync(directory)) {
    return []
  }
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
  } catch {
    return []
  }
}

function loadAgentFromFile(
  filePath: string,
  source: AgentSource,
): AgentConfig | undefined {
  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf8')
  } catch {
    return undefined
  }

  const validation = validateAgent(content, source)
  if (!validation.valid) {
    const errors = validation.errors.join('; ')
    console.warn(`Skipping agent ${filePath}: ${errors}`)
    return undefined
  }

  const agent = validation.agent
  if (agent === undefined) return undefined
  agent.source = source
  agent.filePath = filePath
  return agent
}

function loadAgentsFromDirectory(
  directory: string,
  source: AgentSource,
): AgentConfig[] {
  const agents: AgentConfig[] = []
  const entries = readDirectoryEntries(directory)

  for (const entry of entries) {
    if (!entry.name.endsWith('.md')) continue
    if (!entry.isFile() && !entry.isSymbolicLink()) continue

    const filePath = path.join(directory, entry.name)
    const agent = loadAgentFromFile(filePath, source)
    if (agent !== undefined) {
      agents.push(agent)
    }
  }

  return agents
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function findNearestProjectAgentsDirectory(cwd: string): string | undefined {
  let currentDirectory = cwd
  for (;;) {
    const candidate = path.join(currentDirectory, '.pi', 'agents')
    if (isDirectory(candidate)) return candidate

    const parentDirectory = path.dirname(currentDirectory)
    if (parentDirectory === currentDirectory) return undefined
    currentDirectory = parentDirectory
  }
}

function mergeAgentsIntoMap(
  agentMap: Map<string, AgentConfig>,
  agents: AgentConfig[],
): void {
  for (const agent of agents) {
    agentMap.set(agent.name, agent)
  }
}

const extensionAgentsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'agents',
)

export function discoverAgents(cwd: string): AgentDiscoveryResult {
  const userDirectory = path.join(getAgentDir(), 'agents')
  const projectAgentsDirectory = findNearestProjectAgentsDirectory(cwd)

  const userAgents = loadAgentsFromDirectory(userDirectory, 'user')
  const projectAgents =
    projectAgentsDirectory === undefined
      ? []
      : loadAgentsFromDirectory(projectAgentsDirectory, 'project')
  const extensionAgents = loadAgentsFromDirectory(
    extensionAgentsDirectory,
    'extension',
  )

  const agentMap = new Map<string, AgentConfig>()

  // Priority: project > user > extension
  mergeAgentsIntoMap(agentMap, extensionAgents)
  mergeAgentsIntoMap(agentMap, userAgents)
  mergeAgentsIntoMap(agentMap, projectAgents)

  return {
    agents: [...agentMap.values()],
    projectAgentsDir: projectAgentsDirectory,
  }
}

export function formatAgentList(
  agents: AgentConfig[],
  maxItems: number,
): { text: string; remaining: number } {
  if (agents.length === 0) return { text: 'none', remaining: 0 }
  const listed = agents.slice(0, maxItems)
  const remaining = agents.length - listed.length
  return {
    text: listed
      .map((a) => `${a.name} (${a.source}): ${a.description}`)
      .join('; '),
    remaining,
  }
}
