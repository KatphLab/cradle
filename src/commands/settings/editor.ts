import type { Component, Focusable } from '@earendil-works/pi-tui'
import { Input, Key, matchesKey, type SelectList } from '@earendil-works/pi-tui'
import path from 'node:path'

import {
  DEFAULT_REMINDER_TOKEN_THRESHOLD,
  MAX_REMINDER_TOKEN_THRESHOLD,
  MIN_REMINDER_TOKEN_THRESHOLD,
  type DirectoryPermission,
  type GlobalSettings,
  type ProjectSettings,
  type SubagentModels,
} from '../../config/settings.js'
import {
  API_KEY_EXTRA_ROW_COUNT,
  API_KEY_FIELDS,
  createApiKeyInput,
  getApiKeyValue,
  getInitialApiKey,
  isApiKeyChanged,
} from './api-keys.js'
import { PERMISSION_COLUMNS, type EditorTheme } from './constants.js'
import { createModelSelectList, type ModelOption } from './model-select.js'
import { SettingsRenderer } from './renderer.js'
import { formatDirectoryPath, scanDirectorySuggestions } from './utilities.js'

interface CradleSettingsResult {
  permissions: DirectoryPermission[]
  reminderTokenThreshold: number
  subagentModels: SubagentModels
  advisorModel: string | undefined
  firecrawlApiKey: string | undefined
  tavilyApiKey: string | undefined
}

const TOTAL_EXTRA_ROWS = 5 + API_KEY_EXTRA_ROW_COUNT

export class CradleSettingsEditor implements Component, Focusable {
  readonly rows: DirectoryPermission[]
  readonly cwd: string
  readonly theme: EditorTheme
  readonly dirInput: Input
  readonly tokenThresholdInput: Input
  readonly subagentModels: SubagentModels
  advisorModel: string | undefined
  firecrawlApiKey: string | undefined
  readonly firecrawlApiKeyInput: Input
  tavilyApiKey: string | undefined
  readonly tavilyApiKeyInput: Input
  readonly modelDisplayNames: Map<string, string>
  selectedRow: number
  selectedCol: number
  suggestions: string[] = []
  suggestionIndex = -1

  private readonly initialTokenThreshold: number
  private readonly availableModels: string[]
  private readonly initialSubagentModels: SubagentModels
  private readonly initialAdvisorModel: string | undefined
  private readonly initialFirecrawlApiKey: string | undefined
  private readonly initialTavilyApiKey: string | undefined
  private readonly renderer: SettingsRenderer
  private dirty = false
  private lastInputValue = ''
  private selectList: SelectList | undefined
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
    this.availableModels = models.map((m) => m.id)
    this.modelDisplayNames = new Map(
      models.map((m) => [m.id, `${m.provider}/${m.id}`]),
    )

    this.rows = (projectSettings.permissions ?? []).map((row) => ({ ...row }))
    ;({
      tokenThreshold: this.initialTokenThreshold,
      subagentModels: this.subagentModels,
      initialSubagentModels: this.initialSubagentModels,
      advisorModel: this.advisorModel,
      initialAdvisorModel: this.initialAdvisorModel,
      firecrawlApiKey: this.firecrawlApiKey,
      initialFirecrawlApiKey: this.initialFirecrawlApiKey,
      tavilyApiKey: this.tavilyApiKey,
      initialTavilyApiKey: this.initialTavilyApiKey,
    } = this.initFromGlobal(globalSettings))

    this.dirInput = new Input()
    this.dirInput.onSubmit = () => {
      this.addCurrentInput()
    }
    this.dirInput.onEscape = () => this.onCancel?.()

    this.tokenThresholdInput = new Input()
    this.tokenThresholdInput.setValue(String(this.initialTokenThreshold))

    this.firecrawlApiKeyInput = createApiKeyInput(this.firecrawlApiKey)
    this.tavilyApiKeyInput = createApiKeyInput(this.tavilyApiKey)

    this.selectedRow = this.rows.length
    this.selectedCol = 0

