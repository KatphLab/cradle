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

import { loadCradleSettings, saveCradleSettings } from '../config/settings.js'

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

export class DirectoryAllowlistEditor implements Component, Focusable {
  private readonly input: Input
  private readonly directories: string[]
  private readonly cwd: string
  private readonly theme: EditorTheme
  private selectedIndex = -1
  private suggestions: string[] = []
  private suggestionIndex = -1
  private lastInputValue = ''
  private dirty = false
  tuiRequestRender?: () => void

  onSave?: (directories: string[]) => void
  onCancel?: () => void

  focused = false

  constructor(initialDirectories: string[], cwd: string, theme: EditorTheme) {
    this.directories = [...initialDirectories]
    this.cwd = cwd
    this.theme = theme
    this.input = new Input()
    this.input.onSubmit = () => {
      this.addCurrentInput()
    }
    this.input.onEscape = () => this.onCancel?.()
  }

  getDirectories(): string[] {
    return [...this.directories]
  }

  getSuggestions(): string[] {
    return [...this.suggestions]
  }

  getSelectedIndex(): number {
    return this.selectedIndex
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
    if (!this.directories.includes(resolved)) {
      this.directories.push(resolved)
      this.dirty = true
    }
    this.input.setValue('')
    this.suggestions = []
    this.lastInputValue = ''
    this.selectedIndex = this.directories.length - 1
  }

  deleteSelected(): void {
    if (this.selectedIndex >= 0) {
      this.directories.splice(this.selectedIndex, 1)
      this.dirty = true
      if (this.selectedIndex >= this.directories.length) {
        this.selectedIndex = this.directories.length - 1
      }
      if (this.selectedIndex < 0) {
        this.input.focused = this.focused
      }
    }
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
    this.tryHandleToInput(data)
  }

  private tryHandleSave(data: string): boolean {
    if (matchesKey(data, Key.ctrl('s'))) {
      this.onSave?.(this.directories)
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
    if (matchesKey(data, Key.delete)) {
      this.deleteSelected()
      this.tuiRequestRender?.()
      return true
    }
    return false
  }

  private tryHandleNavigation(data: string): boolean {
    if (
      matchesKey(data, Key.down) &&
      this.selectedIndex < this.directories.length - 1
    ) {
      this.selectedIndex++
      this.input.focused = false
      this.tuiRequestRender?.()
      return true
    }
    if (matchesKey(data, Key.up) && this.selectedIndex >= 0) {
      this.selectedIndex--
      if (this.selectedIndex < 0) {
        this.input.focused = this.focused
      }
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

  private tryHandleToInput(data: string): boolean {
    if (this.selectedIndex < 0) {
      this.input.handleInput(data)
      void this.updateSuggestions()
      this.tuiRequestRender?.()
      return true
    }
    return false
  }

  render(width: number): string[] {
    return [
      ...this.renderHeader(),
      ...this.renderInput(width),
      ...this.renderSuggestions(width),
      ...this.renderItems(width),
      ...this.renderHelp(width),
    ]
  }

  private renderHeader(): string[] {
    return [
      this.theme.fg('accent', this.theme.bold('Extra Read Directories')),
      ...(this.dirty
        ? [`  ${this.theme.fg('warning', '● Unsaved changes')}`]
        : []),
      '',
    ]
  }

  private renderInput(width: number): string[] {
    if (width <= 2) {
      return [truncateToWidth('> ', width)]
    }
    const inputRenderWidth = width - 2
    const inputLines = this.input.render(inputRenderWidth)
    if (inputLines.length === 0) return []
    const firstLine = inputLines[0]
    if (firstLine !== undefined) {
      return [`> ${firstLine}`]
    }
    return []
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

  private renderItems(width: number): string[] {
    if (this.directories.length === 0) {
      return [this.theme.fg('dim', '  (no extra directories)')]
    }

    return this.directories.map((directory, index) => {
      const isSelected = index === this.selectedIndex
      const prefix = isSelected ? '> ' : '  '
      const display = formatDirectoryPath(directory, this.cwd)
      return prefix + truncateToWidth(display, width - 2)
    })
  }

  private renderHelp(width: number): string[] {
    const helpText =
      'Type path • Enter add • Tab/↑↓ suggestions • Del remove • Ctrl+S save • Esc cancel'
    return ['', truncateToWidth(this.theme.fg('dim', helpText), width)]
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
    description: 'Configure Cradle extension settings',
    handler: async (_args, context) => {
      const settings = await loadCradleSettings(context.cwd)
      const initialDirectories = settings.read?.extraAllowedDirectories ?? []

      const result = await context.ui.custom<string[] | undefined>(
        (tui, theme, _kb, done) => {
          const editor = new DirectoryAllowlistEditor(
            initialDirectories,
            context.cwd,
            theme,
          )
          editor.tuiRequestRender = () => {
            tui.requestRender()
          }

          editor.onSave = (directories) => {
            done(directories)
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
        ...settings,
        read: {
          ...settings.read,
          extraAllowedDirectories: result,
        },
      })

      context.ui.notify(
        `Cradle settings saved: ${result.length} extra read directories`,
        'info',
      )
    },
  })
}
