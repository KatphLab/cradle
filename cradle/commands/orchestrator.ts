import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'

import {
  ORCHESTRATOR_MODE_STATE_TYPE,
  ORCHESTRATOR_MODE_TOOLS,
  type OrchestratorModeState,
} from '../utils/orchestrator-state.js'
import { filterMainAgentTools } from '../utils/tool.js'

function persistOrchestratorModeState(
  pi: Pick<ExtensionAPI, 'appendEntry'>,
  enabled: boolean,
): void {
  pi.appendEntry(ORCHESTRATOR_MODE_STATE_TYPE, { enabled })
}

function getAllToolNames(pi: Pick<ExtensionAPI, 'getAllTools'>): string[] {
  return pi.getAllTools().map((tool) => tool.name)
}

function enableOrchestratorMode(
  pi: Pick<ExtensionAPI, 'setActiveTools' | 'appendEntry'>,
  context: ExtensionContext,
  state: OrchestratorModeState,
): void {
  state.setEnabled(true)
  pi.setActiveTools(ORCHESTRATOR_MODE_TOOLS)
  persistOrchestratorModeState(pi, true)
  context.ui.setStatus(
    'orchestrator-mode',
    context.ui.theme.fg('accent', 'orch'),
  )
  context.ui.notify(
    `Orchestrator mode enabled. Tools: ${ORCHESTRATOR_MODE_TOOLS.join(', ')}`,
    'info',
  )
}

function disableOrchestratorMode(
  pi: Pick<ExtensionAPI, 'getAllTools' | 'setActiveTools' | 'appendEntry'>,
  context: ExtensionContext,
  state: OrchestratorModeState,
): void {
  state.setEnabled(false)
  pi.setActiveTools(filterMainAgentTools(getAllToolNames(pi)))
  persistOrchestratorModeState(pi, false)
  context.ui.setStatus('orchestrator-mode', undefined)
  context.ui.notify(
    'Orchestrator mode disabled. Full tool access restored.',
    'info',
  )
}

/** @public */
export function setOrchestratorModeEnabled(
  pi: Pick<ExtensionAPI, 'getAllTools' | 'setActiveTools' | 'appendEntry'>,
  context: ExtensionContext,
  state: OrchestratorModeState,
  enabled: boolean,
): void {
  if (enabled) {
    enableOrchestratorMode(pi, context, state)
    return
  }
  disableOrchestratorMode(pi, context, state)
}

/** @public */
export function registerOrchestratorCommand(
  pi: Pick<
    ExtensionAPI,
    'registerCommand' | 'getAllTools' | 'setActiveTools' | 'appendEntry'
  >,
  state: OrchestratorModeState,
): void {
  pi.registerCommand('orchestrator', {
    description:
      'Toggle orchestrator mode for read-only inspection and delegation to subagents',
    handler: (_args, context): Promise<void> => {
      setOrchestratorModeEnabled(pi, context, state, !state.isEnabled())
      return Promise.resolve()
    },
  })
}
