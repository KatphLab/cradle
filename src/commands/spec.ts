import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'

import {
  SPEC_MODE_STATE_TYPE,
  SPEC_MODE_TOOLS,
  type SpecModeState,
} from '../utils/spec-state.js'

function persistSpecModeState(
  pi: Pick<ExtensionAPI, 'appendEntry'>,
  enabled: boolean,
): void {
  pi.appendEntry(SPEC_MODE_STATE_TYPE, { enabled })
}

function getAllToolNames(pi: Pick<ExtensionAPI, 'getAllTools'>): string[] {
  return pi.getAllTools().map((tool) => tool.name)
}

function enableSpecMode(
  pi: Pick<ExtensionAPI, 'setActiveTools' | 'appendEntry'>,
  context: ExtensionContext,
  state: SpecModeState,
): void {
  state.setEnabled(true)
  pi.setActiveTools(SPEC_MODE_TOOLS)
  persistSpecModeState(pi, true)
  context.ui.setStatus('spec-mode', context.ui.theme.fg('warning', 'spec'))
  context.ui.notify(
    `Spec mode enabled. Tools: ${SPEC_MODE_TOOLS.join(', ')}`,
    'info',
  )
}

function disableSpecMode(
  pi: Pick<ExtensionAPI, 'getAllTools' | 'setActiveTools' | 'appendEntry'>,
  context: ExtensionContext,
  state: SpecModeState,
): void {
  state.setEnabled(false)
  pi.setActiveTools(getAllToolNames(pi))
  persistSpecModeState(pi, false)
  context.ui.setStatus('spec-mode', undefined)
  context.ui.notify('Spec mode disabled. Full tool access restored.', 'info')
}

/** @public */
export function setSpecModeEnabled(
  pi: Pick<ExtensionAPI, 'getAllTools' | 'setActiveTools' | 'appendEntry'>,
  context: ExtensionContext,
  state: SpecModeState,
  enabled: boolean,
): void {
  if (enabled) {
    enableSpecMode(pi, context, state)
    return
  }
  disableSpecMode(pi, context, state)
}

/** @public */
export function registerSpecCommand(
  pi: Pick<
    ExtensionAPI,
    'registerCommand' | 'getAllTools' | 'setActiveTools' | 'appendEntry'
  >,
  state: SpecModeState,
): void {
  pi.registerCommand('spec', {
    description: 'Toggle spec mode for read-only planning and spec artifacts',
    handler: (_args, context): Promise<void> => {
      setSpecModeEnabled(pi, context, state, !state.isEnabled())
      return Promise.resolve()
    },
  })
}
