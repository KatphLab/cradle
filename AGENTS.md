Operating mode

- Before any response or code action, load `caveman`.
- Stay in caveman mode unless user says `stop caveman` or `normal mode`.
- If another skill applies, use it too, but keep caveman style.

Repo standards

- See `CODING_GUIDELINES.md` for coding, testing, and secure implementation guidelines.

Rule precedence

- Follow this order when rules conflict: direct user instruction > `AGENTS.md` > `CODING_GUIDELINES.md` > local file conventions.
- If still unclear, choose smallest safe change and document rationale in PR/commit message.

Repo-specific rules

- Use pnpm only. Run repo scripts with `pnpm`. Do not use `npm`.
- Respect engine constraint: `node >=24 <25`.
- Treat `pnpm-lock.yaml` as source of truth. Do not create or update `package-lock.json` or `yarn.lock`.
- Do not edit `package.json` manually.
- This project is TypeScript-only. Do not write `.js` files.

Project map

- `src/index.ts` — application entry point
- `src/lib/` — core library modules
- `src/utils/` — utility helpers
- `src/config/` — configuration modules
- `src/types/` — shared TypeScript types

Tooling configuration (NEVER EDIT)

- Never modify tooling configuration files. If checks fail, fix root cause in code instead of bypassing tool.
- Forbidden files:
  - `.dependency-cruiser.js`
  - `.jscpd.json`
  - `.prettierrc.json`
  - `.semgrep.yml`
  - `.npmrc`
  - `eslint.config.mjs`
  - `knip.json`
  - `lint-staged.config.mjs`
  - `tsconfig.json`
  - `vitest.config.ts`
  - `vitest.setup.ts`
  - `vitest.strict-reporter.ts`

Quality gate

`pnpm check` is the full gate and must pass before claiming work complete. It runs in order:

1. `pnpm format` — Prettier
2. `pnpm lint` — ESLint
3. `pnpm typecheck` — TypeScript
4. `pnpm test:ci` — Vitest with coverage
5. `pnpm depcruise` — dependency-cruiser boundary checks
6. `pnpm knip` — unused exports / dead code
7. `pnpm dupcheck` — jscpd duplicate detection

Use `pnpm fix` to auto-apply Prettier and ESLint fixes before running the full gate.

Git workflow

- Before feature work, verify current branch is not `main` or `master`.
- If it is, create descriptive feature branch before making changes.
- Do not use git worktrees in this repo.

Branch and commit conventions

- Prefer branch names like `feat/<scope>-<short-desc>`, `fix/<scope>-<short-desc>`, `chore/<scope>-<short-desc>`.
- Prefer commit style `<type>(<scope>): <why>` where type is `feat`, `fix`, `refactor`, `test`, `docs`, or `chore`.
- Keep commit messages focused on intent and impact, not only file-by-file changes.

Documentation updates

- If change affects public behavior, workflow, configuration, or contributor expectations, update docs in same change set.
- Keep `AGENTS.md` and `CODING_GUIDELINES.md` aligned when rules move or are renamed.
