import { parseFrontmatter } from '@earendil-works/pi-coding-agent'

import type { AgentConfig, AgentSource } from './types.js'

export interface AgentValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  agent?: AgentConfig
}

interface ParsedAgentContent {
  body: string
  frontmatter: Record<string, string | undefined>
}

interface ValidatedFrontmatter {
  name: string
  description: string
  tools?: string
  model?: string
}

interface FrontmatterValidationResult {
  errors: string[]
  warnings: string[]
  validated?: ValidatedFrontmatter
}

interface ParseSuccess {
  parsed: true
  content: ParsedAgentContent
}

interface ParseFailure {
  parsed: false
  result: AgentValidationResult
}

type ParseResult = ParseSuccess | ParseFailure

function getErrorCodeSuffix(error: unknown): string {
  if (!(error instanceof Error) || !('code' in error)) {
    return ''
  }

  return ` (${String(error.code)})`
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseAgentContent(content: string): ParseResult {
  try {
    const parsed = parseFrontmatter<Record<string, string | undefined>>(content)
    return {
      parsed: true,
      content: {
        frontmatter: parsed.frontmatter,
        body: parsed.body,
      },
    }
  } catch (error) {
    const message = getErrorMessage(error)
    const code = getErrorCodeSuffix(error)
    return {
      parsed: false,
      result: {
        valid: false,
        errors: [`YAML parse error${code}: ${message}`],
        warnings: [],
      },
    }
  }
}

function parseTools(tools: string | undefined): string[] {
  if (tools === undefined || tools === '') {
    return []
  }

  return tools
    .split(',')
    .map((tool) => tool.trim())
    .filter(Boolean)
}

function addNameValidationErrors(
  name: string | null | undefined,
  errors: string[],
): void {
  if (name === undefined || name === null || name === '') {
    errors.push("Missing required frontmatter field: 'name'")
    return
  }

  if (name.length > 64) {
    errors.push(`Name exceeds 64 characters (${name.length})`)
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    errors.push(
      'Name contains invalid characters. Must be lowercase a-z, 0-9, hyphens only.',
    )
  }
  if (name.startsWith('-') || name.endsWith('-')) {
    errors.push('Name must not start or end with a hyphen.')
  }
  if (name.includes('--')) {
    errors.push('Name must not contain consecutive hyphens.')
  }
}

function addDescriptionValidationErrors(
  description: string | null | undefined,
  errors: string[],
): void {
  if (description === undefined || description === null || description === '') {
    errors.push("Missing required frontmatter field: 'description'")
    return
  }

  if (description.length > 1024) {
    errors.push(`Description exceeds 1024 characters (${description.length})`)
  }
}

function addToolWarnings(
  toolsValue: string | undefined,
  warnings: string[],
): void {
  if (toolsValue === undefined || toolsValue === '') {
    return
  }

  const tools = parseTools(toolsValue)
  if (tools.length === 0) {
    warnings.push('Tools list is empty')
  }
}

function addModelWarnings(model: string | undefined, warnings: string[]): void {
  if (model?.trim() === '') {
    warnings.push('Model is empty')
  }
  if (model !== undefined) {
    warnings.push(
      'Model field in agent frontmatter is ignored; use complexity-based model selection via /cradle-settings',
    )
  }
}

function validateFrontmatter(
  frontmatter: Record<string, string | undefined>,
): FrontmatterValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const name = frontmatter['name']
  const description = frontmatter['description']
  const tools = frontmatter['tools']
  const model = frontmatter['model']

  addNameValidationErrors(name, errors)
  addDescriptionValidationErrors(description, errors)
  addToolWarnings(tools, warnings)
  addModelWarnings(model, warnings)

  if (errors.length > 0 || name === undefined || description === undefined) {
    return { errors, warnings }
  }

  const validated: ValidatedFrontmatter = { name, description }
  if (tools !== undefined) {
    validated.tools = tools
  }
  if (model !== undefined) {
    validated.model = model
  }

  return { errors, warnings, validated }
}

function buildAgentConfig(
  frontmatter: ValidatedFrontmatter,
  body: string,
  source: AgentSource,
): AgentConfig {
  const agent: AgentConfig = {
    name: frontmatter.name,
    description: frontmatter.description,
    systemPrompt: body,
    source,
    filePath: '',
  }

  const tools = parseTools(frontmatter.tools)
  if (tools.length > 0) {
    agent.tools = tools
  }
  if (frontmatter.model !== undefined) {
    agent.model = frontmatter.model
  }

  return agent
}

export function validateAgent(
  content: string,
  source: AgentSource,
): AgentValidationResult {
  const parseResult = parseAgentContent(content)
  if (!parseResult.parsed) {
    return parseResult.result
  }

  const { frontmatter, body } = parseResult.content
  const { errors, warnings, validated } = validateFrontmatter(frontmatter)
  if (validated === undefined) {
    return { valid: false, errors, warnings }
  }

  const agent = buildAgentConfig(validated, body, source)
  return { valid: true, errors, warnings, agent }
}
