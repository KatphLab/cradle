import type { ThemeColor } from '@earendil-works/pi-coding-agent'
import type { Input } from '@earendil-works/pi-tui'
import type { DirectoryPermission, SubagentModels } from '../config/settings.js'

export interface EditorTheme {
  fg: (color: ThemeColor, text: string) => string
  bold: (text: string) => string
}

export interface EditorState {
  readonly rows: DirectoryPermission[]
  readonly cwd: string
  readonly theme: EditorTheme
  readonly dirInput: Input
  readonly intervalInput: Input
  readonly subagentModels: SubagentModels
  readonly modelDisplayNames: Map<string, string>
  readonly selectedRow: number
  readonly selectedCol: number
  readonly suggestions: string[]
  readonly suggestionIndex: number
  isDirty(): boolean
}

export type PermissionColumn = (typeof PERMISSION_COLUMNS)[number]

export const PERMISSION_COLUMNS = ['read', 'write', 'bash'] as const
export const PERMISSION_LABELS: Record<PermissionColumn, string> = {
  read: 'Read',
  write: 'Write',
  bash: 'Bash',
}
export const TOGGLE_WIDTH = 5
export const GAP = 2
export const INTERVAL_LABEL = 'System Reminder Interval (turns)'
export const DEFAULT_INTERVAL = 3
export const TIER_LABELS: Record<'low' | 'medium' | 'high', string> = {
  low: 'Low Model',
  medium: 'Medium Model',
  high: 'High Model',
}
