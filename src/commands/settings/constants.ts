import type { ThemeColor } from '@earendil-works/pi-coding-agent'
import type { Input, SelectList } from '@earendil-works/pi-tui'
import type {
  DirectoryPermission,
  SubagentModels,
} from '../../config/settings.js'

export interface EditorTheme {
  fg: (color: ThemeColor, text: string) => string
  bold: (text: string) => string
}

export interface EditorState {
  readonly rows: DirectoryPermission[]
  readonly cwd: string
  readonly theme: EditorTheme
  readonly dirInput: Input
  readonly tokenThresholdInput: Input
  readonly firecrawlApiKeyInput: Input
  readonly tavilyApiKeyInput: Input
  readonly subagentModels: SubagentModels
  readonly advisorModel: string | undefined
  readonly modelDisplayNames: Map<string, string>
  readonly selectedRow: number
  readonly selectedCol: number
  readonly suggestions: string[]
  readonly suggestionIndex: number
  isDirty(): boolean
  getSelectList(): SelectList | undefined
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
export const TOKEN_THRESHOLD_LABEL = 'System Reminder Token Threshold'
export const TIER_LABELS: Record<'low' | 'medium' | 'high', string> = {
  low: 'Low Model',
  medium: 'Medium Model',
  high: 'High Model',
}
export const ADVISOR_MODEL_LABEL = 'Advisor Model'
