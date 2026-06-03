import { Input } from '@earendil-works/pi-tui'

import type { GlobalSettings } from '../../config/settings.js'

export type ApiKeySettingKey = 'firecrawlApiKey' | 'tavilyApiKey'
type ApiKeyInputKey = 'firecrawlApiKeyInput' | 'tavilyApiKeyInput'

export interface ApiKeyField {
  inputKey: ApiKeyInputKey
  label: string
  rowOffset: number
  settingKey: ApiKeySettingKey
}

export const API_KEY_FIELDS: readonly ApiKeyField[] = [
  {
    inputKey: 'firecrawlApiKeyInput',
    label: 'Firecrawl API Key',
    rowOffset: 6,
    settingKey: 'firecrawlApiKey',
  },
  {
    inputKey: 'tavilyApiKeyInput',
    label: 'Tavily API Key',
    rowOffset: 7,
    settingKey: 'tavilyApiKey',
  },
]

export const API_KEY_EXTRA_ROW_COUNT = API_KEY_FIELDS.length

export function createApiKeyInput(value: string | undefined): Input {
  const input = new Input()
  if (value) input.setValue(value)
  return input
}

export function getApiKeyValue(input: Input): string | undefined {
  const value = input.getValue().trim()
  return value.length > 0 ? value : undefined
}

export function getInitialApiKey(
  settings: GlobalSettings,
  key: ApiKeySettingKey,
): string | undefined {
  return settings[key]
}

export function isApiKeyChanged(
  input: Input,
  initialValue: string | undefined,
): boolean {
  return input.getValue().trim() !== (initialValue ?? '')
}
