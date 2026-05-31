import type { Dirent, PathLike, Stats } from 'node:fs'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentValidationResult } from './validate.js'

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn<(directory: PathLike) => boolean>(),
  readFileSync:
    vi.fn<(filePath: PathLike, encoding: BufferEncoding) => string>(),
  readdirSync:
    vi.fn<
      (directory: PathLike, options: { withFileTypes: true }) => Dirent[]
    >(),
  statSync: vi.fn<(filePath: PathLike) => Pick<Stats, 'isDirectory'>>(),
}))

const codingAgentMocks = vi.hoisted(() => ({
  getAgentDir: vi.fn<() => string>(),
}))

const validateMocks = vi.hoisted(() => ({
  validateAgent: vi.fn<(content: string) => AgentValidationResult>(),
}))

vi.mock('node:fs', () => fsMocks)
vi.mock('@earendil-works/pi-coding-agent', () => codingAgentMocks)
vi.mock('./validate.js', () => validateMocks)

import { discoverAgents, formatAgentList } from './agents.js'
import type { AgentConfig } from './types.js'

const userAgentRoot = '/home/test/.pi'
const userAgentsDirectory = path.join(userAgentRoot, 'agents')
const projectAgentsDirectory = '/workspace/repo/.pi/agents'

function makeDirent(
  name: string,
  options: { file?: boolean; symbolicLink?: boolean } = {},
): Dirent {
  const file = options.file ?? true
  const symbolicLink = options.symbolicLink ?? false
  const directoryEntry: Dirent = {
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isDirectory: () => !file && !symbolicLink,
    isFIFO: () => false,
    isFile: () => file,
    isSocket: () => false,
    isSymbolicLink: () => symbolicLink,
    name,
    parentPath: '',
  }

  return directoryEntry
}

function makeStats(isDirectory: boolean): Pick<Stats, 'isDirectory'> {
  return { isDirectory: () => isDirectory }
}

function makeAgent(
  name: string,
  description = `${name} description`,
): AgentConfig {
  return {
    description,
    filePath: '',
    name,
    source: 'user',
    systemPrompt: `${name} prompt`,
  }
}

function validAgent(
  _content: string,
  agent: AgentConfig,
): AgentValidationResult {
  return { agent, errors: [], valid: true, warnings: [] }
}

function invalidAgent(errors: string[]): AgentValidationResult {
  return { errors, valid: false, warnings: [] }
}

function configureProjectDirectory(projectDirectory?: string): void {
  fsMocks.statSync.mockImplementation((filePath) =>
    makeStats(String(filePath) === projectDirectory),
  )
}

function configureDirectories(entriesByDirectory: Map<string, Dirent[]>): void {
  fsMocks.existsSync.mockImplementation((directory) =>
    entriesByDirectory.has(String(directory)),
  )
  fsMocks.readdirSync.mockImplementation((directory) => {
    const entries = entriesByDirectory.get(String(directory))
    if (entries === undefined) throw new Error('missing directory')
    return entries
  })
}

