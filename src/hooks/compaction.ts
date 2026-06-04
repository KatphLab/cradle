import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { loadGlobalSettings } from '../config/settings.js'

function getModelRef(
  model: { provider: string; id: string } | undefined,
): string | undefined {
  if (model === undefined) return undefined

  return `${model.provider}/${model.id}`
}

/** @public */
export function registerCompactionHook(
  pi: Pick<ExtensionAPI, 'on' | 'setModel'>,
): void {
  let previousModelRef: string | undefined

  pi.on('session_before_compact', async (_event, context) => {
    const settings = await loadGlobalSettings()
    const targetModelRaw = settings.compactionModel
    if (targetModelRaw === undefined) return

    const currentModelRef = getModelRef(context.model)
    if (currentModelRef === targetModelRaw) return

    if (!targetModelRaw.includes('/')) {
      context.ui.notify(
        `Invalid compaction model format: ${targetModelRaw}`,
        'warning',
      )
      return
    }

    const separatorIndex = targetModelRaw.indexOf('/')
    const compactionModel = context.modelRegistry.find(
      targetModelRaw.slice(0, separatorIndex),
      targetModelRaw.slice(separatorIndex + 1),
    )
    if (compactionModel === undefined) {
      context.ui.notify(
        `Compaction model not found: ${targetModelRaw}`,
        'warning',
      )
      return
    }

    const auth =
      await context.modelRegistry.getApiKeyAndHeaders(compactionModel)
    if (!auth.ok || !auth.apiKey) {
      context.ui.notify(
        `No API key for compaction model ${targetModelRaw}`,
        'warning',
      )
      return
    }

    previousModelRef = getModelRef(context.model)
    const success = await pi.setModel(compactionModel)
    if (!success) {
      context.ui.notify('Failed to switch to compaction model', 'warning')
      previousModelRef = undefined
    }
  })

  pi.on('session_compact', async (_event, context) => {
    if (previousModelRef === undefined) return

    const separatorIndex = previousModelRef.indexOf('/')
    const model = context.modelRegistry.find(
      previousModelRef.slice(0, separatorIndex),
      previousModelRef.slice(separatorIndex + 1),
    )
    if (model === undefined) return

    await pi.setModel(model)
    previousModelRef = undefined
  })
}
