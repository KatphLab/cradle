import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'

import { SPEC_MODE_SYSTEM_PROMPT } from '../prompts/spec.js'
import {
  NORMAL_MODE_TOOLS,
  SPEC_MODE_TOOLS,
  restoreSpecModeEnabled,
  type SpecModeState,
} from '../utils/spec-state.js'

const MUTATION_TOOLS = new Set(['bash', 'edit', 'write'])

function updateSpecStatus(context: ExtensionContext, enabled: boolean): void {
  context.ui.setStatus(
    'spec-mode',
    enabled ? context.ui.theme.fg('warning', 'spec') : undefined,
  )
}

function restoreToolMode(
  pi: Pick<ExtensionAPI, 'setActiveTools'>,
  context: ExtensionContext,
  state: SpecModeState,
): void {
  if (state.isEnabled()) {
    pi.setActiveTools(SPEC_MODE_TOOLS)
  } else {
    pi.setActiveTools(NORMAL_MODE_TOOLS)
  }
  updateSpecStatus(context, state.isEnabled())
}

/** @public */
export function registerSpecModeHook(
  pi: Pick<ExtensionAPI, 'on' | 'setActiveTools'>,
  state: SpecModeState,
): void {
  pi.on('session_start', (_event, context) => {
    state.setEnabled(
      restoreSpecModeEnabled(context.sessionManager.getEntries()),
    )
    state.setPreviousActiveTools(undefined)
    restoreToolMode(pi, context, state)
  })

  pi.on('before_agent_start', (event) => {
    if (!state.isEnabled()) return

    return {
      systemPrompt: `${event.systemPrompt}\n\n${SPEC_MODE_SYSTEM_PROMPT}`,
    }
  })

  pi.on('tool_call', (event) => {
    if (!state.isEnabled()) return
    if (!MUTATION_TOOLS.has(event.toolName)) return

    return {
      block: true,
      reason:
        'Spec mode blocks bash, edit, and write. Use read, glob, grep, ls, todo, and create_spec only.',
    }
  })
}
