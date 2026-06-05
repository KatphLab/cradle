import { restoreModeEnabled } from './mode-helpers.js'

export const SPEC_MODE_STATE_TYPE = 'cradle-spec-mode'
export const SPEC_MODE_TOOLS = [
  'read',
  'glob',
  'grep',
  'ls',
  'edit',
  'write',
  'todo',
]

export interface SpecModeState {
  isEnabled: () => boolean
  setEnabled: (enabled: boolean) => void
}

export function createSpecModeState(): SpecModeState {
  let enabled = false

  return {
    isEnabled: () => enabled,
    setEnabled: (nextEnabled) => {
      enabled = nextEnabled
    },
  }
}

export function restoreSpecModeEnabled(entries: readonly unknown[]): boolean {
  return restoreModeEnabled(entries, SPEC_MODE_STATE_TYPE)
}
