import { isRecord } from './type-guards.js'

export function validateFirecrawlSuccess(
  body: unknown,
): Record<string, unknown> {
  if (
    !isRecord(body) ||
    !('success' in body) ||
    !body['success'] ||
    !('data' in body) ||
    !isRecord(body['data'])
  ) {
    throw new Error('Firecrawl API returned unsuccessful response')
  }
  return body['data']
}

export async function handleFirecrawlError(response: Response): Promise<never> {
  const errorText = await response
    .text()
    .catch(() => 'Failed to read error response')
  throw new Error(`Firecrawl API error (${response.status}): ${errorText}`)
}
