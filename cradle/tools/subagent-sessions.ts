import { Type, type Static } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'

import {
  listSubagentRunRecords,
  type SubagentRunRecord,
} from '../lib/subagents/run-index.js'

const SubagentSessionsParameters = Type.Object(
  {
    agent: Type.Optional(
      Type.String({ description: 'Filter sessions by subagent name' }),
    ),
    cwd: Type.Optional(
      Type.String({ description: 'Filter sessions by working directory' }),
    ),
    limit: Type.Optional(
      Type.Number({ description: 'Maximum number of sessions to return' }),
    ),
  },
  { additionalProperties: false },
)

type SubagentSessionsParametersType = Static<typeof SubagentSessionsParameters>

interface SubagentSessionsDetails {
  sessions: SubagentRunRecord[]
  total: number
}

function getLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 20
  return Math.max(1, Math.min(100, Math.trunc(limit)))
}

function getLatestSessionRecords(
  records: SubagentRunRecord[],
): SubagentRunRecord[] {
  const latest = new Map<string, SubagentRunRecord>()
  const sorted = [...records].toSorted((a, b) =>
    b.timestamp.localeCompare(a.timestamp),
  )
  for (const record of sorted) {
    if (!latest.has(record.sessionId)) latest.set(record.sessionId, record)
  }
  return [...latest.values()]
}

function filterRecords(
  records: SubagentRunRecord[],
  parameters: SubagentSessionsParametersType,
): SubagentRunRecord[] {
  return records.filter((record) => {
    if (parameters.agent !== undefined && record.agent !== parameters.agent) {
      return false
    }
    if (parameters.cwd !== undefined && record.cwd !== parameters.cwd) {
      return false
    }
    return true
  })
}

function formatSessionRecord(record: SubagentRunRecord): string {
  const lines = [
    `- ${record.sessionId} — ${record.agent} — ${record.status}`,
    `  task: ${record.task}`,
    `  cwd: ${record.cwd}`,
    `  updated: ${record.timestamp}`,
    `  resume: subagent_resume({ agent: "${record.agent}", sessionId: "${record.sessionId}", task: "..." })`,
  ]
  if (record.sessionFile !== undefined)
    lines.push(`  file: ${record.sessionFile}`)
  return lines.join('\n')
}

function formatSessions(records: SubagentRunRecord[], total: number): string {
  if (total === 0) {
    return 'No known subagent sessions. Run subagent first, then use subagent_sessions to find the recorded session ids.'
  }
  const hidden = total - records.length
  const lines = [
    `Known subagent sessions (${records.length}/${total} shown):`,
    '',
    ...records.map((record) => formatSessionRecord(record)),
  ]
  if (hidden > 0) lines.push('', `... ${hidden} more omitted; increase limit.`)
  return lines.join('\n')
}

/** @public */
export const subagentSessionsTool = defineTool({
  name: 'subagent_sessions',
  label: 'Subagent Sessions',
  description:
    'List known subagent sessions and their session ids so an existing subagent can be resumed with subagent_resume.',
  parameters: SubagentSessionsParameters,

  async execute(_toolCallId, parameters: SubagentSessionsParametersType) {
    const records = await listSubagentRunRecords()
    const sessions = getLatestSessionRecords(filterRecords(records, parameters))
    const limited = sessions.slice(0, getLimit(parameters.limit))
    return {
      content: [
        {
          type: 'text' as const,
          text: formatSessions(limited, sessions.length),
        },
      ],
      details: {
        sessions: limited,
        total: sessions.length,
      } satisfies SubagentSessionsDetails,
    }
  },

  renderCall(args, theme) {
    const parsed = args as Partial<SubagentSessionsParametersType>
    const filters = [
      parsed.agent === undefined ? undefined : `agent=${parsed.agent}`,
      parsed.cwd === undefined ? undefined : `cwd=${parsed.cwd}`,
    ].filter((item): item is string => item !== undefined)
    const suffix = filters.length > 0 ? ` ${filters.join(' ')}` : ''
    return new Text(
      theme.fg('toolTitle', theme.bold('subagent sessions')) +
        theme.fg('muted', suffix),
      0,
      0,
    )
  },
})
