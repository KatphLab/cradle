import { isRecord } from './helpers.js'

export function validateExaResults(body: unknown): Record<string, unknown>[] {
  if (
    !isRecord(body) ||
    !('results' in body) ||
    !Array.isArray(body['results'])
  ) {
    throw new Error('Exa API returned unexpected response')
  }
  return body['results'].filter(isRecord)
}

export async function handleExaError(response: Response): Promise<never> {
  const errorText = await response
    .text()
    .catch(() => 'Failed to read error response')
  throw new Error(`Exa API error (${response.status}): ${errorText}`)
}
