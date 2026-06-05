import path from 'node:path'

import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'

import { SPEC_MODE_SYSTEM_PROMPT } from '../prompts/spec.js'
import {
  registerBeforeAgentStartPrompt,
  restoreToolMode,
  type ModeState,
} from '../utils/mode-helpers.js'
import {
  SPEC_MODE_TOOLS,
  restoreSpecModeEnabled,
  type SpecModeState,
} from '../utils/spec-state.js'

const MUTATION_TOOLS = new Set(['bash', 'edit', 'write'])

function isSpecsPath(filePath: string, cwd: string): boolean {
  const resolved = path.resolve(cwd, filePath)
  const specsDirectory = path.resolve(cwd, '.pi', 'specs')
  const relative = path.relative(specsDirectory, resolved)
  return (
    !relative.startsWith('..') &&
    !path.isAbsolute(relative) &&
    resolved.endsWith('.md')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getStringProperty(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined
  if (!(key in value)) return undefined
  return typeof value[key] === 'string' ? value[key] : undefined
}

function updateSpecStatus(context: ExtensionContext, enabled: boolean): void {
  context.ui.setStatus(
    'spec-mode',
    enabled ? context.ui.theme.fg('warning', 'spec') : undefined,
  )
}

function restoreTools(
  pi: Pick<ExtensionAPI, 'getAllTools' | 'setActiveTools'>,
  context: ExtensionContext,
  state: ModeState,
): void {
  restoreToolMode(pi, context, state, SPEC_MODE_TOOLS, updateSpecStatus)
}

/** @public */
export function registerSpecModeHook(
  pi: Pick<ExtensionAPI, 'on' | 'getAllTools' | 'setActiveTools'>,
  state: SpecModeState,
): void {
  pi.on('session_start', (_event, context) => {
    state.setEnabled(
      restoreSpecModeEnabled(context.sessionManager.getEntries()),
    )
    restoreTools(pi, context, state)
  })

  registerBeforeAgentStartPrompt(pi, state, SPEC_MODE_SYSTEM_PROMPT)

  pi.on('tool_call', (event, context) => {
    if (!state.isEnabled()) return
    if (!MUTATION_TOOLS.has(event.toolName)) return

    const targetPath =
      event.toolName === 'edit' || event.toolName === 'write'
        ? getStringProperty(event.input, 'path')
        : undefined
    if (targetPath !== undefined && isSpecsPath(targetPath, context.cwd)) {
      return
    }

    return {
      block: true,
      reason:
        'Spec mode blocks bash, edit, and write outside .pi/specs/*.md. Disable spec mode to mutate implementation files.',
    }
  })
}
