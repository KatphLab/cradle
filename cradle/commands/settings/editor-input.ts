import { Key, matchesKey } from '@earendil-works/pi-tui'

import {
  MAX_REMINDER_TOKEN_THRESHOLD,
  MIN_REMINDER_TOKEN_THRESHOLD,
} from '../../config/settings.js'
import { API_KEY_EXTRA_ROW_COUNT, API_KEY_FIELDS } from './api-keys.js'
import {
  addCurrentInput,
  deleteRow,
  togglePermission,
  updateSuggestions,
} from './editor-state.js'
import { createModelSelectList } from './model-select.js'
import type { EditorLike } from './types.js'
import { formatDirectoryPath } from './utilities.js'

function tryHandleSave(editor: EditorLike, data: string): boolean {
  if (matchesKey(data, Key.ctrl('s'))) {
    const clampedTokenThreshold = Math.max(
      MIN_REMINDER_TOKEN_THRESHOLD,
      Math.min(
        MAX_REMINDER_TOKEN_THRESHOLD,
        editor.getReminderTokenThreshold(),
      ),
    )
    editor.onSave?.({
      permissions: editor.getRows(),
      reminderTokenThreshold: clampedTokenThreshold,
      displaySystemReminder: editor.getDisplaySystemReminder(),
      subagentModels: editor.getSubagentModels(),
      advisorModel: editor.advisorModel,
      compactionModel: editor.compactionModel,
      firecrawlApiKey: editor.getFirecrawlApiKey(),
      tavilyApiKey: editor.getTavilyApiKey(),
      exaApiKey: editor.getExaApiKey(),
      jinaApiKey: editor.getJinaApiKey(),
    })
    return true
  }
  return false
}

function tryHandleSuggestions(editor: EditorLike, data: string): boolean {
  if (editor.suggestions.length === 0) return false
  return (
    tryHandleSuggestionNavigation(editor, data) ||
    tryHandleSuggestionAccept(editor, data) ||
    tryHandleSuggestionDismiss(editor, data)
  )
}

function tryHandleSuggestionNavigation(
  editor: EditorLike,
  data: string,
): boolean {
  if (matchesKey(data, Key.down)) {
    editor.suggestionIndex = Math.min(
      editor.suggestionIndex + 1,
      editor.suggestions.length - 1,
    )
    editor.tuiRequestRender?.()
    return true
  }
  if (matchesKey(data, Key.up)) {
    editor.suggestionIndex = Math.max(editor.suggestionIndex - 1, 0)
    editor.tuiRequestRender?.()
    return true
  }
  return false
}

function tryHandleSuggestionAccept(editor: EditorLike, data: string): boolean {
  if (
    !(
      (matchesKey(data, Key.enter) || matchesKey(data, Key.tab)) &&
      editor.suggestionIndex >= 0
    )
  ) {
    return false
  }
  const suggestion = editor.suggestions[editor.suggestionIndex]
  if (suggestion !== undefined) {
    editor.dirInput.setValue(formatDirectoryPath(suggestion, editor.cwd))
    editor.dirInput.handleInput('\u0005')
    editor.suggestions = []
    editor.lastInputValue = editor.dirInput.getValue()
    if (matchesKey(data, Key.enter)) {
      addCurrentInput(editor)
    }
    editor.tuiRequestRender?.()
  }
  return true
}

function tryHandleSuggestionDismiss(editor: EditorLike, data: string): boolean {
  if (matchesKey(data, Key.escape)) {
    editor.suggestions = []
    editor.tuiRequestRender?.()
    return true
  }
  return false
}

function tryHandleDelete(editor: EditorLike, data: string): boolean {
  if (matchesKey(data, Key.delete) && editor.selectedRow < editor.rows.length) {
    deleteRow(editor, editor.selectedRow)
    editor.tuiRequestRender?.()
    return true
  }
  return false
}

function tryHandleNavigation(editor: EditorLike, data: string): boolean {
  if (matchesKey(data, Key.down)) {
    return moveDown(editor)
  }
  if (matchesKey(data, Key.up)) {
    return moveUp(editor)
  }
  if (editor.selectedRow < editor.rows.length) {
    return moveHorizontal(editor, data)
  }
  return false
}

function moveDown(editor: EditorLike): boolean {
  const maxRow = editor.rows.length + 7 + API_KEY_EXTRA_ROW_COUNT
  if (editor.selectedRow < maxRow) {
    editor.selectedRow++
    const isNowOnDataRow = editor.selectedRow < editor.rows.length
    const isNowOnDirectoryInput = editor.selectedRow === editor.rows.length
    editor.selectedCol = isNowOnDataRow ? Math.max(1, editor.selectedCol) : 0
    if (isNowOnDirectoryInput) {
      editor.suggestions = []
      editor.suggestionIndex = -1
    }
  }
  editor.tuiRequestRender?.()
  return true
}

