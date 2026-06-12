import { restoreModeEnabled } from './mode-helpers.js'

export const ORCHESTRATOR_MODE_STATE_TYPE = 'cradle-orchestrator-mode'
export const ORCHESTRATOR_MODE_TOOLS = [
  'read',
  'glob',
  'grep',
  'ls',
  'discover-agents',
  'subagent',
  'todo',
  'iterative_retrieval',
  'webfetch',
  'websearch',
]

export interface OrchestratorModeState {
  isEnabled: () => boolean
  setEnabled: (enabled: boolean) => void
}

export function createOrchestratorModeState(): OrchestratorModeState {
  let enabled = false

  return {
    isEnabled: () => enabled,
    setEnabled: (nextEnabled) => {
      enabled = nextEnabled
    },
  }
}

export function restoreOrchestratorModeEnabled(
  entries: readonly unknown[],
): boolean {
  return restoreModeEnabled(entries, ORCHESTRATOR_MODE_STATE_TYPE)
}
