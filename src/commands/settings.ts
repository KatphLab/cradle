import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import {
  loadCradleSettings,
  parseDirectoryList,
  saveCradleSettings,
} from '../config/settings.js'

/** @public */
export function registerSettingsCommand(
  pi: Pick<ExtensionAPI, 'registerCommand'>,
): void {
  pi.registerCommand('cradle-settings', {
    description: 'Configure Cradle extension settings',
    handler: async (_args, context) => {
      const settings = await loadCradleSettings(context.cwd)
      const currentDirectories =
        settings.read?.extraAllowedDirectories?.join('\n') ?? ''

      const editedDirectories = await context.ui.editor(
        'Extra read-access directories',
        currentDirectories,
      )

      if (editedDirectories === undefined) {
        context.ui.notify('Cradle settings unchanged', 'info')
        return
      }

      const extraAllowedDirectories = parseDirectoryList(editedDirectories)

      await saveCradleSettings(context.cwd, {
        ...settings,
        read: {
          ...settings.read,
          extraAllowedDirectories,
        },
      })

      context.ui.notify(
        `Cradle settings saved: ${extraAllowedDirectories.length} extra read directories`,
        'info',
      )
    },
  })
}
