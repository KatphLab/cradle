import { Input } from '@earendil-works/pi-tui'

import type { GlobalSettings } from '../../config/settings.js'

export type ApiKeySettingKey =
  | 'firecrawlApiKey'
  | 'tavilyApiKey'
  | 'exaApiKey'
  | 'jinaApiKey'
type ApiKeyInputKey =
  | 'firecrawlApiKeyInput'
  | 'tavilyApiKeyInput'
  | 'exaApiKeyInput'
  | 'jinaApiKeyInput'

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
    rowOffset: 7,
    settingKey: 'firecrawlApiKey',
  },
  {
    inputKey: 'tavilyApiKeyInput',
    label: 'Tavily API Key',
    rowOffset: 8,
    settingKey: 'tavilyApiKey',
  },
  {
    inputKey: 'exaApiKeyInput',
    label: 'Exa API Key',
    rowOffset: 9,
    settingKey: 'exaApiKey',
  },
  {
    inputKey: 'jinaApiKeyInput',
    label: 'Jina API Key',
    rowOffset: 10,
    settingKey: 'jinaApiKey',
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

export function maskApiKey(value: string | undefined): string {
  if (!value || value.length <= 6) return value ?? ''
  return `${value.slice(0, 3)}${'•'.repeat(value.length - 6)}${value.slice(-3)}`
}
