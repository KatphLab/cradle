import path from 'node:path'
import { isApiKeyChanged } from './api-keys.js'
import { PERMISSION_COLUMNS } from './constants.js'
import type { EditorLike } from './types.js'
import { scanDirectorySuggestions } from './utilities.js'

export function isDirty(editor: EditorLike): boolean {
  const tokenThresholdChanged =
    editor.tokenThresholdInput.getValue() !==
    String(editor.initialTokenThreshold)
  const modelsChanged =
    editor.subagentModels.low !== editor.initialSubagentModels.low ||
    editor.subagentModels.medium !== editor.initialSubagentModels.medium ||
    editor.subagentModels.high !== editor.initialSubagentModels.high
  const advisorChanged = editor.advisorModel !== editor.initialAdvisorModel
  const firecrawlKeyChanged = isApiKeyChanged(
    editor.firecrawlApiKeyInput,
    editor.initialFirecrawlApiKey,
  )
  const tavilyKeyChanged = isApiKeyChanged(
    editor.tavilyApiKeyInput,
    editor.initialTavilyApiKey,
  )
  const exaKeyChanged = isApiKeyChanged(
    editor.exaApiKeyInput,
    editor.initialExaApiKey,
  )
  return (
    editor.dirty ||
    tokenThresholdChanged ||
    modelsChanged ||
    advisorChanged ||
    firecrawlKeyChanged ||
    tavilyKeyChanged ||
    exaKeyChanged
  )
}

export function addCurrentInput(editor: EditorLike): void {
  const value = editor.dirInput.getValue().trim()
  if (!value) return

  const resolved = path.resolve(editor.cwd, value)
  if (!editor.rows.some((row) => row.path === resolved)) {
    editor.rows.push({
      path: resolved,
      read: true,
      write: false,
      bash: false,
    })
    editor.dirty = true
    editor.selectedRow = editor.rows.length - 1
    editor.selectedCol = 1
  }
  editor.dirInput.setValue('')
  editor.suggestions = []
  editor.lastInputValue = ''
}

export function deleteRow(editor: EditorLike, index: number): void {
  if (index >= 0 && index < editor.rows.length) {
    editor.rows.splice(index, 1)
    editor.dirty = true
    if (editor.selectedRow >= editor.rows.length) {
      editor.selectedRow = editor.rows.length
      editor.selectedCol = 0
    }
  }
}

export function togglePermission(
  editor: EditorLike,
  rowIndex: number,
  colIndex: number,
): void {
  const key = PERMISSION_COLUMNS[colIndex - 1]
  if (key === undefined) return
  const row = editor.rows[rowIndex]
  if (row === undefined) return
  row[key] = !row[key]
  editor.dirty = true
}

export async function updateSuggestions(editor: EditorLike): Promise<void> {
  const value = editor.dirInput.getValue().trim()
  if (value === editor.lastInputValue) return
  editor.lastInputValue = value

  editor.suggestions = await scanDirectorySuggestions(value, editor.cwd)
  editor.suggestionIndex = editor.suggestions.length > 0 ? 0 : -1
  editor.tuiRequestRender?.()
}
