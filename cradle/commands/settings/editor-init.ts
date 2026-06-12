import {
  DEFAULT_REMINDER_TOKEN_THRESHOLD,
  DEFAULT_TOOL_OUTPUT_MODE,
  type GlobalSettings,
  type SubagentModels,
  type ToolOutputMode,
} from '../../config/settings.js'
import { getInitialApiKey } from './api-keys.js'

export function initFromGlobal(globalSettings: GlobalSettings): {
  tokenThreshold: number
  displaySystemReminder: boolean
  toolOutputMode: ToolOutputMode
  subagentModels: SubagentModels
  initialSubagentModels: SubagentModels
  advisorModel: string | undefined
  initialDisplaySystemReminder: boolean
  initialToolOutputMode: ToolOutputMode
  initialAdvisorModel: string | undefined
  compactionModel: string | undefined
  initialCompactionModel: string | undefined
  firecrawlApiKey: string | undefined
  initialFirecrawlApiKey: string | undefined
  tavilyApiKey: string | undefined
  initialTavilyApiKey: string | undefined
  exaApiKey: string | undefined
  initialExaApiKey: string | undefined
  jinaApiKey: string | undefined
  initialJinaApiKey: string | undefined
} {
  const tokenThreshold =
    globalSettings.reminderTokenThreshold ?? DEFAULT_REMINDER_TOKEN_THRESHOLD
  const displaySystemReminder = globalSettings.displaySystemReminder ?? true
  const toolOutputMode =
    globalSettings.toolOutputMode ?? DEFAULT_TOOL_OUTPUT_MODE

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
    displaySystemReminder,
    toolOutputMode,
    subagentModels,
    initialSubagentModels: { ...subagentModels },
    initialDisplaySystemReminder: displaySystemReminder,
    initialToolOutputMode: toolOutputMode,
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
    jinaApiKey: getInitialApiKey(globalSettings, 'jinaApiKey'),
    initialJinaApiKey: getInitialApiKey(globalSettings, 'jinaApiKey'),
  }
}
