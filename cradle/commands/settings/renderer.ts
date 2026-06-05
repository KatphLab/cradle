import { truncateToWidth } from '@earendil-works/pi-tui'
import { API_KEY_FIELDS, maskApiKey } from './api-keys.js'
import {
  ADVISOR_MODEL_LABEL,
  COMPACTION_MODEL_LABEL,
  DISPLAY_SYSTEM_REMINDER_LABEL,
  GAP,
  PERMISSION_LABELS,
  SEARCH_API_KEYS_LABEL,
  TIER_LABELS,
  TOGGLE_WIDTH,
  TOKEN_THRESHOLD_LABEL,
  type EditorState,
} from './constants.js'
import { formatDirectoryPath } from './utilities.js'

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
      ...this.renderAdvisorModelSection(width),
      ...this.renderCompactionModelSection(width),
      ...this.renderApiKeySections(width),
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
    const toggleFocused =
      this.editor.selectedRow === this.editor.rows.length + 2
    const prefix = isFocused ? '> ' : '  '
    const togglePrefix = toggleFocused ? '> ' : '  '
    const inputWidth = Math.max(0, width - prefix.length)
    const inputLines = this.editor.tokenThresholdInput.render(inputWidth)
    const [firstLine = ''] = inputLines
    return [
      '',
      this.editor.theme.bold(TOKEN_THRESHOLD_LABEL),
      `${prefix}${firstLine}`,
      `${togglePrefix}${DISPLAY_SYSTEM_REMINDER_LABEL}: ${this.renderToggle(
        this.editor.displaySystemReminder,
        toggleFocused,
      )}`,
    ]
  }

  private renderModelSection(width: number): string[] {
    const tiers = ['low', 'medium', 'high'] as const
    const lines: string[] = []
    const selectList = this.editor.getSelectList()

    for (const [index, tier] of tiers.entries()) {
      const rowIndex = this.editor.rows.length + 3 + index
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

  private renderAdvisorModelSection(width: number): string[] {
    return this.renderModelSelectionSection(
      width,
      this.editor.rows.length + 6,
      this.editor.advisorModel,
      ADVISOR_MODEL_LABEL,
      'Advisor',
    )
  }

  private renderCompactionModelSection(width: number): string[] {
    return this.renderModelSelectionSection(
      width,
      this.editor.rows.length + 7,
      this.editor.compactionModel,
      COMPACTION_MODEL_LABEL,
      'Compaction',
    )
  }

  private renderModelSelectionSection(
    width: number,
    rowIndex: number,
    modelValue: string | null | undefined,
    label: string,
    title: string,
  ): string[] {
    const isFocused = this.editor.selectedRow === rowIndex
    const prefix = isFocused ? '> ' : '  '
    const value = modelValue ?? '(none)'
    const displayValue = this.editor.modelDisplayNames.get(value) ?? value
    const labelWidth = prefix.length + label.length + 2
    const maxValueWidth = Math.max(0, width - labelWidth)
    const selectList = this.editor.getSelectList()

    const lines = [
      `${prefix}${label}: ${truncateToWidth(displayValue, maxValueWidth)}`,
    ]

    if (selectList && isFocused) {
      const selectListLines = selectList.render(width)
      lines.push(...selectListLines)
    }

    return ['', this.editor.theme.bold(title), ...lines]
  }

  private renderHelp(width: number): string[] {
    const helpText =
      '↑↓ navigate • ←→ columns • Space/Enter toggle • Del remove • Ctrl+S save • Esc cancel'
    return [truncateToWidth(this.editor.theme.fg('dim', helpText), width)]
  }

  private renderApiKeySections(width: number): string[] {
    const lines: string[] = ['', this.editor.theme.bold(SEARCH_API_KEYS_LABEL)]

    for (const field of API_KEY_FIELDS) {
      const isFocused =
        this.editor.selectedRow === this.editor.rows.length + field.rowOffset
      const prefix = isFocused ? '> ' : '  '
      const input = this.editor[field.inputKey]
      const currentValue = input.getValue()
      const savedKey = this.editor[field.settingKey]

      const isChanged = currentValue.trim() !== (savedKey ?? '')
      let displayValue: string
      if (isChanged && currentValue.length > 0) {
        displayValue = currentValue
      } else {
        const keyToMask = currentValue.length > 0 ? currentValue : savedKey
        displayValue = maskApiKey(keyToMask)
      }

      const label = `${field.label}: `
      const labelWidth = prefix.length + label.length
      const maxValueWidth = Math.max(0, width - labelWidth)
      const truncatedValue = truncateToWidth(displayValue, maxValueWidth)
      lines.push(`${prefix}${label}${truncatedValue}`)
    }

    return lines
  }
}
