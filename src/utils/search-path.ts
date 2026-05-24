import path from 'node:path'

import { assertReadAllowed } from '../config/settings.js'
import { normalizePath } from './path.js'

export async function resolveSearchPath(
  parameters: { path?: string },
  context: { cwd: string },
): Promise<string> {
  const searchPath = parameters.path
    ? path.resolve(context.cwd, normalizePath(parameters.path))
    : context.cwd
  await assertReadAllowed(searchPath, context.cwd)
  return searchPath
}
