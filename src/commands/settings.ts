import type { ExtensionAPI, ThemeColor } from '@earendil-works/pi-coding-agent'
import {
  Input,
  Key,
  matchesKey,
  truncateToWidth,
  type Component,
  type Focusable,
} from '@earendil-works/pi-tui'
import { readdir } from 'node:fs/promises'
import path from 'node:path'

import {
  loadCradleSettings,
  saveCradleSettings,
  type DirectoryPermission,
} from '../config/settings.js'

interface EditorTheme {
  fg: (color: ThemeColor, text: string) => string
  bold: (text: string) => string
}

/** @public */
export async function scanDirectorySuggestions(
  inputPath: string,
  cwd: string,
): Promise<string[]> {
  if (!inputPath.trim()) return []

  const resolved = path.resolve(cwd, inputPath)

  // When input ends with a path separator, browse inside that directory
  if (/[/\\]$/.test(inputPath)) {
    try {
      const entries = await readdir(resolved, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(resolved, entry.name))
        .slice(0, 8)
    } catch {
      return []
    }
  }

  const directory = path.dirname(resolved)
  const base = path.basename(resolved)

  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(base))
      .map((entry) => path.join(directory, entry.name))
      .slice(0, 8)
  } catch {
    return []
  }
}

/** @public */
export function formatDirectoryPath(directory: string, cwd: string): string {
  const relative = path.relative(cwd, directory)
  return relative.startsWith('..') || path.isAbsolute(relative)
    ? directory
    : relative || '.'
}

const PERMISSION_COLUMNS = ['read', 'write', 'bash'] as const
const PERMISSION_LABELS: Record<(typeof PERMISSION_COLUMNS)[number], string> = {
  read: 'Read',
  write: 'Write',
  bash: 'Bash',
}
const TOGGLE_WIDTH = 5
const GAP = 2

export class DirectoryPermissionsEditor implements Component, Focusable {
  private readonly rows: DirectoryPermission[]
  private readonly cwd: string
  private readonly theme: EditorTheme
  private readonly input: Input
  private selectedRow: number
  private selectedCol: number
  private dirty = false
  private suggestions: string[] = []
  private suggestionIndex = -1
  private lastInputValue = ''
  tuiRequestRender?: () => void

  onSave?: (rows: DirectoryPermission[]) => void
  onCancel?: () => void

  focused = false

  constructor(
    initialRows: DirectoryPermission[],
    cwd: string,
    theme: EditorTheme,
  ) {
    this.rows = initialRows.map((row) => ({ ...row }))
    this.cwd = cwd
    this.theme = theme
    this.input = new Input()
    this.input.onSubmit = () => {
      this.addCurrentInput()
    }
    this.input.onEscape = () => this.onCancel?.()
    this.selectedRow = this.rows.length
    this.selectedCol = 0
  }

