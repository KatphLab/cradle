import { describe, expect, it, vi } from 'vitest'

import { AskUserViewer } from './ask-user-viewer.js'

function createMockTheme() {
  return {
    fg: vi.fn((_: string, text: string): string => text),
    bold: vi.fn((text: string): string => text),
  }
}

describe('AskUserViewer', () => {
  it('renders a single question with options', () => {
    const theme = createMockTheme()
    const onClose = vi.fn()
    const viewer = new AskUserViewer(
      [
        {
          id: 'q1',
          question: 'Which?',
          options: [{ label: 'A', value: 'a' }],
        },
      ],
      undefined,
      theme,
      onClose,
    )

    const lines = viewer.render(80)

    expect(lines.some((l) => l.includes('q1'))).toBe(true)
    expect(lines.some((l) => l.includes('Which?'))).toBe(true)
    expect(lines.some((l) => l.includes('A'))).toBe(true)
  })

  it('renders multiple questions with tab bar', () => {
    const theme = createMockTheme()
    const onClose = vi.fn()
    const viewer = new AskUserViewer(
      [
        { id: 'q1', question: 'First?' },
        { id: 'q2', question: 'Second?' },
      ],
      undefined,
      theme,
      onClose,
    )

    const lines = viewer.render(80)

    expect(lines.some((l) => l.includes('q1'))).toBe(true)
    expect(lines.some((l) => l.includes('q2'))).toBe(true)
    expect(lines.some((l) => l.includes('First?'))).toBe(true)
    expect(lines.some((l) => l.includes('Second?'))).toBe(false)
  })

  it('shows preamble only on first tab', () => {
    const theme = createMockTheme()
    const onClose = vi.fn()
    const viewer = new AskUserViewer(
      [
        { id: 'q1', question: 'First?' },
        { id: 'q2', question: 'Second?' },
      ],
      'Context here',
      theme,
      onClose,
    )

    const linesTab0 = viewer.render(80)
    expect(linesTab0.some((l) => l.includes('Context here'))).toBe(true)

    viewer.handleInput('\u001B[C') // right
    const linesTab1 = viewer.render(80)
    expect(linesTab1.some((l) => l.includes('Context here'))).toBe(false)
  })

  it('navigates tabs with arrow keys', () => {
    const theme = createMockTheme()
    const onClose = vi.fn()
    const viewer = new AskUserViewer(
      [
        { id: 'q1', question: 'First?' },
        { id: 'q2', question: 'Second?' },
      ],
      undefined,
      theme,
      onClose,
    )

    const lines1 = viewer.render(80)
    expect(lines1.some((l) => l.includes('First?'))).toBe(true)

    viewer.handleInput('\u001B[C') // right
    const lines2 = viewer.render(80)
    expect(lines2.some((l) => l.includes('Second?'))).toBe(true)

    viewer.handleInput('\u001B[D') // left
    const lines3 = viewer.render(80)
    expect(lines3.some((l) => l.includes('First?'))).toBe(true)
  })

  it('calls onClose with escape', () => {
    const theme = createMockTheme()
    const onClose = vi.fn()
    const viewer = new AskUserViewer(
      [{ id: 'q1', question: 'Test?' }],
      undefined,
      theme,
      onClose,
    )

    viewer.handleInput('\u001B') // escape
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose with enter', () => {
    const theme = createMockTheme()
    const onClose = vi.fn()
    const viewer = new AskUserViewer(
      [{ id: 'q1', question: 'Test?' }],
      undefined,
      theme,
      onClose,
    )

    viewer.handleInput('\r') // enter
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not navigate past last tab', () => {
    const theme = createMockTheme()
    const onClose = vi.fn()
    const viewer = new AskUserViewer(
      [{ id: 'q1', question: 'Only?' }],
      undefined,
      theme,
      onClose,
    )

    viewer.handleInput('\u001B[C') // right
    const lines = viewer.render(80)
    expect(lines.some((l) => l.includes('Only?'))).toBe(true)
  })

  it('does not navigate before first tab', () => {
    const theme = createMockTheme()
    const onClose = vi.fn()
    const viewer = new AskUserViewer(
      [{ id: 'q1', question: 'Only?' }],
      undefined,
      theme,
      onClose,
    )

    viewer.handleInput('\u001B[D') // left
    const lines = viewer.render(80)
    expect(lines.some((l) => l.includes('Only?'))).toBe(true)
  })

  it('caches render output', () => {
    const theme = createMockTheme()
    const onClose = vi.fn()
    const viewer = new AskUserViewer(
      [{ id: 'q1', question: 'Test?' }],
      undefined,
      theme,
      onClose,
    )

    const lines1 = viewer.render(80)
    const lines2 = viewer.render(80)

    expect(lines1).toBe(lines2)
  })

  it('invalidates cache', () => {
    const theme = createMockTheme()
    const onClose = vi.fn()
    const viewer = new AskUserViewer(
      [{ id: 'q1', question: 'Test?' }],
      undefined,
      theme,
      onClose,
    )

    const lines1 = viewer.render(80)
    viewer.invalidate()
    const lines2 = viewer.render(80)

    expect(lines1).not.toBe(lines2)
  })
})
