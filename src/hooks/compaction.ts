import { compact, type ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { loadGlobalSettings } from '../config/settings.js'

function getModelRef(
  model: { provider: string; id: string } | undefined,
): string | undefined {
  if (model === undefined) return undefined

  return `${model.provider}/${model.id}`
}

/** @public */
export function registerCompactionHook(
  pi: Pick<ExtensionAPI, 'getThinkingLevel' | 'on'>,
): void {
  pi.on('session_before_compact', async (event, context) => {
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

    context.ui.notify(`Compacting with model: ${compactionModel.id}`, 'info')

    const compaction = await compact(
      event.preparation,
      compactionModel,
      auth.apiKey,
      auth.headers,
      event.customInstructions,
      event.signal,
      pi.getThinkingLevel(),
    )

    return { compaction }
  })
}
