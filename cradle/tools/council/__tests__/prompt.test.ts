import { describe, expect, it } from 'vitest'
import { buildSynthesisUserMessage, buildVoiceUserMessage } from '../prompt.js'

describe('buildVoiceUserMessage', () => {
  it('builds message with question only', () => {
    const result = buildVoiceUserMessage({
      question: 'Should we use monorepo or polyrepo?',
      context: undefined,
    })
    expect(result).toContain('## Decision Question')
    expect(result).toContain('Should we use monorepo or polyrepo?')
    expect(result).toContain('## Instructions')
  })

  it('includes context when provided', () => {
    const result = buildVoiceUserMessage({
      question: 'Which framework?',
      context: 'We have a React codebase with 200 components.',
    })
    expect(result).toContain('## Context')
    expect(result).toContain('React codebase with 200 components')
  })

  it('skips empty context', () => {
    const result = buildVoiceUserMessage({
      question: 'Which database?',
      context: '',
    })
    expect(result).not.toContain('## Context')
  })
})

describe('buildSynthesisUserMessage', () => {
  it('includes all four voice responses', () => {
    const result = buildSynthesisUserMessage({
      question: 'Ship or hold?',
      context: undefined,
      architectResponse: 'Hold for polish',
      skepticResponse: 'Question if polish matters',
      pragmatistResponse: 'Ship now',
      criticResponse: 'Ship risks support burden',
    })
    expect(result).toContain('## Original Question')
    expect(result).toContain('Ship or hold?')
    expect(result).toContain('### Architect')
    expect(result).toContain('Hold for polish')
    expect(result).toContain('### Skeptic')
    expect(result).toContain('Question if polish matters')
    expect(result).toContain('### Pragmatist')
    expect(result).toContain('Ship now')
    expect(result).toContain('### Critic')
    expect(result).toContain('Ship risks support burden')
  })

  it('includes context when provided', () => {
    const result = buildSynthesisUserMessage({
      question: 'Decision',
      context: 'Project context here',
      architectResponse: 'Arch',
      skepticResponse: 'Skep',
      pragmatistResponse: 'Prag',
      criticResponse: 'Crit',
    })
    expect(result).toContain('Project context here')
  })

  it('skips empty context', () => {
    const result = buildSynthesisUserMessage({
      question: 'Decision',
      context: '',
      architectResponse: 'Arch',
      skepticResponse: 'Skep',
      pragmatistResponse: 'Prag',
      criticResponse: 'Crit',
    })
    const sections = result.split('\n\n')
    const contextSection = sections.find((s) => s.startsWith('## Context'))
    expect(contextSection).toBeUndefined()
  })

  it('includes synthesis instruction', () => {
    const result = buildSynthesisUserMessage({
      question: 'Q',
      context: undefined,
      architectResponse: 'A',
      skepticResponse: 'B',
      pragmatistResponse: 'C',
      criticResponse: 'D',
    })
    expect(result).toContain('Synthesize these four')
  })
})
