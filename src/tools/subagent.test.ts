import type {
  ExtensionContext,
  ToolRenderResultOptions,
} from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { discoverAgents } from '../subagents/agents.js'
import type {
  AgentConfig,
  AgentDiscoveryResult,
  SingleResult,
} from '../subagents/types.js'
import type {
  MakeDetails,
  SubagentParametersType,
  ToolContext,
  ToolResult,
  UpdateCallback,
} from './subagent-modes.js'
import {
  handleChainMode,
  handleParallelMode,
  handleSingleMode,
  makeDetailsFactory,
  requestProjectAgentApproval,
  validateModeCount,
} from './subagent-modes.js'
import { buildRenderCall, buildRenderResult } from './subagent-render.js'
import { subagentTool } from './subagent.js'

type ModeHandler = (
  parameters: SubagentParametersType,
  context: ToolContext,
  agents: AgentConfig[],
  signal: AbortSignal | undefined,
  onUpdate: UpdateCallback | undefined,
  makeDetails: MakeDetails,
) => Promise<ToolResult>

interface SubagentModesModule {
  handleChainMode: ModeHandler
  handleParallelMode: ModeHandler
  handleSingleMode: ModeHandler
}

vi.mock('@earendil-works/pi-coding-agent', () => ({
  defineTool: vi.fn(
    <Definition>(definition: Definition): Definition => definition,
  ),
}))

vi.mock('../subagents/agents.js', () => ({
  discoverAgents: vi.fn(),
  formatAgentList: vi.fn((agents: AgentConfig[], maxItems: number) => {
    const listed = agents.slice(0, maxItems)
    return {
      text:
        listed.length === 0
          ? 'none'
          : listed.map((agent) => `${agent.name} (${agent.source})`).join('; '),
      remaining: agents.length - listed.length,
    }
  }),
}))

vi.mock('./subagent-render.js', () => ({
  buildRenderCall: vi.fn(() => 'render-call'),
  buildRenderResult: vi.fn(() => 'render-result'),
}))

vi.mock('./subagent-modes.js', async (importOriginal) => {
  const actual = await importOriginal<SubagentModesModule>()
  return {
    ...actual,
    handleChainMode: vi.fn(),
    handleParallelMode: vi.fn(),
    handleSingleMode: vi.fn(),
  }
})

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  const name = overrides.name ?? 'writer'
  return {
    name,
    description: `${name} description`,
    filePath: `/${overrides.source ?? 'user'}/${name}.md`,
    source: 'user',
    systemPrompt: `${name} prompt`,
    ...overrides,
  }
}

function makeSingleResult(agent = 'writer'): SingleResult {
  return {
    agent,
    agentSource: 'user',
    exitCode: 0,
    messages: [],
    stderr: '',
    task: 'do work',
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      contextTokens: 0,
      cost: 0,
      input: 0,
      output: 0,
      turns: 0,
    },
  }
}

function makeContext(overrides: Partial<ToolContext> = {}): ExtensionContext {
  return {
    cwd: '/repo',
    hasUI: false,
    // @ts-expect-error minimal UI mock
    ui: { confirm: vi.fn().mockResolvedValue(true) },
    ...overrides,
  }
}

function makeToolResult(mode: 'single' | 'parallel' | 'chain' = 'single') {
  return {
    content: [{ type: 'text' as const, text: `${mode} done` }],
    details: {
      agentScope: 'user' as const,
      mode,
      projectAgentsDir: undefined,
      results: [makeSingleResult()],
    },
  }
}

const userAgent = makeAgent({ name: 'writer', source: 'user' })
const projectAgent = makeAgent({ name: 'repo-agent', source: 'project' })
const discovery: AgentDiscoveryResult = {
  agents: [userAgent, projectAgent],
  projectAgentsDir: '/repo/.pi/agents',
}

