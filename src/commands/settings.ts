import {
  AuthStorage,
  ModelRegistry,
  getAgentDir,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent'
import path from 'node:path'

import { loadCradleSettings, saveCradleSettings } from '../config/settings.js'
import { CradleSettingsEditor } from './settings-editor.js'

/** @public */
export function registerSettingsCommand(
  pi: Pick<ExtensionAPI, 'registerCommand'>,
): void {
  pi.registerCommand('cradle-settings', {
    description: 'Configure Cradle settings',
    handler: async (_args, context) => {
      const settings = await loadCradleSettings(context.cwd)

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
      }))

      const result = await context.ui.custom<
        | {
            permissions: {
              path: string
              read: boolean
              write: boolean
              bash: boolean
            }[]
            reminderInterval: number
            subagentModels: {
              low?: string
              medium?: string
              high?: string
            }
          }
        | undefined
      >((tui, theme, _kb, done) => {
        const editor = new CradleSettingsEditor(
          settings,
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
      })

      if (result === undefined) {
        context.ui.notify('Cradle settings unchanged', 'info')
        return
      }

      await saveCradleSettings(context.cwd, {
        permissions: result.permissions,
        reminderInterval: result.reminderInterval,
        subagentModels: result.subagentModels,
      })

      const permissionCount = result.permissions.length
      const modelCount = [
        result.subagentModels.low,
        result.subagentModels.medium,
        result.subagentModels.high,
      ].filter(Boolean).length
      context.ui.notify(
        `Cradle settings saved: ${String(permissionCount)} permissions, ${String(modelCount)} models, reminder interval ${String(result.reminderInterval)} turns`,
        'info',
      )
    },
  })
}
