const REDIRECT_TARGET_ALLOWLIST = new Set([
  '/dev/null',
  '/dev/stdout',
  '/dev/stderr',
  '&1',
  '&2',
])

const REDIRECT_RE = /(?:^|\s)(?:\d?>|>>)\s*("[^"]+"|'[^']+'|\S+)/gu
const DD_RE = /(?:^|\s)of=("[^"]+"|'[^']+'|\S+)/gu
const INLINE_INTERPRETER_RE = /\b(?:python3?|node|ruby)\b/u
const INLINE_FLAG_RE = /\s(?:-c|-e)\s/u
const INLINE_WRITE_RE_LIST = [
  /\bopen\s*\(/u,
  /\.write_(?:text|bytes)\s*\(/u,
  /\bwriteFile(?:Sync)?\s*\(/u,
  /File\.write\s*\(/u,
]

export interface BashFileWriteDetection {
  paths: string[]
  reasons: string[]
  hasUnknownTarget: boolean
}

function stripQuotes(value: string): string {
  if (value.length < 2) return value
  const first = value[0]
  const last = value.at(-1)
  if ((first === '"' || first === "'") && first === last)
    return value.slice(1, -1)
  return value
}

function isIgnoredTarget(target: string): boolean {
  return target.length === 0 || REDIRECT_TARGET_ALLOWLIST.has(target)
}

function addPath(paths: Set<string>, target: string): void {
  const path = stripQuotes(target)
  if (!isIgnoredTarget(path)) paths.add(path)
}

function addReason(reasons: Set<string>, reason: string): void {
  reasons.add(reason)
}

function collectRegexTargets(
  command: string,
  regex: RegExp,
  paths: Set<string>,
): number {
  let count = 0
  for (const match of command.matchAll(regex)) {
    const target = match[1]
    if (target === undefined) continue
    addPath(paths, target)
    count += 1
  }
  return count
}

function collectCommandTargets(
  words: readonly string[],
  command: string,
  paths: Set<string>,
): number {
  const segment = commandSegment(words, command)
  if (segment === undefined) return 0
  const targets = segment.filter(
    (word) => word !== '-' && !word.startsWith('-'),
  )
  addTargets(paths, targets)
  return targets.length
}

function shellWords(command: string): string[] {
  return (
    command.match(/"[^"]+"|'[^']+'|\S+/gu)?.map((word) => stripQuotes(word)) ??
    []
  )
}

function commandName(token: string): string {
  return (token.split('/').at(-1) ?? token).toLowerCase()
}

function isCommandBoundary(token: string): boolean {
  return token === '|' || token === ';' || token === '&&' || token === '||'
}

function isSedInPlaceFlag(token: string): boolean {
  return (
    token === '-i' ||
    token.startsWith('-i') ||
    token === '--in-place' ||
    token.startsWith('--in-place=')
  )
}

function commandSegment(
  words: readonly string[],
  command: string,
): string[] | undefined {
  const commandIndex = words.findIndex((word) => commandName(word) === command)
  if (commandIndex === -1) return undefined
  const rest = words.slice(commandIndex + 1)
  const boundaryIndex = rest.findIndex((word) => isCommandBoundary(word))
  return boundaryIndex === -1 ? rest : rest.slice(0, boundaryIndex)
}

function addTargets(paths: Set<string>, targets: readonly string[]): void {
  for (const target of targets) addPath(paths, target)
}

function collectSedTargets(
  words: readonly string[],
  paths: Set<string>,
): boolean {
  const segment = commandSegment(words, 'sed')
  if (segment === undefined) return false
  const inPlaceIndex = segment.findIndex((word) => isSedInPlaceFlag(word))
  if (inPlaceIndex === -1) return false
  addTargets(
    paths,
    segment.slice(inPlaceIndex + 2).filter((word) => !word.startsWith('-')),
  )
  return true
}

function collectPerlTargets(
  words: readonly string[],
  paths: Set<string>,
): boolean {
  const segment = commandSegment(words, 'perl')
  if (segment === undefined) return false
  if (!segment.some((word) => word.startsWith('-') && word.includes('i')))
    return false
  const programIndex = segment.indexOf('-e')
  addTargets(
    paths,
    segment
      .slice(Math.max(0, programIndex) + 2)
      .filter((word) => !word.startsWith('-')),
  )
  return true
}

function hasSuspiciousInlineWrite(command: string): boolean {
  return (
    INLINE_INTERPRETER_RE.test(command) &&
    INLINE_FLAG_RE.test(command) &&
    INLINE_WRITE_RE_LIST.some((regex) => regex.test(command))
  )
}

function result(
  paths: Set<string>,
  reasons: Set<string>,
  hasUnknownTarget: boolean,
): BashFileWriteDetection | undefined {
  if (paths.size === 0 && !hasUnknownTarget) return undefined
  return { paths: [...paths], reasons: [...reasons], hasUnknownTarget }
}

export function detectBashFileWrites(
  command: string,
): BashFileWriteDetection | undefined {
  const paths = new Set<string>()
  const reasons = new Set<string>()
  const words = shellWords(command)

  if (collectRegexTargets(command, REDIRECT_RE, paths) > 0) {
    addReason(reasons, 'shell output redirection')
  }
  if (collectCommandTargets(words, 'tee', paths) > 0) {
    addReason(reasons, 'tee file write')
  }
  if (collectRegexTargets(command, DD_RE, paths) > 0) {
    addReason(reasons, 'dd output file')
  }
  if (collectSedTargets(words, paths)) addReason(reasons, 'sed in-place edit')
  if (collectPerlTargets(words, paths)) addReason(reasons, 'perl in-place edit')

  const hasUnknownTarget = hasSuspiciousInlineWrite(command)
  if (hasUnknownTarget) addReason(reasons, 'inline script file write')

  return result(paths, reasons, hasUnknownTarget)
}
