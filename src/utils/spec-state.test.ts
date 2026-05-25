import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  createSpecModeState,
  generateSpecFilename,
  getSpecFilePath,
  kebabCase,
  restoreSpecModeEnabled,
} from './spec-state.js'

describe('spec-state utilities', () => {
  it('generates dated kebab-case spec filenames', () => {
    const date = new Date(2026, 4, 26)

    expect(generateSpecFilename('Add Spec Mode!', date)).toBe(
      '2026-05-26-add-spec-mode.md',
    )
  })

  it('uses spec fallback for empty slugs', () => {
    expect(kebabCase('---')).toBe('spec')
  })

  it('builds .pi/specs file paths', () => {
    const date = new Date(2026, 4, 26)
    const filePath = getSpecFilePath('/repo', 'My Spec', undefined, date)

    expect(filePath).toBe(
      path.join('/repo', '.pi', 'specs', '2026-05-26-my-spec.md'),
    )
  })

  it('restores the latest spec mode state', () => {
    const entries = [
      {
        type: 'custom',
        customType: 'cradle-spec-mode',
        data: { enabled: true },
      },
      {
        type: 'custom',
        customType: 'cradle-spec-mode',
        data: { enabled: false },
      },
    ]

    expect(restoreSpecModeEnabled(entries)).toBe(false)
  })

  it('ignores invalid spec mode entries while restoring', () => {
    const entries = [
      'not-an-entry',
      {
        type: 'message',
        customType: 'cradle-spec-mode',
        data: { enabled: true },
      },
      { type: 'custom', customType: 'other', data: { enabled: true } },
      {
        type: 'custom',
        customType: 'cradle-spec-mode',
        data: { enabled: 'yes' },
      },
    ]

    expect(restoreSpecModeEnabled(entries)).toBe(false)
  })

  it('stores and clears previous active tools', () => {
    const state = createSpecModeState()

    expect(state.isEnabled()).toBe(false)
    expect(state.getPreviousActiveTools()).toBeUndefined()

    state.setEnabled(true)
    state.setPreviousActiveTools(['read'])

    expect(state.isEnabled()).toBe(true)
    expect(state.getPreviousActiveTools()).toEqual(['read'])

    state.setPreviousActiveTools(undefined)
    expect(state.getPreviousActiveTools()).toBeUndefined()
  })
})
