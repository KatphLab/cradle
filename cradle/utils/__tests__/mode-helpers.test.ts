import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'

import {
  registerBeforeAgentStartPrompt,
  stripSystemReminder,
} from '../mode-helpers.js'

describe('stripSystemReminder', () => {
  it('removes a single system-reminder block', () => {
    const input = `Some text
<system-reminder>
- Do this
- Do that
</system-reminder>
More text`
    expect(stripSystemReminder(input)).toBe('Some text\nMore text')
  })

  it('removes multiple system-reminder blocks', () => {
    const input = `Start
<system-reminder>First</system-reminder>
Middle
<system-reminder>Second</system-reminder>
End`
    expect(stripSystemReminder(input)).toBe('Start\nMiddle\nEnd')
  })

  it('returns text unchanged when no system-reminder is present', () => {
    const input = 'Just plain text with no reminders.'
    expect(stripSystemReminder(input)).toBe(input)
  })

  it('handles multiline reminder content', () => {
    const input = `Before
<system-reminder>
- Line one
- Line two
- Line three
</system-reminder>
After`
    expect(stripSystemReminder(input)).toBe('Before\nAfter')
  })
})

function setup() {
  const handlers: Record<string, (event: unknown) => unknown> = {}
  const pi = {
    on: vi.fn((event: string, handler: (event: unknown) => unknown) => {
      handlers[event] = handler
    }),
  }
  return { pi, handlers }
}

describe('registerBeforeAgentStartPrompt', () => {
  it('appends mode prompt when enabled', () => {
    const { pi, handlers } = setup()
    const state = { isEnabled: () => true }
    registerBeforeAgentStartPrompt(
      pi as Pick<ExtensionAPI, 'on'>,
      state,
      'Mode-specific prompt',
    )

    const result = handlers['before_agent_start']?.({
      systemPrompt: 'Base prompt content',
    }) as { systemPrompt: string } | undefined

    expect(result?.systemPrompt).toContain('Base prompt content')
    expect(result?.systemPrompt).toContain('Mode-specific prompt')
  })

  it('strips system-reminder from base prompt before appending', () => {
    const { pi, handlers } = setup()
    const state = { isEnabled: () => true }
    registerBeforeAgentStartPrompt(
      pi as Pick<ExtensionAPI, 'on'>,
      state,
      'Mode prompt',
    )

    const basePrompt = `Repo rules here.
<system-reminder>
- Approval rules
- Other rules
</system-reminder>
More repo rules.`

    const result = handlers['before_agent_start']?.({
      systemPrompt: basePrompt,
    }) as { systemPrompt: string } | undefined

    expect(result?.systemPrompt).not.toContain('Approval rules')
    expect(result?.systemPrompt).not.toContain('<system-reminder>')
    expect(result?.systemPrompt).toContain('Repo rules here.')
    expect(result?.systemPrompt).toContain('More repo rules.')
    expect(result?.systemPrompt).toContain('Mode prompt')
  })

  it('returns undefined when disabled', () => {
    const { pi, handlers } = setup()
    const state = { isEnabled: () => false }
    registerBeforeAgentStartPrompt(
      pi as Pick<ExtensionAPI, 'on'>,
      state,
      'Mode prompt',
    )

    const result = handlers['before_agent_start']?.({
      systemPrompt: 'Base prompt',
    })
    expect(result).toBeUndefined()
  })
})
