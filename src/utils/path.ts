/** Strip leading `@` from model-generated paths. */
export function normalizePath(inputPath: string): string {
  return inputPath.replace(/^@/, '')
}