  getRows(): DirectoryPermission[] {
    return this.rows.map((row) => ({ ...row }))
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

  getInput(): Input {
    return this.input
  }

  isDirty(): boolean {
    return this.dirty
  }

  addCurrentInput(): void {
    const value = this.input.getValue().trim()
    if (!value) return

    const resolved = path.resolve(this.cwd, value)
    if (!this.rows.some((row) => row.path === resolved)) {
      this.rows.push({ path: resolved, read: true, write: false, bash: false })
      this.dirty = true
      this.selectedRow = this.rows.length - 1
      this.selectedCol = 1
    }
    this.input.setValue('')
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
    const value = this.input.getValue().trim()
    if (value === this.lastInputValue) return
    this.lastInputValue = value

    this.suggestions = await scanDirectorySuggestions(value, this.cwd)
    this.suggestionIndex = this.suggestions.length > 0 ? 0 : -1
    this.tuiRequestRender?.()
  }

  handleInput(data: string): void {
    if (this.tryHandleSave(data)) return
    if (this.tryHandleSuggestions(data)) return
    if (this.tryHandleDelete(data)) return
    if (this.tryHandleNavigation(data)) return
    if (this.tryHandleCancel(data)) return
    if (this.tryHandleToggle(data)) return
    this.tryHandleToInput(data)
  }

  private tryHandleSave(data: string): boolean {
    if (matchesKey(data, Key.ctrl('s'))) {
      this.onSave?.(this.getRows())
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
      this.input.setValue(formatDirectoryPath(suggestion, this.cwd))
      this.input.handleInput('\u0005')
      this.suggestions = []
      this.lastInputValue = this.input.getValue()
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
    if (this.selectedRow < this.rows.length) {
      this.selectedRow++
      const isNowOnDataRow = this.selectedRow < this.rows.length
      this.selectedCol = isNowOnDataRow ? Math.max(1, this.selectedCol) : 0
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
    if (this.selectedRow >= this.rows.length) return false
    if (!matchesKey(data, Key.space) && !matchesKey(data, Key.enter)) {
      return false
    }
    if (this.selectedCol >= 1 && this.selectedCol <= 3) {
      this.togglePermission(this.selectedRow, this.selectedCol)
      this.tuiRequestRender?.()
      return true
    }
    return false
  }

  private tryHandleToInput(data: string): boolean {
    if (this.selectedRow === this.rows.length) {
      this.input.handleInput(data)
      void this.updateSuggestions()
      this.tuiRequestRender?.()
      return true
    }
    return false
  }

  render(width: number): string[] {
    return [
      ...this.renderHeader(width),
      '',
      ...this.renderTableHeader(width),
      ...this.renderSeparator(width),
      ...this.renderRows(width),
      ...this.renderInput(width),
      ...this.renderSuggestions(width),
      ...this.renderHelp(width),
    ]
  }

  private renderHeader(width: number): string[] {
    const title = this.theme.fg(
      'accent',
      this.theme.bold('Directory Permissions'),
    )
    const dirty = this.dirty
      ? `  ${this.theme.fg('warning', '● Unsaved changes')}`
      : ''
    return [truncateToWidth(title + dirty, width)]
  }

  private renderTableHeader(width: number): string[] {
    const prefixWidth = 2
    const pathWidth = Math.max(
      10,
      width - prefixWidth - 3 * (TOGGLE_WIDTH + GAP),
    )
    const pathHeader = truncateToWidth('Path', pathWidth).padEnd(pathWidth)
    const readHeader = truncateToWidth(
      PERMISSION_LABELS.read,
      TOGGLE_WIDTH,
    ).padEnd(TOGGLE_WIDTH)
    const writeHeader = truncateToWidth(
      PERMISSION_LABELS.write,
      TOGGLE_WIDTH,
    ).padEnd(TOGGLE_WIDTH)
    const bashHeader = truncateToWidth(
      PERMISSION_LABELS.bash,
      TOGGLE_WIDTH,
    ).padEnd(TOGGLE_WIDTH)
    return [
      `  ${pathHeader}${' '.repeat(GAP)}${readHeader}${' '.repeat(GAP)}${writeHeader}${' '.repeat(GAP)}${bashHeader}`,
    ]
  }

  private renderSeparator(width: number): string[] {
    const line = '─'.repeat(Math.max(0, width))
    return [line]
  }

  private renderRows(width: number): string[] {
    if (this.rows.length === 0) {
      return [this.theme.fg('dim', '  (no extra directories)')]
    }

    const prefixWidth = 2
    const pathWidth = Math.max(
      10,
      width - prefixWidth - 3 * (TOGGLE_WIDTH + GAP),
    )
    const lines: string[] = []

    for (const [index, row] of this.rows.entries()) {
      const isSelected = index === this.selectedRow
      const prefix = isSelected ? '> ' : '  '
      const displayPath = formatDirectoryPath(row.path, this.cwd)
      const pathText = truncateToWidth(displayPath, pathWidth).padEnd(pathWidth)

      const readText = this.renderToggle(
        row.read,
        isSelected && this.selectedCol === 1,
      )
      const writeText = this.renderToggle(
        row.write,
        isSelected && this.selectedCol === 2,
      )
      const bashText = this.renderToggle(
        row.bash,
        isSelected && this.selectedCol === 3,
      )

      lines.push(
        `${prefix}${pathText}${' '.repeat(GAP)}${readText}${' '.repeat(GAP)}${writeText}${' '.repeat(GAP)}${bashText}`,
      )
    }

    return lines
  }

  private renderToggle(value: boolean, isSelected: boolean): string {
    const box = value ? '[✓]' : '[ ]'
    const padded = box.padEnd(TOGGLE_WIDTH)
    if (isSelected) {
      return this.theme.fg('accent', this.theme.bold(padded))
    }
    return padded
  }

  private renderInput(width: number): string[] {
    if (this.selectedRow !== this.rows.length) return []

    const prefix = '> '
    const inputWidth = Math.max(0, width - prefix.length)
    const inputLines = this.input.render(inputWidth)
    if (inputLines.length === 0) return []
    const [firstLine = ''] = inputLines
    return ['', `${prefix}${firstLine}`]
  }

  private renderSuggestions(width: number): string[] {
    if (this.suggestions.length === 0) return []

    const lines = this.suggestions.map((suggestion, index) => {
      const isSelected = index === this.suggestionIndex
      const prefix = isSelected ? '  ▸ ' : '    '
      const display = formatDirectoryPath(suggestion, this.cwd)
      return prefix + truncateToWidth(display, width - 4)
    })
    return [...lines, '']
  }

  private renderHelp(width: number): string[] {
    const helpText =
      '↑↓ navigate • ←→ columns • Space/Enter toggle • Del remove • Ctrl+S save • Esc cancel'
    return [truncateToWidth(this.theme.fg('dim', helpText), width)]
  }

  invalidate(): void {
    this.input.invalidate()
  }
}

/** @public */
export function registerSettingsCommand(
  pi: Pick<ExtensionAPI, 'registerCommand'>,
): void {
  pi.registerCommand('cradle-settings', {
    description: 'Configure Cradle directory permissions',
    handler: async (_args, context) => {
      const settings = await loadCradleSettings(context.cwd)
      const initialRows = settings.permissions ?? []

      const result = await context.ui.custom<DirectoryPermission[] | undefined>(
        (tui, theme, _kb, done) => {
          const editor = new DirectoryPermissionsEditor(
            initialRows,
            context.cwd,
            theme,
          )
          editor.tuiRequestRender = () => {
            tui.requestRender()
          }

          editor.onSave = (rows) => {
            done(rows)
          }
          editor.onCancel = () => {
            done(void 0)
          }

          return editor
        },
      )

      if (result === undefined) {
        context.ui.notify('Cradle settings unchanged', 'info')
        return
      }

      await saveCradleSettings(context.cwd, {
        permissions: result,
      })

      context.ui.notify(
        `Cradle settings saved: ${result.length} directory permissions`,
        'info',
      )
    },
  })
}
