# Cradle Extension Roadmap

> Simple task tracker for the cradle pi extension.

---

## Tools

- [x] ApplyPatch — harnass patch grammar (`src/tools/apply-patch.ts`)
- [ ] AskUser — standardized questionnaire TUI (`src/tools/ask-user.ts`)
- [ ] CreateMission — mission metadata scaffolding (`src/tools/create-mission.ts`)
- [ ] EndFeatureRun — worker completion boundary (`src/tools/end-feature-run.ts`)
- [ ] ExitSpecMode — spec approval handoff (`src/tools/exit-spec-mode.ts`)
- [ ] FetchUrl — safe URL fetch with SSRF prevention (`src/tools/fetch-url.ts`)
- [ ] GenerateDroid — custom agent definition writer (`src/tools/generate-droid.ts`)
- [ ] Skill bridge — pi skill invocation (`src/tools/skill.ts`)
- [ ] Task — single subagent dispatch (`src/tools/task.ts`)
- [ ] Task v2 — parallel + chain multi-subagent dispatch
- [ ] ToolSearch — deferred tool activation (`src/tools/tool-search.ts`)
- [ ] WebSearch — provider-backed search (`src/tools/web-search.ts`)

---

## Commands

- [ ] `/mission` — show current mission status
- [ ] `/mission-list` — list all missions
- [ ] `/mission-resume <id>` — restore a mission
- [ ] `/todos` — full-screen todo overlay

---

## Hooks

- [ ] Mode policy enforcement — unified tool gating (`src/hooks/mode-policy.ts`)
- [ ] Mission reminder — orchestrator/worker prompt injection (`src/hooks/mission-reminder.ts`)
- [ ] Todo widget — persistent todo display (`src/hooks/todo-widget.ts`)

---

## Infra / Utils

- [ ] Mission artifacts — worker file helpers (`src/mission/artifacts.ts`)
- [ ] Mission conflict resolution (`src/mission/conflict.ts`)
- [ ] Mission filesystem helpers (`src/mission/fs.ts`)
- [ ] Mission milestones tracker (`src/mission/milestones.ts`)
- [ ] Mission types (`src/mission/types.ts`)
- [ ] Mission validation contract (`src/mission/validation.ts`)
- [ ] Mode policy table (`src/utils/mode-policy.ts`)
- [ ] Search provider interface (`src/utils/search-provider.ts`)
- [ ] Subagent discovery (`src/subagents/discover.ts`)
- [ ] Subagent runner (`src/subagents/runner.ts`)
- [ ] URL validation (`src/utils/url-validation.ts`)

---

## Prompts

- [ ] Mission orchestrator fragment (`src/prompts/mission.ts`)
- [ ] Mission worker fragment (`src/prompts/mission.ts`)
- [ ] Mode-specific system prompt fragments (`src/prompts/modes.ts`)

---

_Last updated: `b7984b1`_
