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
import { CradleSettingsEditor } from './settings-editor.js'

interface SettingsSaveResult {
  permissions: { path: string; read: boolean; write: boolean; bash: boolean }[]
  reminderTokenThreshold: number
  subagentModels: { low?: string; medium?: string; high?: string }
  advisorModel: string | undefined
  firecrawlApiKey: string | undefined
}

function buildSaveNotification(result: SettingsSaveResult): string {
  const permissionCount = result.permissions.length
  const modelCount =
    [
      result.subagentModels.low,
      result.subagentModels.medium,
      result.subagentModels.high,
    ].filter(Boolean).length + (result.advisorModel ? 1 : 0)
  const apiKeyStatus = result.firecrawlApiKey ? ' configured' : ''
  return `Cradle settings saved: ${String(permissionCount)} permissions, ${String(modelCount)} models, reminder token threshold ${String(result.reminderTokenThreshold)}${apiKeyStatus}`
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

      const authStorage = AuthStorage.create(
        path.join(getAgentDir(), 'auth.json'),
      )
      const registry = ModelRegistry.create(
        authStorage,
        path.join(getAgentDir(), 'models.json'),
      )
      const models = registry.getAvailable()
      const availableModels = models.map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
      }))

      const result = await context.ui.custom<SettingsSaveResult | undefined>(
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
        subagentModels: result.subagentModels,
      }
      if (result.advisorModel !== undefined) {
        globalToSave.advisorModel = result.advisorModel
      }
      if (result.firecrawlApiKey !== undefined) {
        globalToSave.firecrawlApiKey = result.firecrawlApiKey
      }

      await Promise.all([
        saveProjectSettings(context.cwd, projectToSave),
        saveGlobalSettings(globalToSave),
      ])
      context.ui.notify(buildSaveNotification(result), 'info')
    },
  })
}
