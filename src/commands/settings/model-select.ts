import { SelectList, type SelectListTheme } from '@earendil-works/pi-tui'

import type { EditorTheme } from './constants.js'

export interface ModelOption {
  id: string
  name: string
  provider: string
}

export function getModelReference(model: ModelOption): string {
  return `${model.provider}/${model.id}`
}

export interface ModelSelectConfig {
  availableModels: readonly string[]
  modelDisplayNames: ReadonlyMap<string, string>
  theme: EditorTheme
  getCurrentValue: () => string | undefined
  assignValue: (value: string) => void
  onCancel: () => void
  onSelect: () => void
}

export function createSelectListTheme(theme: EditorTheme): SelectListTheme {
  return {
    selectedPrefix: (text) => theme.fg('accent', text),
    selectedText: (text) => theme.fg('accent', theme.bold(text)),
    description: (text) => theme.fg('dim', text),
    scrollInfo: (text) => theme.fg('dim', text),
    noMatch: (text) => theme.fg('warning', text),
  }
}

export function createModelSelectList(
  config: ModelSelectConfig,
): SelectList | undefined {
  const items = config.availableModels.map((id) => ({
    value: id,
    label: config.modelDisplayNames.get(id) ?? id,
  }))
  if (items.length === 0) return undefined

  const currentValue = config.getCurrentValue()
  const currentIndex = currentValue
    ? config.availableModels.indexOf(currentValue)
    : -1
  const selectList = new SelectList(
    items,
    Math.min(items.length, 8),
    createSelectListTheme(config.theme),
  )

  selectList.setSelectedIndex(Math.max(currentIndex, 0))
  selectList.onSelect = (item) => {
    config.assignValue(item.value)
    config.onSelect()
  }
  selectList.onCancel = config.onCancel
  return selectList
}