describe('discoverAgents', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    codingAgentMocks.getAgentDir.mockReturnValue(userAgentRoot)
    configureProjectDirectory()
    configureDirectories(new Map())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('discovers user and nearest project agents, filters entries, and lets project agents override user agents', () => {
    configureProjectDirectory(projectAgentsDirectory)
    configureDirectories(
      new Map([
        [
          userAgentsDirectory,
          [
            makeDirent('shared.md'),
            makeDirent('linked.md', { file: false, symbolicLink: true }),
            makeDirent('notes.txt'),
            makeDirent('directory.md', { file: false }),
          ],
        ],
        [
          projectAgentsDirectory,
          [makeDirent('shared.md'), makeDirent('project-only.md')],
        ],
      ]),
    )

    const contentByFile = new Map<string, string>([
      [path.join(userAgentsDirectory, 'shared.md'), 'user shared'],
      [path.join(userAgentsDirectory, 'linked.md'), 'linked'],
      [path.join(projectAgentsDirectory, 'shared.md'), 'project shared'],
      [path.join(projectAgentsDirectory, 'project-only.md'), 'project only'],
    ])
    fsMocks.readFileSync.mockImplementation((filePath) => {
      const content = contentByFile.get(String(filePath))
      if (content === undefined) throw new Error('unexpected file')
      return content
    })
    validateMocks.validateAgent.mockImplementation((content) => {
      if (content === 'user shared') {
        return validAgent(content, makeAgent('shared', 'User shared'))
      }
      if (content === 'linked') return validAgent(content, makeAgent('linked'))
      if (content === 'project shared') {
        return validAgent(content, makeAgent('shared', 'Project shared'))
      }
      return validAgent(content, makeAgent('project-only'))
    })

    const result = discoverAgents('/workspace/repo/src/deep')

    expect(result.projectAgentsDir).toBe(projectAgentsDirectory)
    expect(result.agents).toHaveLength(3)
    expect(result.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: 'Project shared',
          filePath: path.join(projectAgentsDirectory, 'shared.md'),
          name: 'shared',
          source: 'project',
        }),
        expect.objectContaining({
          filePath: path.join(userAgentsDirectory, 'linked.md'),
          name: 'linked',
          source: 'user',
        }),
        expect.objectContaining({
          filePath: path.join(projectAgentsDirectory, 'project-only.md'),
          name: 'project-only',
          source: 'project',
        }),
      ]),
    )
    expect(fsMocks.readFileSync).not.toHaveBeenCalledWith(
      path.join(userAgentsDirectory, 'notes.txt'),
      'utf8',
    )
    expect(fsMocks.readFileSync).not.toHaveBeenCalledWith(
      path.join(userAgentsDirectory, 'directory.md'),
      'utf8',
    )
  })

  it('loads agents from all directories with project overriding user over extension', () => {
    configureProjectDirectory(projectAgentsDirectory)
    configureDirectories(
      new Map([
        [userAgentsDirectory, [makeDirent('user-only.md')]],
        [projectAgentsDirectory, [makeDirent('project-only.md')]],
      ]),
    )
    fsMocks.readFileSync.mockReturnValue('user only')
    validateMocks.validateAgent.mockReturnValue(
      validAgent('user only', makeAgent('user-only')),
    )

    const result = discoverAgents('/workspace/repo/app')

    expect(result.projectAgentsDir).toBe(projectAgentsDirectory)
    expect(result.agents).toEqual([
      expect.objectContaining({ name: 'user-only', source: 'project' }),
    ])
    expect(fsMocks.readdirSync).toHaveBeenCalledWith(userAgentsDirectory, {
      withFileTypes: true,
    })
    expect(fsMocks.readdirSync).toHaveBeenCalledWith(projectAgentsDirectory, {
      withFileTypes: true,
    })
  })

  it('discovers agents from all directories with override priority', () => {
    configureProjectDirectory(projectAgentsDirectory)
    configureDirectories(
      new Map([
        [userAgentsDirectory, [makeDirent('user-only.md')]],
        [projectAgentsDirectory, [makeDirent('project-only.md')]],
      ]),
    )
    fsMocks.readFileSync.mockReturnValue('project only')
    validateMocks.validateAgent.mockReturnValue(
      validAgent('project only', makeAgent('project-only')),
    )

    const result = discoverAgents('/workspace/repo/app')

    expect(result.agents).toEqual([
      expect.objectContaining({ name: 'project-only', source: 'project' }),
    ])
    expect(fsMocks.readdirSync).toHaveBeenCalledWith(projectAgentsDirectory, {
      withFileTypes: true,
    })
    expect(fsMocks.readdirSync).toHaveBeenCalledWith(userAgentsDirectory, {
      withFileTypes: true,
    })
  })

  it('returns no project agents when no project agents directory is found', () => {
    fsMocks.statSync.mockImplementation(() => {
      throw new Error('stat failed')
    })
    configureDirectories(new Map([[userAgentsDirectory, []]]))

    const result = discoverAgents('/workspace/orphan')

    expect(result).toEqual({ agents: [], projectAgentsDir: undefined })
  })

  it('treats missing and unreadable directories as empty', () => {
    fsMocks.existsSync.mockReturnValueOnce(false).mockReturnValueOnce(true)
    fsMocks.readdirSync.mockImplementationOnce(() => {
      throw new Error('unreadable')
    })

    expect(discoverAgents('/workspace/orphan').agents).toEqual([])
    expect(discoverAgents('/workspace/orphan').agents).toEqual([])
  })

  it('skips unreadable, invalid, and agentless files', () => {
    configureDirectories(
      new Map([
        [
          userAgentsDirectory,
          [
            makeDirent('unreadable.md'),
            makeDirent('invalid.md'),
            makeDirent('agentless.md'),
          ],
        ],
      ]),
    )
    fsMocks.readFileSync.mockImplementation((filePath) => {
      if (String(filePath).endsWith('unreadable.md')) {
        throw new Error('cannot read')
      }
      return String(filePath).endsWith('invalid.md') ? 'invalid' : 'agentless'
    })
    validateMocks.validateAgent.mockImplementation((content) =>
      content === 'invalid'
        ? invalidAgent(['bad name', 'bad description'])
        : { errors: [], valid: true, warnings: [] },
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      // Suppress expected warning output during this test.
    })

    const result = discoverAgents('/workspace/orphan')

    expect(result.agents).toEqual([])
    expect(warn).toHaveBeenCalledWith(
      `Skipping agent ${path.join(userAgentsDirectory, 'invalid.md')}: bad name; bad description`,
    )
  })
})

describe('formatAgentList', () => {
  it('formats none for an empty list', () => {
    expect(formatAgentList([], 5)).toEqual({ remaining: 0, text: 'none' })
  })

  it('formats agents up to the item limit and returns the remaining count', () => {
    const agents: AgentConfig[] = [
      { ...makeAgent('alpha', 'Alpha agent'), source: 'user' },
      { ...makeAgent('beta', 'Beta agent'), source: 'project' },
      { ...makeAgent('gamma', 'Gamma agent'), source: 'user' },
    ]

    expect(formatAgentList(agents, 2)).toEqual({
      remaining: 1,
      text: 'alpha (user): Alpha agent; beta (project): Beta agent',
    })
  })
})
