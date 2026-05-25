import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'

import {
  NORMAL_MODE_TOOLS,
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

function enableSpecMode(
  pi: Pick<ExtensionAPI, 'getActiveTools' | 'setActiveTools' | 'appendEntry'>,
  context: ExtensionContext,
  state: SpecModeState,
): void {
  if (!state.isEnabled()) {
    state.setPreviousActiveTools(pi.getActiveTools())
  }
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
  pi: Pick<ExtensionAPI, 'setActiveTools' | 'appendEntry'>,
  context: ExtensionContext,
  state: SpecModeState,
): void {
  const restoredTools = state.getPreviousActiveTools() ?? NORMAL_MODE_TOOLS
  state.setEnabled(false)
  state.setPreviousActiveTools(undefined)
  pi.setActiveTools(restoredTools)
  persistSpecModeState(pi, false)
  context.ui.setStatus('spec-mode', undefined)
  context.ui.notify('Spec mode disabled. Full tool access restored.', 'info')
}

/** @public */
export function setSpecModeEnabled(
  pi: Pick<ExtensionAPI, 'getActiveTools' | 'setActiveTools' | 'appendEntry'>,
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
    'registerCommand' | 'getActiveTools' | 'setActiveTools' | 'appendEntry'
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
