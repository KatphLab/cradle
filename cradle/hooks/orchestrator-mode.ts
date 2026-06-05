import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'

import { ORCHESTRATOR_MODE_SYSTEM_PROMPT } from '../prompts/orchestrator.js'
import {
  registerBeforeAgentStartPrompt,
  restoreToolMode,
  type ModeState,
} from '../utils/mode-helpers.js'
import {
  ORCHESTRATOR_MODE_TOOLS,
  restoreOrchestratorModeEnabled,
  type OrchestratorModeState,
} from '../utils/orchestrator-state.js'

const MUTATION_TOOLS = new Set(['bash', 'edit', 'write'])

function updateOrchestratorStatus(
  context: ExtensionContext,
  enabled: boolean,
): void {
  context.ui.setStatus(
    'orchestrator-mode',
    enabled ? context.ui.theme.fg('accent', 'orch') : undefined,
  )
}

function restoreTools(
  pi: Pick<ExtensionAPI, 'getAllTools' | 'setActiveTools'>,
  context: ExtensionContext,
  state: ModeState,
): void {
  restoreToolMode(
    pi,
    context,
    state,
    ORCHESTRATOR_MODE_TOOLS,
    updateOrchestratorStatus,
  )
}

/** @public */
export function registerOrchestratorModeHook(
  pi: Pick<ExtensionAPI, 'on' | 'getAllTools' | 'setActiveTools'>,
  state: OrchestratorModeState,
): void {
  pi.on('session_start', (_event, context) => {
    state.setEnabled(
      restoreOrchestratorModeEnabled(context.sessionManager.getEntries()),
    )
    restoreTools(pi, context, state)
  })

  registerBeforeAgentStartPrompt(pi, state, ORCHESTRATOR_MODE_SYSTEM_PROMPT)

  pi.on('tool_call', (event) => {
    if (!state.isEnabled()) return
    if (!MUTATION_TOOLS.has(event.toolName)) return

    return {
      block: true,
      reason:
        'Orchestrator mode blocks bash, edit, and write. Disable orchestrator mode to mutate implementation files.',
    }
  })
}
