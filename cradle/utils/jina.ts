export async function handleJinaError(response: Response): Promise<never> {
  const errorText = await response
    .text()
    .catch(() => 'Failed to read error response')
  throw new Error(`Jina API error (${response.status}): ${errorText}`)
}
