import type { Component, Focusable, SelectList } from '@earendil-works/pi-tui'
import { Input } from '@earendil-works/pi-tui'

import type {
  DirectoryPermission,
  GlobalSettings,
  ProjectSettings,
  SubagentModels,
} from '../../config/settings.js'
import { createApiKeyInput, getApiKeyValue } from './api-keys.js'
import type { EditorTheme } from './constants.js'
import { initFromGlobal } from './editor-init.js'
import { handleInput } from './editor-input.js'
import {
  addCurrentInput,
  deleteRow,
  isDirty,
  togglePermission,
  updateSuggestions,
} from './editor-state.js'
import { getModelReference, type ModelOption } from './model-select.js'
import { SettingsRenderer } from './renderer.js'
import type { CradleSettingsResult, EditorLike } from './types.js'

export class CradleSettingsEditor implements Component, Focusable, EditorLike {
  readonly rows: DirectoryPermission[]
  readonly cwd: string
  readonly theme: EditorTheme
  readonly dirInput: Input
  readonly tokenThresholdInput: Input
  readonly subagentModels: SubagentModels
  displaySystemReminder: boolean
  advisorModel: string | undefined
  compactionModel: string | undefined
  firecrawlApiKey: string | undefined
  readonly firecrawlApiKeyInput: Input
  tavilyApiKey: string | undefined
  readonly tavilyApiKeyInput: Input
  exaApiKey: string | undefined
  readonly exaApiKeyInput: Input
  jinaApiKey: string | undefined
  readonly jinaApiKeyInput: Input
  readonly modelDisplayNames: Map<string, string>
  selectedRow: number
  selectedCol: number
  suggestions: string[] = []
  suggestionIndex = -1

  /**
   * Internal — accessed by extracted editor-*.ts functions.
   * Made non-private so the delegate functions can read them from the editor object.
   */
  readonly initialTokenThreshold: number
  readonly initialDisplaySystemReminder: boolean
  readonly availableModels: string[]
  readonly initialSubagentModels: SubagentModels
  readonly initialAdvisorModel: string | undefined
  readonly initialCompactionModel: string | undefined
  readonly initialFirecrawlApiKey: string | undefined
  readonly initialTavilyApiKey: string | undefined
  readonly initialExaApiKey: string | undefined
  readonly initialJinaApiKey: string | undefined
  private readonly renderer: SettingsRenderer
  dirty = false
  lastInputValue = ''
  selectList: SelectList | undefined
  tuiRequestRender?: () => void

  onSave?: (result: CradleSettingsResult) => void
  onCancel?: () => void

  focused = false

  constructor(
    projectSettings: ProjectSettings,
    globalSettings: GlobalSettings,
    cwd: string,
    theme: EditorTheme,
    availableModels?: ModelOption[],
  ) {
    this.cwd = cwd
    this.theme = theme

    const models = availableModels ?? []
    this.availableModels = models.map((model) => getModelReference(model))
    this.modelDisplayNames = new Map(
      models.map((model) => {
        const reference = getModelReference(model)
        return [reference, reference] as const
      }),
    )

    this.rows = (projectSettings.permissions ?? []).map((row) => ({ ...row }))
    ;({
      tokenThreshold: this.initialTokenThreshold,
      displaySystemReminder: this.displaySystemReminder,
      subagentModels: this.subagentModels,
      initialSubagentModels: this.initialSubagentModels,
      initialDisplaySystemReminder: this.initialDisplaySystemReminder,
      advisorModel: this.advisorModel,
      initialAdvisorModel: this.initialAdvisorModel,
      compactionModel: this.compactionModel,
      initialCompactionModel: this.initialCompactionModel,
      firecrawlApiKey: this.firecrawlApiKey,
      initialFirecrawlApiKey: this.initialFirecrawlApiKey,
      tavilyApiKey: this.tavilyApiKey,
      initialTavilyApiKey: this.initialTavilyApiKey,
      exaApiKey: this.exaApiKey,
      initialExaApiKey: this.initialExaApiKey,
      jinaApiKey: this.jinaApiKey,
      initialJinaApiKey: this.initialJinaApiKey,
    } = initFromGlobal(globalSettings))

    this.dirInput = new Input()
    this.dirInput.onSubmit = () => {
      addCurrentInput(this)
    }
    this.dirInput.onEscape = () => this.onCancel?.()

    this.tokenThresholdInput = new Input()
    this.tokenThresholdInput.setValue(String(this.initialTokenThreshold))

    this.firecrawlApiKeyInput = createApiKeyInput(this.firecrawlApiKey)
    this.tavilyApiKeyInput = createApiKeyInput(this.tavilyApiKey)
    this.exaApiKeyInput = createApiKeyInput(this.exaApiKey)
    this.jinaApiKeyInput = createApiKeyInput(this.jinaApiKey)

    this.selectedRow = this.rows.length
    this.selectedCol = 0

    this.renderer = new SettingsRenderer(this)
  }

  getRows(): DirectoryPermission[] {
    return this.rows.map((row) => ({ ...row }))
  }
  getReminderTokenThreshold(): number {
    const value = Number.parseInt(this.tokenThresholdInput.getValue())
    return Number.isNaN(value) ? this.initialTokenThreshold : value
  }
  getDisplaySystemReminder(): boolean {
    return this.displaySystemReminder
  }
  getSubagentModels(): SubagentModels {
    return { ...this.subagentModels }
  }
  getCompactionModel(): string | undefined {
    return this.compactionModel
  }
  getFirecrawlApiKey(): string | undefined {
    return getApiKeyValue(this.firecrawlApiKeyInput)
  }
  getTavilyApiKey(): string | undefined {
    return getApiKeyValue(this.tavilyApiKeyInput)
  }
  getExaApiKey(): string | undefined {
    return getApiKeyValue(this.exaApiKeyInput)
  }
  getJinaApiKey(): string | undefined {
    return getApiKeyValue(this.jinaApiKeyInput)
  }
  getSuggestions(): string[] {
    return [...this.suggestions]
  }
  getSelectedRow(): number {
    return this.selectedRow
  }
  getSelectedCol(): number {
    return this.selectedCol
  }
  getDirInput(): Input {
    return this.dirInput
  }
  getSelectList(): SelectList | undefined {
    return this.selectList
  }

  isDirty(): boolean {
    return isDirty(this)
  }

  addCurrentInput(): void {
    addCurrentInput(this)
  }

  deleteRow(index: number): void {
    deleteRow(this, index)
  }

  togglePermission(rowIndex: number, colIndex: number): void {
    togglePermission(this, rowIndex, colIndex)
  }

  async updateSuggestions(): Promise<void> {
    await updateSuggestions(this)
  }

  handleInput(data: string): void {
    handleInput(this, data)
  }

  render(width: number): string[] {
    return this.renderer.render(width)
  }

  invalidate(): void {
    this.dirInput.invalidate()
    this.tokenThresholdInput.invalidate()
    this.firecrawlApiKeyInput.invalidate()
    this.tavilyApiKeyInput.invalidate()
    this.exaApiKeyInput.invalidate()
    this.jinaApiKeyInput.invalidate()
  }
}
