import type { Component, Focusable } from '@earendil-works/pi-tui'
import {
  Input,
  Key,
  matchesKey,
  SelectList,
  type SelectListTheme,
} from '@earendil-works/pi-tui'
import path from 'node:path'

import type {
  CradleSettings,
  DirectoryPermission,
  SubagentModels,
} from '../config/settings.js'
import {
  DEFAULT_INTERVAL,
  type EditorTheme,
  PERMISSION_COLUMNS,
} from './settings-constants.js'
import { SettingsRenderer } from './settings-renderer.js'
import {
  formatDirectoryPath,
  scanDirectorySuggestions,
} from './settings-utilities.js'

interface ModelOption {
  id: string
  name: string
}

interface CradleSettingsResult {
  permissions: DirectoryPermission[]
  reminderInterval: number
  subagentModels: SubagentModels
}

export class CradleSettingsEditor implements Component, Focusable {
  readonly rows: DirectoryPermission[]
  readonly cwd: string
  readonly theme: EditorTheme
  readonly dirInput: Input
  readonly intervalInput: Input
  readonly subagentModels: SubagentModels
  readonly modelDisplayNames: Map<string, string>
  selectedRow: number
  selectedCol: number
  suggestions: string[] = []
  suggestionIndex = -1

  private readonly initialInterval: number
  private readonly availableModels: string[]
  private readonly initialSubagentModels: SubagentModels
  private readonly renderer: SettingsRenderer
  private dirty = false
  private lastInputValue = ''
  private selectList: SelectList | undefined
  tuiRequestRender?: () => void

  onSave?: (result: CradleSettingsResult) => void
  onCancel?: () => void

  focused = false

  constructor(
    initialSettings: CradleSettings,
    cwd: string,
    theme: EditorTheme,
    availableModels?: ModelOption[],
  ) {
    this.rows = (initialSettings.permissions ?? []).map((row) => ({ ...row }))
    this.cwd = cwd
    this.theme = theme
    this.initialInterval = initialSettings.reminderInterval ?? DEFAULT_INTERVAL

    const models = availableModels ?? []
    this.availableModels = models.map((m) => m.id)
    this.modelDisplayNames = new Map(models.map((m) => [m.id, m.name]))

    const subagentModels: SubagentModels = {}
    if (initialSettings.subagentModels?.low !== undefined) {
      subagentModels.low = initialSettings.subagentModels.low
    }
    if (initialSettings.subagentModels?.medium !== undefined) {
      subagentModels.medium = initialSettings.subagentModels.medium
    }
    if (initialSettings.subagentModels?.high !== undefined) {
      subagentModels.high = initialSettings.subagentModels.high
    }
    this.subagentModels = subagentModels
    this.initialSubagentModels = { ...this.subagentModels }

    this.dirInput = new Input()
    this.dirInput.onSubmit = () => {
      this.addCurrentInput()
    }
    this.dirInput.onEscape = () => this.onCancel?.()

    this.intervalInput = new Input()
    this.intervalInput.setValue(String(this.initialInterval))

    this.selectedRow = this.rows.length
    this.selectedCol = 0

    this.renderer = new SettingsRenderer(this)
  }

  getRows(): DirectoryPermission[] {
    return this.rows.map((row) => ({ ...row }))
  }

  getReminderInterval(): number {
    const value = Number.parseInt(this.intervalInput.getValue())
    return Number.isNaN(value) ? this.initialInterval : value
  }

  getSubagentModels(): SubagentModels {
    return { ...this.subagentModels }
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
    const intervalChanged =
      this.intervalInput.getValue() !== String(this.initialInterval)
    const modelsChanged =
      this.subagentModels.low !== this.initialSubagentModels.low ||
      this.subagentModels.medium !== this.initialSubagentModels.medium ||
      this.subagentModels.high !== this.initialSubagentModels.high
    return this.dirty || intervalChanged || modelsChanged
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
      const clampedInterval = Math.max(
        1,
        Math.min(20, this.getReminderInterval()),
      )
      this.onSave?.({
        permissions: this.getRows(),
        reminderInterval: clampedInterval,
        subagentModels: this.getSubagentModels(),
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
    if (this.selectedRow < this.rows.length + 4) {
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
    if (
      this.selectedRow >= this.rows.length + 2 &&
      this.selectedRow <= this.rows.length + 4
    ) {
      this.openModelSelect(this.getTierFromRow(this.selectedRow))
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
      this.intervalInput.handleInput(data)
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
    const items = this.availableModels.map((id) => ({
      value: id,
      label: this.modelDisplayNames.get(id) ?? id,
    }))
    if (items.length === 0) return

    const currentValue = this.subagentModels[tier]
    const currentIndex = currentValue
      ? this.availableModels.indexOf(currentValue)
      : -1

    const selectListTheme: SelectListTheme = {
      selectedPrefix: (text) => this.theme.fg('accent', text),
      selectedText: (text) => this.theme.fg('accent', this.theme.bold(text)),
      description: (text) => this.theme.fg('dim', text),
      scrollInfo: (text) => this.theme.fg('dim', text),
      noMatch: (text) => this.theme.fg('warning', text),
    }

    this.selectList = new SelectList(
      items,
      Math.min(items.length, 8),
      selectListTheme,
    )

    this.selectList.setSelectedIndex(Math.max(currentIndex, 0))
    this.selectList.onSelect = (item) => {
      this.subagentModels[tier] = item.value
      this.dirty = true
      this.selectList = undefined
      this.tuiRequestRender?.()
    }
    this.selectList.onCancel = () => {
      this.selectList = undefined
      this.tuiRequestRender?.()
    }
  }

  invalidate(): void {
    this.dirInput.invalidate()
    this.intervalInput.invalidate()
  }
}
