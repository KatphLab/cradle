import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'

import { filterMainAgentTools } from './tool.js'
import { isRecord } from './type-guards.js'

export interface ModeState {
  isEnabled: () => boolean
}

interface SessionEntryLike {
  type?: unknown
  customType?: unknown
  data?: unknown
}

function isSessionEntryLike(value: unknown): value is SessionEntryLike {
  return isRecord(value)
}

export function restoreModeEnabled(
  entries: readonly unknown[],
  customType: string,
): boolean {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (!isSessionEntryLike(entry)) continue
    if (entry.type !== 'custom') continue
    if (entry.customType !== customType) continue
    const entryData = entry.data
    if (isRecord(entryData) && typeof entryData['enabled'] === 'boolean') {
      return entryData['enabled']
    }
  }
  return false
}

/** Strip all `<system-reminder>...</system-reminder>` blocks from text. */
export function stripSystemReminder(text: string): string {
  return text.replaceAll(
    /<system-reminder>[\s\S]*?<\/system-reminder>\n?/gu,
    '',
  )
}

function getAllToolNames(pi: Pick<ExtensionAPI, 'getAllTools'>): string[] {
  return pi.getAllTools().map((tool) => tool.name)
}

export function registerBeforeAgentStartPrompt(
  pi: Pick<ExtensionAPI, 'on'>,
  state: ModeState,
  systemPrompt: string,
): void {
  pi.on('before_agent_start', (event: { systemPrompt: string }) => {
    if (!state.isEnabled()) return
    const cleanedBase = stripSystemReminder(event.systemPrompt)
    const cleanedModePrompt = stripSystemReminder(systemPrompt)
    return {
      systemPrompt: `${cleanedBase}\n\n${cleanedModePrompt}`,
    }
  })
}

export function restoreToolMode(
  pi: Pick<ExtensionAPI, 'getAllTools' | 'setActiveTools'>,
  context: ExtensionContext,
  state: ModeState,
  modeTools: readonly string[],
  updateStatus: (context: ExtensionContext, enabled: boolean) => void,
): void {
  pi.setActiveTools(
    state.isEnabled()
      ? [...modeTools]
      : filterMainAgentTools(getAllToolNames(pi)),
  )
  updateStatus(context, state.isEnabled())
}
