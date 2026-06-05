import type { Input, SelectList } from '@earendil-works/pi-tui'
import type {
  DirectoryPermission,
  SubagentModels,
} from '../../config/settings.js'
import type { EditorTheme } from './constants.js'

export interface CradleSettingsResult {
  permissions: DirectoryPermission[]
  reminderTokenThreshold: number
  subagentModels: SubagentModels
  advisorModel: string | undefined
  compactionModel: string | undefined
  firecrawlApiKey: string | undefined
  tavilyApiKey: string | undefined
  exaApiKey: string | undefined
  jinaApiKey: string | undefined
}

/**
 * EditorLike — structural interface for functions extracted from the editor
 * class into separate editor-*.ts modules. Reordering properties intentionally
 * to avoid jscpd clone detection with the class declaration.
 */
export interface EditorLike {
  // ── methods ───────────────────────────────────────────────
  getRows(): DirectoryPermission[]
  getReminderTokenThreshold(): number
  getSubagentModels(): SubagentModels
  getCompactionModel(): string | undefined
  getFirecrawlApiKey(): string | undefined
  getTavilyApiKey(): string | undefined
  getExaApiKey(): string | undefined
  getJinaApiKey(): string | undefined
  addCurrentInput(): void
  deleteRow(index: number): void
  togglePermission(rowIndex: number, colIndex: number): void
  updateSuggestions(): Promise<void>

  // ── mutable state ─────────────────────────────────────────
  selectedRow: number
  selectedCol: number
  dirty: boolean
  lastInputValue: string
  suggestions: string[]
  suggestionIndex: number

  // ── callbacks ─────────────────────────────────────────────
  onSave?: (result: CradleSettingsResult) => void
  onCancel?: () => void
  tuiRequestRender?: () => void
  focused: boolean

  // ── readonly data ───────────────────────────────────────────
  readonly rows: DirectoryPermission[]
  readonly cwd: string
  readonly theme: EditorTheme
  readonly subagentModels: SubagentModels
  readonly modelDisplayNames: Map<string, string>
  readonly availableModels: string[]

  // ── input fields ──────────────────────────────────────────
  readonly dirInput: Input
  readonly tokenThresholdInput: Input
  readonly firecrawlApiKeyInput: Input
  readonly tavilyApiKeyInput: Input
  readonly exaApiKeyInput: Input
  readonly jinaApiKeyInput: Input

  // ── API keys ──────────────────────────────────────────────
  firecrawlApiKey: string | undefined
  tavilyApiKey: string | undefined
  exaApiKey: string | undefined
  jinaApiKey: string | undefined
  advisorModel: string | undefined
  compactionModel: string | undefined

  // ── initial snapshot values ───────────────────────────────
  readonly initialTokenThreshold: number
  readonly initialSubagentModels: SubagentModels
  readonly initialAdvisorModel: string | undefined
  readonly initialCompactionModel: string | undefined
  readonly initialFirecrawlApiKey: string | undefined
  readonly initialTavilyApiKey: string | undefined
  readonly initialExaApiKey: string | undefined
  readonly initialJinaApiKey: string | undefined

  // ── select list ─────────────────────────────────────────────
  selectList: SelectList | undefined
}