    this.renderer = new SettingsRenderer(this)
  }

  private initFromGlobal(globalSettings: GlobalSettings): {
    tokenThreshold: number
    subagentModels: SubagentModels
    initialSubagentModels: SubagentModels
    advisorModel: string | undefined
    initialAdvisorModel: string | undefined
    firecrawlApiKey: string | undefined
    initialFirecrawlApiKey: string | undefined
    tavilyApiKey: string | undefined
    initialTavilyApiKey: string | undefined
  } {
    const tokenThreshold =
      globalSettings.reminderTokenThreshold ?? DEFAULT_REMINDER_TOKEN_THRESHOLD

    const subagentModels: SubagentModels = {}
    if (globalSettings.subagentModels?.low !== undefined) {
      subagentModels.low = globalSettings.subagentModels.low
    }
    if (globalSettings.subagentModels?.medium !== undefined) {
      subagentModels.medium = globalSettings.subagentModels.medium
    }
    if (globalSettings.subagentModels?.high !== undefined) {
      subagentModels.high = globalSettings.subagentModels.high
    }

    return {
      tokenThreshold,
      subagentModels,
      initialSubagentModels: { ...subagentModels },
      advisorModel: globalSettings.advisorModel,
      initialAdvisorModel: globalSettings.advisorModel,
      firecrawlApiKey: getInitialApiKey(globalSettings, 'firecrawlApiKey'),
      initialFirecrawlApiKey: getInitialApiKey(
        globalSettings,
        'firecrawlApiKey',
      ),
      tavilyApiKey: getInitialApiKey(globalSettings, 'tavilyApiKey'),
      initialTavilyApiKey: getInitialApiKey(globalSettings, 'tavilyApiKey'),
    }
  }

  getRows(): DirectoryPermission[] {
    return this.rows.map((row) => ({ ...row }))
  }
  getReminderTokenThreshold(): number {
    const value = Number.parseInt(this.tokenThresholdInput.getValue())
    return Number.isNaN(value) ? this.initialTokenThreshold : value
  }
  getSubagentModels(): SubagentModels {
    return { ...this.subagentModels }
  }
  getFirecrawlApiKey(): string | undefined {
    return getApiKeyValue(this.firecrawlApiKeyInput)
  }
  getTavilyApiKey(): string | undefined {
    return getApiKeyValue(this.tavilyApiKeyInput)
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
    const tokenThresholdChanged =
      this.tokenThresholdInput.getValue() !== String(this.initialTokenThreshold)
    const modelsChanged =
      this.subagentModels.low !== this.initialSubagentModels.low ||
      this.subagentModels.medium !== this.initialSubagentModels.medium ||
      this.subagentModels.high !== this.initialSubagentModels.high
    const advisorChanged = this.advisorModel !== this.initialAdvisorModel
    const firecrawlKeyChanged = isApiKeyChanged(
      this.firecrawlApiKeyInput,
      this.initialFirecrawlApiKey,
    )
    const tavilyKeyChanged = isApiKeyChanged(
      this.tavilyApiKeyInput,
      this.initialTavilyApiKey,
    )
    return (
      this.dirty ||
      tokenThresholdChanged ||
      modelsChanged ||
      advisorChanged ||
      firecrawlKeyChanged ||
      tavilyKeyChanged
    )
  }

  addCurrentInput(): void {
    const value = this.dirInput.getValue().trim()
    if (!value) return

    const resolved = path.resolve(this.cwd, value)
    if (!this.rows.some((row) => row.path === resolved)) {
      this.rows.push({
        path: resolved,
        read: true,
        write: false,
        bash: false,
      })
      this.dirty = true
      this.selectedRow = this.rows.length - 1
      this.selectedCol = 1
    }
    this.dirInput.setValue('')
    this.suggestions = []
    this.lastInputValue = ''
  }

  deleteRow(index: number): void {
    if (index >= 0 && index < this.rows.length) {
      this.rows.splice(index, 1)
      this.dirty = true
      if (this.selectedRow >= this.rows.length) {
        this.selectedRow = this.rows.length
        this.selectedCol = 0
      }
    }
  }

  togglePermission(rowIndex: number, colIndex: number): void {
    const key = PERMISSION_COLUMNS[colIndex - 1]
    if (key === undefined) return
    const row = this.rows[rowIndex]
    if (row === undefined) return
    row[key] = !row[key]
    this.dirty = true
  }

  async updateSuggestions(): Promise<void> {
    const value = this.dirInput.getValue().trim()
    if (value === this.lastInputValue) return
    this.lastInputValue = value

    this.suggestions = await scanDirectorySuggestions(value, this.cwd)
    this.suggestionIndex = this.suggestions.length > 0 ? 0 : -1
    this.tuiRequestRender?.()
  }

  handleInput(data: string): void {
    if (this.tryHandleSave(data)) return
    if (this.selectList) {
      this.selectList.handleInput(data)
      this.tuiRequestRender?.()
      return
    }
    if (this.tryHandleSuggestions(data)) return
    if (this.tryHandleDelete(data)) return
    if (this.tryHandleNavigation(data)) return
    if (this.tryHandleCancel(data)) return
    if (this.tryHandleToggle(data)) return
    this.tryHandleToInput(data)
  }

  private tryHandleSave(data: string): boolean {
    if (matchesKey(data, Key.ctrl('s'))) {
      const clampedTokenThreshold = Math.max(
        MIN_REMINDER_TOKEN_THRESHOLD,
        Math.min(
          MAX_REMINDER_TOKEN_THRESHOLD,
          this.getReminderTokenThreshold(),
        ),
      )
      this.onSave?.({
        permissions: this.getRows(),
        reminderTokenThreshold: clampedTokenThreshold,
        subagentModels: this.getSubagentModels(),
        advisorModel: this.advisorModel,
        firecrawlApiKey: this.getFirecrawlApiKey(),
        tavilyApiKey: this.getTavilyApiKey(),
      })
      return true
    }
    return false
  }
  private tryHandleSuggestions(data: string): boolean {
    if (this.suggestions.length === 0) return false
    return (
      this.tryHandleSuggestionNavigation(data) ||
      this.tryHandleSuggestionAccept(data) ||
      this.tryHandleSuggestionDismiss(data)
    )
  }
  private tryHandleSuggestionNavigation(data: string): boolean {
    if (matchesKey(data, Key.down)) {
      this.suggestionIndex = Math.min(
        this.suggestionIndex + 1,
        this.suggestions.length - 1,
      )
      this.tuiRequestRender?.()
      return true
    }
    if (matchesKey(data, Key.up)) {
      this.suggestionIndex = Math.max(this.suggestionIndex - 1, 0)
      this.tuiRequestRender?.()
      return true
    }
    return false
  }
  private tryHandleSuggestionAccept(data: string): boolean {
    if (
      !(
        (matchesKey(data, Key.enter) || matchesKey(data, Key.tab)) &&
        this.suggestionIndex >= 0
      )
    ) {
      return false
    }
    const suggestion = this.suggestions[this.suggestionIndex]
    if (suggestion !== undefined) {
      this.dirInput.setValue(formatDirectoryPath(suggestion, this.cwd))
      this.dirInput.handleInput('\u0005')
      this.suggestions = []
      this.lastInputValue = this.dirInput.getValue()
      if (matchesKey(data, Key.enter)) {
        this.addCurrentInput()
      }
      this.tuiRequestRender?.()
    }
    return true
  }
  private tryHandleSuggestionDismiss(data: string): boolean {
    if (matchesKey(data, Key.escape)) {
      this.suggestions = []
      this.tuiRequestRender?.()
      return true
    }
    return false
  }
  private tryHandleDelete(data: string): boolean {
    if (matchesKey(data, Key.delete) && this.selectedRow < this.rows.length) {
      this.deleteRow(this.selectedRow)
      this.tuiRequestRender?.()
      return true
    }
    return false
  }
  private tryHandleNavigation(data: string): boolean {
    if (matchesKey(data, Key.down)) {
      return this.moveDown()
    }
    if (matchesKey(data, Key.up)) {
      return this.moveUp()
    }
    if (this.selectedRow < this.rows.length) {
      return this.moveHorizontal(data)
    }
    return false
  }
  private moveDown(): boolean {
    const maxRow = this.rows.length + TOTAL_EXTRA_ROWS
    if (this.selectedRow < maxRow) {
      this.selectedRow++
      const isNowOnDataRow = this.selectedRow < this.rows.length
      const isNowOnDirectoryInput = this.selectedRow === this.rows.length
      this.selectedCol = isNowOnDataRow ? Math.max(1, this.selectedCol) : 0
      if (isNowOnDirectoryInput) {
        this.suggestions = []
        this.suggestionIndex = -1
      }
    }
    this.tuiRequestRender?.()
    return true
  }
  private moveUp(): boolean {
    if (this.selectedRow > 0) {
      this.selectedRow--
    }
    this.tuiRequestRender?.()
    return true
  }
  private moveHorizontal(data: string): boolean {
    if (matchesKey(data, Key.right)) {
      this.selectedCol = Math.min(this.selectedCol + 1, 3)
      this.tuiRequestRender?.()
      return true
    }
    if (matchesKey(data, Key.left)) {
      this.selectedCol = Math.max(this.selectedCol - 1, 1)
      this.tuiRequestRender?.()
      return true
    }
    return false
  }
  private tryHandleCancel(data: string): boolean {
    if (matchesKey(data, Key.escape)) {
      this.onCancel?.()
      return true
    }
    return false
  }
  private tryHandleToggle(data: string): boolean {
    if (!matchesKey(data, Key.space) && !matchesKey(data, Key.enter)) {
      return false
    }
    if (
      this.selectedRow < this.rows.length &&
      this.selectedCol >= 1 &&
      this.selectedCol <= 3
    ) {
      this.togglePermission(this.selectedRow, this.selectedCol)
      this.tuiRequestRender?.()
      return true
    }
    return this.tryHandleModelToggle()
  }
  private tryHandleModelToggle(): boolean {
    const relativeRow = this.selectedRow - (this.rows.length + 2)
    if (relativeRow >= 0 && relativeRow <= 2) {
      this.openModelSelect(this.getTierFromRow(this.selectedRow))
      this.tuiRequestRender?.()
      return true
    }
    if (relativeRow === 3) {
      this.openAdvisorModelSelect()
      this.tuiRequestRender?.()
      return true
    }
    return false
  }
  private tryHandleToInput(data: string): boolean {
    if (this.selectedRow === this.rows.length) {
      this.dirInput.handleInput(data)
      void this.updateSuggestions()
      this.tuiRequestRender?.()
      return true
    }
    if (this.selectedRow === this.rows.length + 1) {
      this.tokenThresholdInput.handleInput(data)
      this.tuiRequestRender?.()
      return true
    }
    for (const field of API_KEY_FIELDS) {
      if (this.selectedRow !== this.rows.length + field.rowOffset) continue
      this[field.inputKey].handleInput(data)
      this.tuiRequestRender?.()
      return true
    }
    return false
  }
  render(width: number): string[] {
    return this.renderer.render(width)
  }
  private getTierFromRow(rowIndex: number): 'low' | 'medium' | 'high' {
    const offset = rowIndex - (this.rows.length + 2)
    const tiers = ['low', 'medium', 'high'] as const
    return tiers[offset] ?? 'low'
  }
  private openModelSelect(tier: 'low' | 'medium' | 'high'): void {
    this.openSelectList(
      () => this.subagentModels[tier],
      (value) => {
        this.subagentModels[tier] = value
      },
    )
  }
  private openAdvisorModelSelect(): void {
    this.openSelectList(
      () => this.advisorModel,
      (value) => {
        this.advisorModel = value
      },
    )
  }
  private openSelectList(
    getCurrentValue: () => string | undefined,
    assignValue: (value: string) => void,
  ): void {
    this.selectList = createModelSelectList({
      assignValue,
      availableModels: this.availableModels,
      getCurrentValue,
      modelDisplayNames: this.modelDisplayNames,
      onCancel: () => {
        this.selectList = undefined
        this.tuiRequestRender?.()
      },
      onSelect: () => {
        this.dirty = true
        this.selectList = undefined
        this.tuiRequestRender?.()
      },
      theme: this.theme,
    })
  }

  invalidate(): void {
    this.dirInput.invalidate()
    this.tokenThresholdInput.invalidate()
    this.firecrawlApiKeyInput.invalidate()
    this.tavilyApiKeyInput.invalidate()
  }
}
