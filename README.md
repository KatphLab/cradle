# cradle

A **pi extension package** providing sample tools, commands, hooks, and skills for the pi coding agent.

## Pi Manifest

Registered in `package.json`:

```json
"pi": {
  "extensions": ["./src"],
  "skills": ["./skills"]
}
```

## Structure

```
src/
  index.ts              ← extension entry point (configureExtension)
  cradle.test.ts        ← entry point tests
  tools/
    hello.ts            ← greeting tool with call counter
    hello.test.ts
  commands/
    stats.ts            ← stats command with invocation counter
    stats.test.ts
  hooks/
    session.ts          ← session lifecycle hooks with Map tracking
    session.test.ts
skills/
  my-skill/
    SKILL.md            ← sample skill documentation
```

## Extension Samples

| Module          | What it does                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `hello` tool    | Greets by name. Tracks total calls in module state (`details.count`).                                                                         |
| `stats` command | Shows session entry count. Tracks how many times the command was invoked.                                                                     |
| `session` hooks | `session_start` creates a session ID in a Map. `tool_call` increments the most recent session's counter. `agent_end` reports active sessions. |

## Development

```bash
pnpm check      # full gate: format, lint, typecheck, tests, depcruise, knip, dupcheck
pnpm test       # run tests
pnpm test:ci    # tests with coverage
pnpm build      # compile to dist/ (tsc + tsc-alias)
```

## Quality Gates

`pnpm check` runs in order:

1. `pnpm format` — Prettier
2. `pnpm lint` — ESLint
3. `pnpm typecheck` — TypeScript
4. `pnpm test:ci` — Vitest with coverage
5. `pnpm depcruise` — architecture boundary checks
6. `pnpm knip` — unused exports / dead code
7. `pnpm dupcheck` — jscpd duplicate detection

**Coverage thresholds** (v8 provider):

- Statements: 100%
- Branches: 90%
- Functions: 100%
- Lines: 100%

## Conventions

- **ESM** with `NodeNext` module resolution — relative imports use `.js` extensions
- **Co-located tests** — test files live next to source (no `__tests__/` subfolders)
- **No parent imports** — `../` is banned; all imports are current-directory `./`
- **Narrow API types** — handlers use `Pick<ExtensionAPI, ...>` for testability
- **Module-level state** — counters and Maps live in modules; reset functions exported for tests

## Peer Dependencies

The extension expects the host (pi) to provide:

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-tui`
- `typebox`

## AI Agent Guidelines

See [AGENTS.md](./AGENTS.md) for coding rules and conventions.

## License

MIT
