import type { ThemeColor } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import { Key, matchesKey, truncateToWidth } from '@earendil-works/pi-tui'

import type { AskUserQuestion } from '../tools/ask-user.js'

interface AskUserViewerTheme {
  fg: (color: ThemeColor, text: string) => string
  bold: (text: string) => string
}

export class AskUserViewer implements Component {
  private readonly questions: AskUserQuestion[]
  private readonly preamble: string | undefined
  private readonly theme: AskUserViewerTheme
  private readonly onClose: () => void
  private readonly onInput: (() => void) | undefined
  private activeTab = 0
  private cachedWidth: number | undefined
  private cachedLines: string[] | undefined

  constructor(
    questions: AskUserQuestion[],
    preamble: string | undefined,
    theme: AskUserViewerTheme,
    onClose: () => void,
    onInput?: () => void,
  ) {
    this.questions = questions
    this.preamble = preamble
    this.theme = theme
    this.onClose = onClose
    this.onInput = onInput
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.left)) {
      if (this.activeTab > 0) {
        this.activeTab--
        this.invalidate()
      }
    } else if (matchesKey(data, Key.right)) {
      if (this.activeTab < this.questions.length - 1) {
        this.activeTab++
        this.invalidate()
      }
    } else if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) {
      this.onClose()
    }

    this.onInput?.()
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines
    }

    const lines = [
      this.renderBorder(width),
      this.renderTabBar(width),
      ...this.renderPreamble(width),
      ...this.renderQuestion(width),
      '',
      this.renderHelp(width),
      this.renderBorder(width),
    ]

    this.cachedWidth = width
    this.cachedLines = lines
    return lines
  }

  private renderBorder(width: number): string {
    return this.theme.fg('accent', '─'.repeat(width))
  }

  private renderTabBar(width: number): string {
    const tabs = this.questions.map((question, index) => {
      const isActive = index === this.activeTab
      const text = ` ${question.id} `
      return isActive
        ? this.theme.fg('accent', this.theme.bold(text))
        : this.theme.fg('muted', text)
    })
    const separator = this.theme.fg('muted', ' │ ')
    return truncateToWidth(tabs.join(separator), width)
  }

  private renderPreamble(width: number): string[] {
    if (!this.preamble || this.activeTab !== 0) {
      return []
    }

    return [
      '',
      ...this.preamble
        .split('\n')
        .map((line) =>
          truncateToWidth(this.theme.fg('muted', ` ${line}`), width),
        ),
    ]
  }

  private renderQuestion(width: number): string[] {
    const question = this.questions[this.activeTab]
    if (!question) {
      return []
    }

    const lines: string[] = [
      '',
      truncateToWidth(this.theme.fg('text', ` ${question.question}`), width),
    ]

    if (question.options && question.options.length > 0) {
      const optionLines = question.options.map((option) => {
        const bullet = `• ${option.label}`
        return truncateToWidth(`  ${this.theme.fg('dim', bullet)}`, width)
      })
      lines.push('', ...optionLines)
    }

    return lines
  }

  private renderHelp(width: number): string {
    return truncateToWidth(
      this.theme.fg('dim', ' ←→ navigate tabs • Esc/Enter dismiss'),
      width,
    )
  }

  invalidate(): void {
    this.cachedWidth = undefined
    this.cachedLines = undefined
  }
}
