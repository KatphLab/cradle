import { describe, expect, it } from 'vitest'

import { validateAgent } from './validate.js'

function makeAgent(overrides: {
  name?: string
  description?: string
  tools?: string
  model?: string
  body?: string
}) {
  const name = overrides.name ?? 'test-agent'
  const description = overrides.description ?? 'A test agent for validation.'
  const tools = overrides.tools ? `tools: ${overrides.tools}\n` : ''
  const model = overrides.model ? `model: ${overrides.model}\n` : ''
  const body = overrides.body ?? 'Do useful things.'
  return `---\nname: ${name}\ndescription: ${description}\n${tools}${model}---\n${body}`
}

describe('validateAgent', () => {
  it('validates a correct agent', () => {
    const result = validateAgent(makeAgent({}), 'project')
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
    expect(result.agent).toMatchObject({
      name: 'test-agent',
      description: 'A test agent for validation.',
      systemPrompt: 'Do useful things.',
    })
  })

  it('validates agent with all optional fields', () => {
    const result = validateAgent(
      makeAgent({ tools: 'read,ls', model: 'claude-sonnet-4' }),
      'project',
    )
    expect(result.valid).toBe(true)
    expect(result.agent?.tools).toEqual(['read', 'ls'])
    expect(result.agent?.model).toBe('claude-sonnet-4')
  })

  it('rejects missing name', () => {
    const result = validateAgent(
      makeAgent({ name: '', description: 'Valid description.' }),
      'project',
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      "Missing required frontmatter field: 'name'",
    )
  })

  it('rejects missing description', () => {
    const result = validateAgent(
      makeAgent({ name: 'test-agent', description: '' }),
      'project',
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      "Missing required frontmatter field: 'description'",
    )
  })

  it('rejects duplicate yaml keys', () => {
    const content = `---\nname: discover\ndescription: ok\ntools: read\ntools: read\n---\nbody`
    const result = validateAgent(content, 'project')
    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/YAML parse error \(DUPLICATE_KEY\)/)
  })

  it('rejects name with invalid characters', () => {
    const result = validateAgent(makeAgent({ name: 'TestAgent' }), 'project')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'Name contains invalid characters. Must be lowercase a-z, 0-9, hyphens only.',
    )
  })

  it('rejects name starting with hyphen', () => {
    const result = validateAgent(makeAgent({ name: '-test' }), 'project')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Name must not start or end with a hyphen.')
  })

  it('rejects name ending with hyphen', () => {
    const result = validateAgent(makeAgent({ name: 'test-' }), 'project')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Name must not start or end with a hyphen.')
  })

  it('rejects name with consecutive hyphens', () => {
    const result = validateAgent(makeAgent({ name: 'test--agent' }), 'project')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'Name must not contain consecutive hyphens.',
    )
  })

  it('rejects name exceeding 64 characters', () => {
    const result = validateAgent(makeAgent({ name: 'a'.repeat(65) }), 'project')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Name exceeds 64 characters (65)')
  })

  it('rejects description exceeding 1024 characters', () => {
    const result = validateAgent(
      makeAgent({ description: 'a'.repeat(1025) }),
      'project',
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'Description exceeds 1024 characters (1025)',
    )
  })

  it('accepts agent with no tools key', () => {
    const result = validateAgent(makeAgent({}), 'project')
    expect(result.valid).toBe(true)
    expect(result.warnings).toHaveLength(0)
    expect(result.agent?.tools).toBeUndefined()
  })

  it('accepts agent with no model key', () => {
    const result = validateAgent(makeAgent({}), 'project')
    expect(result.valid).toBe(true)
    expect(result.warnings).toHaveLength(0)
    expect(result.agent?.model).toBeUndefined()
  })
})
