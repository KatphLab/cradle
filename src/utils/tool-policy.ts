const CRADLE_SUBAGENT_ENV = 'CRADLE_SUBAGENT'
const HIDDEN_TOOLS = new Set<string>([
  'web_fetch_internal',
  'web_search_internal',
])

/** Check if the current process is running as a cradle subagent. */
function isCradleSubagentProcess(): boolean {
  return process.env[CRADLE_SUBAGENT_ENV] === '1'
}

/** Filter out tools that should be hidden from the main agent. */
export function filterMainAgentTools(toolNames: readonly string[]): string[] {
  if (isCradleSubagentProcess()) {
    return [...toolNames]
  }
  const result: string[] = []
  for (const name of toolNames) {
    if (!HIDDEN_TOOLS.has(name)) {
      result.push(name)
    }
  }
  return result
}
