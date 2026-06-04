import {
  DEFAULT_REMINDER_TOKEN_THRESHOLD,
  type GlobalSettings,
  type SubagentModels,
} from '../../config/settings.js'
import { getInitialApiKey } from './api-keys.js'

export function initFromGlobal(globalSettings: GlobalSettings): {
  tokenThreshold: number
  subagentModels: SubagentModels
  initialSubagentModels: SubagentModels
  advisorModel: string | undefined
  initialAdvisorModel: string | undefined
  compactionModel: string | undefined
  initialCompactionModel: string | undefined
  firecrawlApiKey: string | undefined
  initialFirecrawlApiKey: string | undefined
  tavilyApiKey: string | undefined
  initialTavilyApiKey: string | undefined
  exaApiKey: string | undefined
  initialExaApiKey: string | undefined
} {
  const tokenThreshold =
    globalSettings.reminderTokenThreshold ?? DEFAULT_REMINDER_TOKEN_THRESHOLD

  const subagentModels: SubagentModels = {}
  if (globalSettings.subagentModels?.low !== undefined) {
    subagentModels.low = globalSettings.subagentModels.low
  }
  if (globalSettings.subagentModels?.medium !== undefined) {
    subagentModels.medium = globalSettings.subagentModels.medium
  }
  if (globalSettings.subagentModels?.high !== undefined) {
    subagentModels.high = globalSettings.subagentModels.high
  }

  return {
    tokenThreshold,
    subagentModels,
    initialSubagentModels: { ...subagentModels },
    advisorModel: globalSettings.advisorModel,
    initialAdvisorModel: globalSettings.advisorModel,
    compactionModel: globalSettings.compactionModel,
    initialCompactionModel: globalSettings.compactionModel,
    firecrawlApiKey: getInitialApiKey(globalSettings, 'firecrawlApiKey'),
    initialFirecrawlApiKey: getInitialApiKey(globalSettings, 'firecrawlApiKey'),
    tavilyApiKey: getInitialApiKey(globalSettings, 'tavilyApiKey'),
    initialTavilyApiKey: getInitialApiKey(globalSettings, 'tavilyApiKey'),
    exaApiKey: getInitialApiKey(globalSettings, 'exaApiKey'),
    initialExaApiKey: getInitialApiKey(globalSettings, 'exaApiKey'),
  }
}
