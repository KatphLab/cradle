import path from 'node:path'

import { assertPermission } from '../config/settings.js'

/** Strip leading `@` from model-generated paths. */
export function normalizePath(inputPath: string): string {
  return inputPath.replace(/^@/, '')
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export async function resolveSearchPath(
  parameters: { path?: string },
  context: { cwd: string },
): Promise<string> {
  const searchPath = parameters.path
    ? path.resolve(context.cwd, normalizePath(parameters.path))
    : context.cwd
  await assertPermission(searchPath, context.cwd, 'read')
  return searchPath
}

export interface ThemeLike {
  fg(color: string, text: string): string
  bold(text: string): string
}