function moveUp(editor: EditorLike): boolean {
  if (editor.selectedRow > 0) {
    editor.selectedRow--
  }
  editor.tuiRequestRender?.()
  return true
}

function moveHorizontal(editor: EditorLike, data: string): boolean {
  if (matchesKey(data, Key.right)) {
    editor.selectedCol = Math.min(editor.selectedCol + 1, 3)
    editor.tuiRequestRender?.()
    return true
  }
  if (matchesKey(data, Key.left)) {
    editor.selectedCol = Math.max(editor.selectedCol - 1, 1)
    editor.tuiRequestRender?.()
    return true
  }
  return false
}

function tryHandleCancel(editor: EditorLike, data: string): boolean {
  if (matchesKey(data, Key.escape)) {
    editor.onCancel?.()
    return true
  }
  return false
}

function tryHandleToggle(editor: EditorLike, data: string): boolean {
  if (!matchesKey(data, Key.space) && !matchesKey(data, Key.enter)) {
    return false
  }
  if (
    editor.selectedRow < editor.rows.length &&
    editor.selectedCol >= 1 &&
    editor.selectedCol <= 3
  ) {
    togglePermission(editor, editor.selectedRow, editor.selectedCol)
    editor.tuiRequestRender?.()
    return true
  }
  if (editor.selectedRow === editor.rows.length + 2) {
    editor.displaySystemReminder = !editor.displaySystemReminder
    editor.dirty = true
    editor.tuiRequestRender?.()
    return true
  }
  return tryHandleModelToggle(editor)
}

function tryHandleModelToggle(editor: EditorLike): boolean {
  const relativeRow = editor.selectedRow - (editor.rows.length + 3)
  if (relativeRow >= 0 && relativeRow <= 2) {
    openModelSelect(editor, getTierFromRow(editor, editor.selectedRow))
    editor.tuiRequestRender?.()
    return true
  }
  if (relativeRow === 3) {
    openAdvisorModelSelect(editor)
    editor.tuiRequestRender?.()
    return true
  }
  if (relativeRow === 4) {
    openCompactionModelSelect(editor)
    editor.tuiRequestRender?.()
    return true
  }
  return false
}

function getTierFromRow(
  editor: EditorLike,
  rowIndex: number,
): 'low' | 'medium' | 'high' {
  const offset = rowIndex - (editor.rows.length + 3)
  const tiers = ['low', 'medium', 'high'] as const
  return tiers[offset] ?? 'low'
}

function openModelSelect(
  editor: EditorLike,
  tier: 'low' | 'medium' | 'high',
): void {
  openSelectList(
    editor,
    () => editor.subagentModels[tier],
    (value: string) => {
      editor.subagentModels[tier] = value
    },
  )
}

function openAdvisorModelSelect(editor: EditorLike): void {
  openSelectList(
    editor,
    () => editor.advisorModel,
    (value: string) => {
      editor.advisorModel = value
    },
  )
}

function openCompactionModelSelect(editor: EditorLike): void {
  openSelectList(
    editor,
    () => editor.compactionModel,
    (value: string) => {
      editor.compactionModel = value
    },
  )
}

function openSelectList(
  editor: EditorLike,
  getCurrentValue: () => string | undefined,
  assignValue: (value: string) => void,
): void {
  editor.selectList = createModelSelectList({
    assignValue,
    availableModels: editor.availableModels,
    getCurrentValue,
    modelDisplayNames: editor.modelDisplayNames,
    onCancel: () => {
      editor.selectList = undefined
      editor.tuiRequestRender?.()
    },
    onSelect: () => {
      editor.dirty = true
      editor.selectList = undefined
      editor.tuiRequestRender?.()
    },
    theme: editor.theme,
  })
}

function tryHandleToInput(editor: EditorLike, data: string): boolean {
  if (editor.selectedRow === editor.rows.length) {
    editor.dirInput.handleInput(data)
    void updateSuggestions(editor)
    editor.tuiRequestRender?.()
    return true
  }
  if (editor.selectedRow === editor.rows.length + 1) {
    editor.tokenThresholdInput.handleInput(data)
    editor.tuiRequestRender?.()
    return true
  }
  for (const field of API_KEY_FIELDS) {
    if (editor.selectedRow !== editor.rows.length + field.rowOffset) continue
    editor[field.inputKey].handleInput(data)
    editor.tuiRequestRender?.()
    return true
  }
  return false
}

export function handleInput(editor: EditorLike, data: string): void {
  if (tryHandleSave(editor, data)) return
  if (editor.selectList) {
    editor.selectList.handleInput(data)
    editor.tuiRequestRender?.()
    return
  }
  if (tryHandleSuggestions(editor, data)) return
  if (tryHandleDelete(editor, data)) return
  if (tryHandleNavigation(editor, data)) return
  if (tryHandleCancel(editor, data)) return
  if (tryHandleToggle(editor, data)) return
  tryHandleToInput(editor, data)
}
