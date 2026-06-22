Cradle is a TypeScript pi extension package that adds safer tools, commands, hooks, agents, skills, and workflow modes for the pi coding agent.

Rule precedence

- Follow this order when instructions conflict: user request > `AGENTS.md` > local conventions.
- If still unclear, make the smallest safe change and explain the rationale in the PR or commit message.

Repository basics

- Use `pnpm` only; never use `npm`, `yarn`, `package-lock.json`, or `yarn.lock`.
- Respect `node >=24 <25` and treat `pnpm-lock.yaml` as authoritative.
- Do not edit `package.json` manually.
- This repo is TypeScript-only; do not add `.js` files.
- Reuse existing modules, keep changes focused, and remove replaced code paths instead of keeping compatibility shims.
- Do not add `TODO` or `FIXME` comments unless they include a linked issue or expiration date.

Project map

- `cradle/index.ts` — application entry point
- `cradle/lib/` — core library modules
- `cradle/utils/` — utility helpers
- `cradle/config/` — configuration modules
- `cradle/types/` — shared TypeScript types

Coding standards

- Keep types explicit where inference would become unsafe; never rely on implicit `any` or unchecked non-null assumptions.
- Omit optional properties instead of assigning `undefined`.
- Guard array, record, optional-chain, and index-signature results before use; use bracket notation for index-signature properties.
- Ensure every non-void function returns on all paths; remove unreachable code and prevent silent `switch` fallthrough.
- Use `override` for inherited method overrides and `readonly` for class fields that do not change after construction.
- Remove unused code. Prefix intentionally unused required parameters with `_`.
- Prefer type guards over assertions; if an assertion is unavoidable, document why it is safe.
- Use explicit named types instead of deriving exported contracts from local implementation details.
- Convert or guard non-number values before template interpolation. Always provide comparators for non-string sorts.
- Put imports first, merge duplicate imports, remove unused imports, and use inline `type` qualifiers for type-only imports/exports.
- Do not create barrel/pass-through re-export files or use `export *`; import from source modules.
- Do not add inline lint suppressions. Fix the root cause.
- Use clear identifiers; allowed short forms are `args`, `env`, `err`, `fn`, and `temp`.
- Match file-name casing exactly, use property shorthand, and use template literals for interpolation.
- Keep functions simple: max 10 cyclomatic branches, 12 cognitive complexity, 80 body lines, and 7 parameters.
- In production code, use `console.warn` for recoverable anomalies and `console.error` for real errors; avoid `console.log`/`console.info`.
- Declare classes, variables, enums, and type aliases before referencing them; hoisted function declarations are exempt.

Testing, errors, dependencies, and security

- Test behavior changes, state transitions, side effects, contracts, outputs, and edge/error paths through public APIs.
- Cover at least one success and one failure path for each changed behavior.
- Do not leave skipped/todo tests, bypass quality gates, or bypass pre-commit hooks.
- Normalize unknown thrown values to `Error` at module boundaries and show users safe, actionable messages.
- Add dependencies only when existing code cannot solve the problem cleanly; document rationale and review security/license impact.
- Do not introduce `eval`, `Function`, unsafe shell execution, hardcoded secrets, or suppressed security findings.

Quality gate

- `pnpm check` is the full gate and must pass before claiming work complete. It runs: format, lint, typecheck, tests with coverage, dependency-cruiser, knip, and duplicate detection.
- Use `pnpm fix` for safe Prettier/ESLint fixes before the full gate.
- Also run targeted tests for changed files/features when applicable.

Git workflow

- Before feature work, verify the branch is not `main` or `master`; if it is, create a descriptive feature branch.
- Put worktrees under `.worktrees/`.
- Never commit, tag, or push without explicit user instruction.
- Prefer branch names like `feat/<scope>-<short-desc>`, `fix/<scope>-<short-desc>`, or `chore/<scope>-<short-desc>`.
- Prefer commits like `<type>(<scope>): <why>` using `feat`, `fix`, `refactor`, `test`, `docs`, or `chore`.
- Keep commit messages focused on intent and impact.

Documentation

- Update docs when changes affect public behavior, workflows, configuration, or contributor expectations.

<system-reminder>
- The approval tool is the authorization boundary for file edits, writes, and bash commands. After a proposal is approved, execute that scoped step without re-asking.
- For non-trivial tasks, plan first and request approval for one step at a time. Keep each proposal to at most 4 file scopes and 4 bash scopes.
- Do not infer approval from the user's initial request or prior context. New, changed, or out-of-scope work needs a new proposal and explicit approval; if the plan no longer fits, stop and request revised approval.
- If approval is the only blocker, create a proposal for the current step and wait; do not ask whether to create one.
- For other uncertainty, ambiguity, or blockers, stop, summarize progress and the blocker, and ask how to proceed. If stuck for a while, stop rather than retrying indefinitely.
- Do not maintain backwards compatibility for any feature; prefer the cleanest modern implementation.
</system-reminder>