describe('validateModeCount', () => {
  it('accepts exactly one single, parallel, or chain mode', () => {
    expect(
      validateModeCount({ agent: 'writer', task: 'write' }),
    ).toBeUndefined()
    expect(
      validateModeCount({ tasks: [{ agent: 'writer', task: 'write' }] }),
    ).toBeUndefined()
    expect(
      validateModeCount({ chain: [{ agent: 'writer', task: 'write' }] }),
    ).toBeUndefined()
  })

  it('rejects missing, incomplete, empty, or multiple modes', () => {
    const message = 'Invalid parameters. Provide exactly one mode.'

    expect(validateModeCount({})).toBe(message)
    expect(validateModeCount({ agent: 'writer' })).toBe(message)
    expect(validateModeCount({ task: 'write' })).toBe(message)
    expect(validateModeCount({ tasks: [] })).toBe(message)
    expect(validateModeCount({ chain: [] })).toBe(message)
    expect(
      validateModeCount({
        agent: 'writer',
        task: 'write',
        tasks: [{ agent: 'reviewer', task: 'review' }],
      }),
    ).toBe(message)
    expect(
      validateModeCount({
        chain: [{ agent: 'planner', task: 'plan' }],
        tasks: [{ agent: 'reviewer', task: 'review' }],
      }),
    ).toBe(message)
  })
})

describe('confirmProjectAgents', () => {
  it('allows execution without prompting when no requested agents are project-local', async () => {
    const confirm = vi.fn().mockResolvedValue(false)
    const context = makeContext({ hasUI: true, ui: { confirm } })

    await expect(
      requestProjectAgentApproval(
        { agent: 'writer', task: 'write' },
        [userAgent, projectAgent],
        context,
        discovery,
      ),
    ).resolves.toBe(true)

    expect(confirm).not.toHaveBeenCalled()
  })

  it('prompts for requested project-local agents and returns the user choice', async () => {
    const confirm = vi.fn().mockResolvedValue(false)
    const context = makeContext({ hasUI: true, ui: { confirm } })

    await expect(
      requestProjectAgentApproval(
        { agent: 'repo-agent', task: 'inspect' },
        [userAgent, projectAgent],
        context,
        discovery,
      ),
    ).resolves.toBe(false)

    expect(confirm).toHaveBeenCalledWith(
      'Run project-local agents?',
      expect.stringContaining('Agents: repo-agent'),
    )
    expect(confirm).toHaveBeenCalledWith(
      'Run project-local agents?',
      expect.stringContaining('Source: /repo/.pi/agents'),
    )
  })

  it('detects project-local agents requested by parallel tasks and chains', async () => {
    const confirm = vi.fn().mockResolvedValue(true)
    const context = makeContext({ hasUI: true, ui: { confirm } })

    await expect(
      requestProjectAgentApproval(
        {
          chain: [
            { agent: 'writer', task: 'write' },
            { agent: 'repo-agent', task: 'check {previous}' },
          ],
          tasks: [{ agent: 'repo-agent', task: 'review' }],
        },
        [userAgent, projectAgent],
        context,
        { agents: [userAgent, projectAgent], projectAgentsDir: undefined },
      ),
    ).resolves.toBe(true)

    expect(confirm).toHaveBeenCalledWith(
      'Run project-local agents?',
      expect.stringContaining('Source: (unknown)'),
    )
  })
})

describe('makeDetailsFactory', () => {
  it('creates details containing the requested mode, scope, directory, and results', () => {
    const result = makeSingleResult('writer')
    let projectAgentsDirectory: string | undefined

    expect(
      makeDetailsFactory('user', projectAgentsDirectory)('single')([result]),
    ).toEqual({
      agentScope: 'user',
      mode: 'single',
      projectAgentsDir: undefined,
      results: [result],
    })
    expect(
      makeDetailsFactory('project', '/repo/.pi/agents')('chain')([result]),
    ).toEqual({
      agentScope: 'project',
      mode: 'chain',
      projectAgentsDir: '/repo/.pi/agents',
      results: [result],
    })
    expect(
      makeDetailsFactory('both', '/repo/.pi/agents')('parallel')([result]),
    ).toEqual({
      agentScope: 'both',
      mode: 'parallel',
      projectAgentsDir: '/repo/.pi/agents',
      results: [result],
    })
  })
})

