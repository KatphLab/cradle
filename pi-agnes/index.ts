import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export default function piAgnesExtension(pi: ExtensionAPI) {
  pi.registerProvider('agnes', {
    name: 'Agnes AI',
    baseUrl: 'https://apihub.agnes-ai.com/v1',
    api: 'openai-completions',
    apiKey: '$AGNES_API_KEY',
    authHeader: true,
    models: [
      {
        id: 'agnes-2.0-flash',
        name: 'Agnes 2.0 Flash',
        reasoning: true,
        input: ['text', 'image'],
        contextWindow: 256_000,
        maxTokens: 65_536,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  })
}
