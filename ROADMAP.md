# Cradle Extension Roadmap

> Simple task tracker for the cradle pi extension.

---

## Tools

- [-] AskUser — standardized questionnaire TUI (not planned)
- [x] Bash — shell command execution (`src/tools/bash.ts`)
- [x] Edit — text replacement in files (`src/tools/edit.ts`)
- [x] Glob — file path pattern matching (`src/tools/glob.ts`)
- [x] Grep — file content search (`src/tools/grep.ts`)
- [ ] CreateMission — mission metadata scaffolding (`src/tools/create-mission.ts`)
- [ ] EndFeatureRun — worker completion boundary (`src/tools/end-feature-run.ts`)
- [ ] ExitSpecMode — spec approval handoff (`src/tools/exit-spec-mode.ts`)
- [ ] FetchUrl — safe URL fetch with SSRF prevention (`src/tools/fetch-url.ts`)
- [ ] GenerateDroid — custom agent definition writer (`src/tools/generate-droid.ts`)
- [x] Ls — directory listing (`src/tools/ls.ts`)
- [x] Read — file reading (`src/tools/read.ts`)
- [ ] Skill bridge — pi skill invocation (`src/tools/skill.ts`)
- [x] Task — single subagent dispatch (`src/tools/subagent.ts`)
- [x] Task v2 — parallel + chain multi-subagent dispatch (`src/tools/subagent-modes.ts`, `src/tools/subagent-render.ts`)
- [x] Todo — task list updates (`src/tools/todo.ts`)
- [ ] ToolSearch — deferred tool activation (`src/tools/tool-search.ts`)
- [ ] WebSearch — provider-backed search (`src/tools/web-search.ts`)
- [x] Write — file writing (`src/tools/write.ts`)

---

## Commands

- [ ] `/compact` — compact current conversation/session
- [ ] `/mission` — show current mission status
- [ ] `/mission-list` — list all missions
- [ ] `/mission-resume <id>` — restore a mission
- [x] `/settings` — extension settings editor (`src/commands/settings.ts`)
- [x] `/spec` — spec mode toggle (`src/commands/spec.ts`)
- [x] `/stats` — session statistics (`src/commands/stats.ts`)
- [ ] `/todos` — full-screen todo overlay

---

## TUI

- [-] AskUser render — rich TUI display for questionnaire output (not planned)
- [ ] Todo TUI — proper inline/overlay todo display

---

## Hooks

- [x] Shell hook — command risk assessment (`src/hooks/shell.ts`)
- [x] Spec mode hook — spec mode enforcement (`src/hooks/spec-mode.ts`)
- [x] System reminder hook — prompt injection for system reminders (`src/hooks/system-reminder.ts`)
- [ ] Notification hook — completion/status notification integration (`src/hooks/notification.ts`)
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
- [x] Subagent discovery (`src/subagents/agents.ts`)
- [x] Subagent render — result formatting (`src/subagents/render.ts`)
- [x] Subagent runner (`src/subagents/runner.ts`)
- [x] Subagent types (`src/subagents/types.ts`)
- [x] Subagent utilities (`src/subagents/utilities.ts`)
- [x] Subagent validation (`src/subagents/validate.ts`)
- [ ] URL validation (`src/utils/url-validation.ts`)

---

## Prompts

- [x] Spec mode prompt fragment (`src/prompts/spec.ts`)
- [ ] Mission orchestrator fragment (`src/prompts/mission.ts`)
- [ ] Mission worker fragment (`src/prompts/mission.ts`)
- [ ] Mode-specific system prompt fragments (`src/prompts/modes.ts`)

---

_Last updated: `5697c10`_