describe('subagentTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(discoverAgents).mockReturnValue(discovery)
    vi.mocked(handleSingleMode).mockResolvedValue(makeToolResult('single'))
    vi.mocked(handleParallelMode).mockResolvedValue(makeToolResult('parallel'))
    vi.mocked(handleChainMode).mockResolvedValue(makeToolResult('chain'))
  })

  it('discovers user agents by default and dispatches single mode', async () => {
    const context = makeContext()
    const parameters: SubagentParametersType = {
      agent: 'writer',
      task: 'write',
    }

    const result = await subagentTool.execute(
      'call-1',
      parameters,
      undefined,
      undefined,
      context,
    )

    expect(result).toEqual(makeToolResult('single'))
    expect(discoverAgents).toHaveBeenCalledWith('/repo', 'user')
    expect(handleSingleMode).toHaveBeenCalledWith(
      parameters,
      context,
      discovery.agents,
      undefined,
      undefined,
      expect.any(Function),
    )
  })

  it('dispatches parallel and chain modes', async () => {
    const context = makeContext()
    const parallelParameters: SubagentParametersType = {
      tasks: [{ agent: 'writer', task: 'write' }],
    }
    const chainParameters: SubagentParametersType = {
      chain: [{ agent: 'writer', task: 'write' }],
    }

    await expect(
      subagentTool.execute(
        'call-1',
        parallelParameters,
        undefined,
        undefined,
        context,
      ),
    ).resolves.toEqual(makeToolResult('parallel'))
    await expect(
      subagentTool.execute(
        'call-2',
        chainParameters,
        undefined,
        undefined,
        context,
      ),
    ).resolves.toEqual(makeToolResult('chain'))

    expect(handleParallelMode).toHaveBeenCalledWith(
      parallelParameters,
      context,
      discovery.agents,
      undefined,
      undefined,
      expect.any(Function),
    )
    expect(handleChainMode).toHaveBeenCalledWith(
      chainParameters,
      context,
      discovery.agents,
      undefined,
      undefined,
      expect.any(Function),
    )
  })

  it('returns a validation response before dispatching when mode count is invalid', async () => {
    const result = await subagentTool.execute(
      'call-1',
      {},
      undefined,
      undefined,
      makeContext(),
    )

    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining(
        'Invalid parameters. Provide exactly one mode.',
      ),
    })
    expect(handleSingleMode).not.toHaveBeenCalled()
    expect(handleParallelMode).not.toHaveBeenCalled()
    expect(handleChainMode).not.toHaveBeenCalled()
  })

  it('cancels when project-local agents are not approved', async () => {
    const confirm = vi.fn().mockResolvedValue(false)
    const context = makeContext({ hasUI: true, ui: { confirm } })

    const result = await subagentTool.execute(
      'call-1',
      { agent: 'repo-agent', agentScope: 'project', task: 'inspect' },
      undefined,
      undefined,
      context,
    )

    expect(confirm).toHaveBeenCalledOnce()
    expect(result.content[0]).toEqual({
      type: 'text',
      text: 'Canceled: project-local agents not approved.',
    })
    expect(handleSingleMode).not.toHaveBeenCalled()
  })

  it('skips project-agent confirmation when disabled or when there is no UI', async () => {
    const confirm = vi.fn().mockResolvedValue(false)
    const contextWithUi = makeContext({ hasUI: true, ui: { confirm } })
    const contextWithoutUi = makeContext({ hasUI: false, ui: { confirm } })

    await subagentTool.execute(
      'call-1',
      {
        agent: 'repo-agent',
        agentScope: 'both',
        confirmProjectAgents: false,
        task: 'inspect',
      },
      undefined,
      undefined,
      contextWithUi,
    )
    await subagentTool.execute(
      'call-2',
      { agent: 'repo-agent', agentScope: 'project', task: 'inspect' },
      undefined,
      undefined,
      contextWithoutUi,
    )

    expect(confirm).not.toHaveBeenCalled()
    expect(handleSingleMode).toHaveBeenCalledTimes(2)
  })

  it('delegates renderCall and renderResult to render helpers', () => {
    const theme = {
      bold: (text: string) => text,
      fg: (_color: string, text: string) => text,
    }
    const result = makeToolResult('single')
    const options: ToolRenderResultOptions = {
      expanded: true,
      isPartial: false,
    }

    expect(
      // @ts-expect-error minimal context mock
      subagentTool.renderCall?.({ agent: 'writer', task: 'write' }, theme, {}),
    ).toBe('render-call')
    expect(
      // @ts-expect-error minimal context mock
      subagentTool.renderResult?.(result, options, theme, {}),
    ).toBe('render-result')
    expect(buildRenderCall).toHaveBeenCalledWith(
      { agent: 'writer', task: 'write' },
      theme,
    )
    expect(buildRenderResult).toHaveBeenCalledWith(result, true, theme)
  })
})
