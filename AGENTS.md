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

- `cradle/index.ts` — application entry point
- `cradle/lib/` — core library modules
- `cradle/utils/` — utility helpers
- `cradle/config/` — configuration modules
- `cradle/types/` — shared TypeScript types

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
- For worktrees, use .worktrees folder.
- Never commit, tag, or push without explicit user instruction. Passing `pnpm check` does not imply permission to commit.

Branch and commit conventions

- Prefer branch names like `feat/<scope>-<short-desc>`, `fix/<scope>-<short-desc>`, `chore/<scope>-<short-desc>`.
- Prefer commit style `<type>(<scope>): <why>` where type is `feat`, `fix`, `refactor`, `test`, `docs`, or `chore`.
- Keep commit messages focused on intent and impact, not only file-by-file changes.

Documentation updates

- If change affects public behavior, workflow, configuration, or contributor expectations, update docs in same change set.
- Keep `AGENTS.md` and `CODING_GUIDELINES.md` aligned when rules move or are renamed.

Pi documentation paths

- `~/.local/share/pnpm/global/5/.pnpm/@earendil-works+pi-coding-agent@0.75.4_ws@8.20.1_zod@4.4.3/node_modules/@earendil-works/pi-coding-agent/README.md`
- `~/.local/share/pnpm/global/5/.pnpm/@earendil-works+pi-coding-agent@0.75.4_ws@8.20.1_zod@4.4.3/node_modules/@earendil-works/pi-coding-agent/docs`
- `~/.local/share/pnpm/global/5/.pnpm/@earendil-works+pi-coding-agent@0.75.4_ws@8.20.1_zod@4.4.3/node_modules/@earendil-works/pi-coding-agent/examples`
- When reading pi docs or examples, resolve relative paths like `docs/...` and `examples/...` against the absolute directories above, not the current working directory.

<system-reminder>
- The approval tool defines the user-approved scope for file edits, writes, and bash commands. Within an approved proposal, proceed without re-asking — the proposal is your authorization.
- Anything outside the approved scope requires an amendment proposal and explicit user approval. Do not infer approvals from initial requests or conversation context.
- If you encounter uncertainty, ambiguity, or a blocker you are not authorized to fix: stop immediately, tell the user what you've done so far, and ask whether to continue or change course.
- If stuck for a while, stop and tell the user what is blocking progress instead of trying indefinitely.
- Do not maintain backwards compatibility for any feature — always prefer the cleanest, most modern implementation.
</system-reminder>
