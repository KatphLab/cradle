import { truncateToWidth } from '@earendil-works/pi-tui'
import {
  GAP,
  PERMISSION_LABELS,
  TIER_LABELS,
  TOGGLE_WIDTH,
  TOKEN_THRESHOLD_LABEL,
  type EditorState,
} from './settings-constants.js'
import { formatDirectoryPath } from './settings-utilities.js'

export class SettingsRenderer {
  constructor(private readonly editor: EditorState) {}

  render(width: number): string[] {
    return [
      ...this.renderHeader(width),
      '',
      ...this.renderTableHeader(width),
      ...this.renderSeparator(width),
      ...this.renderRows(width),
      ...this.renderDirInput(width),
      ...this.renderSuggestions(width),
      ...this.renderTokenThresholdSection(width),
      ...this.renderModelSection(width),
      ...this.renderHelp(width),
    ]
  }

  private renderHeader(width: number): string[] {
    const title = this.editor.theme.fg(
      'accent',
      this.editor.theme.bold('Cradle Settings'),
    )
    const dirty = this.editor.isDirty()
      ? `  ${this.editor.theme.fg('warning', '● Unsaved changes')}`
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
    if (this.editor.rows.length === 0) {
      return [this.editor.theme.fg('dim', '  (no extra directories)')]
    }

    const prefixWidth = 2
    const pathWidth = Math.max(
      10,
      width - prefixWidth - 3 * (TOGGLE_WIDTH + GAP),
    )
    const lines: string[] = []

    for (const [index, row] of this.editor.rows.entries()) {
      const isSelected = index === this.editor.selectedRow
      const prefix = isSelected ? '> ' : '  '
      const displayPath = formatDirectoryPath(row.path, this.editor.cwd)
      const pathText = truncateToWidth(displayPath, pathWidth).padEnd(pathWidth)

      const readText = this.renderToggle(
        row.read,
        isSelected && this.editor.selectedCol === 1,
      )
      const writeText = this.renderToggle(
        row.write,
        isSelected && this.editor.selectedCol === 2,
      )
      const bashText = this.renderToggle(
        row.bash,
        isSelected && this.editor.selectedCol === 3,
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
      return this.editor.theme.fg('accent', this.editor.theme.bold(padded))
    }
    return padded
  }

  private renderDirInput(width: number): string[] {
    if (this.editor.selectedRow !== this.editor.rows.length) return []

    const prefix = '> '
    const inputWidth = Math.max(0, width - prefix.length)
    const inputLines = this.editor.dirInput.render(inputWidth)
    if (inputLines.length === 0) return []
    const [firstLine = ''] = inputLines
    return ['', `${prefix}${firstLine}`]
  }

  private renderSuggestions(width: number): string[] {
    if (this.editor.suggestions.length === 0) return []

    const lines = this.editor.suggestions.map((suggestion, index) => {
      const isSelected = index === this.editor.suggestionIndex
      const prefix = isSelected ? '  ▸ ' : '    '
      const display = formatDirectoryPath(suggestion, this.editor.cwd)
      return prefix + truncateToWidth(display, width - 4)
    })
    return [...lines, '']
  }

  private renderTokenThresholdSection(width: number): string[] {
    const isFocused = this.editor.selectedRow === this.editor.rows.length + 1
    const prefix = isFocused ? '> ' : '  '
    const inputWidth = Math.max(0, width - prefix.length)
    const inputLines = this.editor.tokenThresholdInput.render(inputWidth)
    const [firstLine = ''] = inputLines
    return [
      '',
      this.editor.theme.bold(TOKEN_THRESHOLD_LABEL),
      `${prefix}${firstLine}`,
    ]
  }

  private renderModelSection(width: number): string[] {
    const tiers = ['low', 'medium', 'high'] as const
    const lines: string[] = []
    const selectList = this.editor.getSelectList()

    for (const [index, tier] of tiers.entries()) {
      const rowIndex = this.editor.rows.length + 2 + index
      const isFocused = this.editor.selectedRow === rowIndex
      const prefix = isFocused ? '> ' : '  '
      const label = TIER_LABELS[tier]
      const value = this.editor.subagentModels[tier] ?? '(none)'
      const displayValue = this.editor.modelDisplayNames.get(value) ?? value
      const labelWidth = prefix.length + label.length + 2
      const maxValueWidth = Math.max(0, width - labelWidth)
      lines.push(
        `${prefix}${label}: ${truncateToWidth(displayValue, maxValueWidth)}`,
      )

      if (selectList && isFocused) {
        const selectListLines = selectList.render(width)
        lines.push(...selectListLines)
      }
    }

    return ['', this.editor.theme.bold('Subagent Models'), ...lines]
  }

  private renderHelp(width: number): string[] {
    const helpText =
      '↑↓ navigate • ←→ columns • Space/Enter toggle • Del remove • Ctrl+S save • Esc cancel'
    return [truncateToWidth(this.editor.theme.fg('dim', helpText), width)]
  }
}
