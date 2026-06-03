import type { ThemeColor } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'

import {
  createModelSelectList,
  createSelectListTheme,
} from '../settings/model-select.js'

const mockTheme = {
  fg: (_color: ThemeColor, text: string) => text,
  bold: (text: string) => `**${text}**`,
}

function makeConfig(
  overrides: Partial<Parameters<typeof createModelSelectList>[0]> = {},
) {
  return {
    assignValue: vi.fn(),
    availableModels: ['test/a', 'test/b'],
    getCurrentValue: () => 'test/b',
    modelDisplayNames: new Map([
      ['test/a', 'test/a'],
      ['test/b', 'test/b'],
    ]),
    onCancel: vi.fn(),
    onSelect: vi.fn(),
    theme: mockTheme,
    ...overrides,
  }
}

describe('createSelectListTheme', () => {
  it('formats all select list text roles', () => {
    const theme = createSelectListTheme(mockTheme)

    expect(theme.selectedPrefix('>')).toBe('>')
    expect(theme.selectedText('item')).toBe('**item**')
    expect(theme.description('desc')).toBe('desc')
    expect(theme.scrollInfo('more')).toBe('more')
    expect(theme.noMatch('none')).toBe('none')
  })
})

describe('createModelSelectList', () => {
  it('returns undefined when no models are available', () => {
    const config = makeConfig({ availableModels: [] })

    expect(createModelSelectList(config)).toBeUndefined()
  })

  it('assigns selected model and invokes onSelect', () => {
    const config = makeConfig()
    const selectList = createModelSelectList(config)
    if (selectList === undefined) throw new Error('Expected select list')

    selectList.onSelect?.({ value: 'test/a', label: 'test/a' })

    expect(config.assignValue).toHaveBeenCalledWith('test/a')
    expect(config.onSelect).toHaveBeenCalledOnce()
    expect(config.onCancel).not.toHaveBeenCalled()
  })

  it('invokes onCancel without assigning a model', () => {
    const config = makeConfig()
    const selectList = createModelSelectList(config)
    if (selectList === undefined) throw new Error('Expected select list')

    selectList.onCancel?.()

    expect(config.assignValue).not.toHaveBeenCalled()
    expect(config.onCancel).toHaveBeenCalledOnce()
  })

  it('renders display labels and themed text', () => {
    const config = makeConfig({ getCurrentValue: () => void 0 })
    const selectList = createModelSelectList(config)
    if (selectList === undefined) throw new Error('Expected select list')

    const lines = selectList.render(80)

    expect(lines.join('\n')).toContain('test/a')
  })
})
