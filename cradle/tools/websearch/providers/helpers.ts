type ErrorHandler = (response: Response) => Promise<never>

export async function fetchPostJson(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  handleError: ErrorHandler,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    ...(signal !== undefined && { signal }),
  })

  if (!response.ok) {
    await handleError(response)
  }

  return response.json()
}
