import {
  AuthStorage,
  ModelRegistry,
  getAgentDir,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent'
import path from 'node:path'

import {
  loadGlobalSettings,
  loadProjectSettings,
  saveGlobalSettings,
  saveProjectSettings,
  type GlobalSettings,
  type ProjectSettings,
} from '../config/settings.js'
import { CradleSettingsEditor } from './settings/editor.js'
import type { ModelOption } from './settings/model-select.js'
import type { CradleSettingsResult } from './settings/types.js'

function getAvailableModelOptions(): ModelOption[] {
  const authStorage = AuthStorage.create(path.join(getAgentDir(), 'auth.json'))
  const registry = ModelRegistry.create(
    authStorage,
    path.join(getAgentDir(), 'models.json'),
  )
  return registry.getAvailable().map((model) => ({
    id: model.id,
    name: model.name,
    provider: model.provider,
  }))
}

function buildSaveNotification(result: CradleSettingsResult): string {
  const permissionCount = result.permissions.length
  const modelCount =
    [
      result.subagentModels.low,
      result.subagentModels.medium,
      result.subagentModels.high,
    ].filter(Boolean).length +
    (result.advisorModel ? 1 : 0) +
    (result.compactionModel ? 1 : 0)
  const firecrawlStatus = result.firecrawlApiKey ? ' firecrawl' : ''
  const tavilyStatus = result.tavilyApiKey ? ' tavily' : ''
  const exaStatus = result.exaApiKey ? ' exa' : ''
  return `Cradle settings saved: ${String(permissionCount)} permissions, ${String(modelCount)} models, reminder token threshold ${String(result.reminderTokenThreshold)}${firecrawlStatus}${tavilyStatus}${exaStatus}`
}

/** @public */
export function registerSettingsCommand(
  pi: Pick<ExtensionAPI, 'registerCommand'>,
): void {
  pi.registerCommand('cradle-settings', {
    description: 'Configure Cradle settings',
    handler: async (_args, context) => {
      const [projectSettings, globalSettings] = await Promise.all([
        loadProjectSettings(context.cwd),
        loadGlobalSettings(),
      ])

      const availableModels = getAvailableModelOptions()

      const result = await context.ui.custom<CradleSettingsResult | undefined>(
        (tui, theme, _kb, done) => {
          const editor = new CradleSettingsEditor(
            projectSettings,
            globalSettings,
            context.cwd,
            theme,
            availableModels,
          )
          editor.tuiRequestRender = () => {
            tui.requestRender()
          }

          editor.onSave = (value) => {
            done(value)
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

      const projectToSave: ProjectSettings = {
        permissions: result.permissions,
      }

      const globalToSave: GlobalSettings = {
        reminderTokenThreshold: result.reminderTokenThreshold,
        displaySystemReminder: result.displaySystemReminder,
        toolOutputMode: result.toolOutputMode,
        subagentModels: result.subagentModels,
      }
      if (result.advisorModel !== undefined) {
        globalToSave.advisorModel = result.advisorModel
      }
      if (result.compactionModel !== undefined) {
        globalToSave.compactionModel = result.compactionModel
      }
      if (result.firecrawlApiKey !== undefined) {
        globalToSave.firecrawlApiKey = result.firecrawlApiKey
      }
      if (result.tavilyApiKey !== undefined) {
        globalToSave.tavilyApiKey = result.tavilyApiKey
      }
      if (result.exaApiKey !== undefined) {
        globalToSave.exaApiKey = result.exaApiKey
      }

      await Promise.all([
        saveProjectSettings(context.cwd, projectToSave),
        saveGlobalSettings(globalToSave),
      ])
      context.ui.notify(buildSaveNotification(result), 'info')
    },
  })
}
