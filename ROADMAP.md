# Cradle Extension Roadmap

> Simple task tracker for the cradle pi extension.

---

## Tools

| Status | Tool                                               | Location                                                                                                            |
| ------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [x]    | Bash — shell command execution                     | `src/tools/bash.ts`                                                                                                 |
| [x]    | Edit — text replacement in files                   | `src/tools/edit.ts`                                                                                                 |
| [x]    | Glob — file path pattern matching                  | `src/tools/glob.ts`                                                                                                 |
| [x]    | Grep — file content search                         | `src/tools/grep.ts`                                                                                                 |
| [x]    | Ls — directory listing                             | `src/tools/ls.ts`                                                                                                   |
| [x]    | Read — file reading                                | `src/tools/read.ts`                                                                                                 |
| [x]    | Write — file writing                               | `src/tools/write.ts`                                                                                                |
| [x]    | Todo — task list updates                           | `src/tools/todo.ts`                                                                                                 |
| [x]    | Subagent — single/parallel/chain subagent dispatch | `src/tools/subagent.ts`, `src/tools/subagent/subagent-modes.ts`, `src/tools/subagent/subagent-render.ts`            |
| [x]    | Discover Agents — list available subagents         | `src/tools/discover-agents.ts`                                                                                      |
| [x]    | Advisor — expert advisor consultation              | `src/tools/advisor.ts`, `src/tools/advisor/runner.ts`, `src/tools/advisor/prompt.ts`, `src/tools/advisor/render.ts` |
| [x]    | Web Fetch — safe URL fetch with SSRF prevention    | `src/tools/webfetch/index.ts`, `src/tools/webfetch/providers/`                                                      |
| [x]    | Web Search — provider-backed search                | `src/tools/websearch/index.ts`, `src/tools/websearch/providers/`                                                    |
| [ ]    | CreateMission — mission metadata scaffolding       | `src/tools/create-mission.ts`                                                                                       |
| [ ]    | EndFeatureRun — worker completion boundary         | `src/tools/end-feature-run.ts`                                                                                      |
| [ ]    | ExitSpecMode — spec approval handoff               | `src/tools/exit-spec-mode.ts`                                                                                       |
| [ ]    | GenerateDroid — custom agent definition writer     | `src/tools/generate-droid.ts`                                                                                       |
| [ ]    | Skill bridge — pi skill invocation                 | `src/tools/skill.ts`                                                                                                |
| [ ]    | ToolSearch — deferred tool activation              | `src/tools/tool-search.ts`                                                                                          |

---

## Commands

| Status | Command                                           | Location                         |
| ------ | ------------------------------------------------- | -------------------------------- |
| [x]    | `/settings` — extension settings editor           | `src/commands/settings.ts`       |
| [x]    | `/spec` — spec mode toggle                        | `src/commands/spec.ts`           |
| [x]    | `/stats` — session statistics                     | `src/commands/stats.ts`          |
| [ ]    | `/compact` — compact current conversation/session | `src/commands/compact.ts`        |
| [ ]    | `/mission` — show current mission status          | `src/commands/mission.ts`        |
| [ ]    | `/mission-list` — list all missions               | `src/commands/mission-list.ts`   |
| [ ]    | `/mission-resume <id>` — restore a mission        | `src/commands/mission-resume.ts` |
| [ ]    | `/todos` — full-screen todo overlay               | `src/commands/todos.ts`          |

---

## TUI

| Status | Feature                                                    | Notes                                                                |
| ------ | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| [-]    | AskUser render — rich TUI display for questionnaire output | Not planned                                                          |
| [ ]    | Todo TUI — proper inline/overlay todo display              | System reminder hook injects todo text, but no dedicated TUI overlay |

---

## Hooks

| Status | Hook                                                           | Location                        |
| ------ | -------------------------------------------------------------- | ------------------------------- |
| [x]    | Shell hook — command risk assessment                           | `src/hooks/shell.ts`            |
| [x]    | Spec mode hook — spec mode enforcement                         | `src/hooks/spec-mode.ts`        |
| [x]    | System reminder hook — prompt injection with todo reminders    | `src/hooks/system-reminder.ts`  |
| [ ]    | Notification hook — completion/status notification integration | `src/hooks/notification.ts`     |
| [ ]    | Mode policy enforcement — unified tool gating                  | `src/hooks/mode-policy.ts`      |
| [ ]    | Mission reminder — orchestrator/worker prompt injection        | `src/hooks/mission-reminder.ts` |
| [ ]    | Todo widget — persistent todo display                          | `src/hooks/todo-widget.ts`      |

---

## Infra / Utils

| Status | Feature                                          | Location                                                            |
| ------ | ------------------------------------------------ | ------------------------------------------------------------------- |
| [x]    | Subagent discovery                               | `src/subagents/agents.ts`                                           |
| [x]    | Subagent render — result formatting              | `src/subagents/render.ts`                                           |
| [x]    | Subagent runner                                  | `src/subagents/runner.ts`                                           |
| [x]    | Subagent types                                   | `src/subagents/types.ts`                                            |
| [x]    | Subagent utilities                               | `src/subagents/utilities.ts`                                        |
| [x]    | Subagent validation                              | `src/subagents/validate.ts`                                         |
| [x]    | Todo state management                            | `src/utils/todo-state.ts`                                           |
| [x]    | Spec mode state                                  | `src/utils/spec-state.ts`                                           |
| [x]    | Tool utilities                                   | `src/utils/tool.ts`                                                 |
| [x]    | Typebox utilities                                | `src/utils/typebox.ts`                                              |
| [x]    | Search provider helpers (Exa, Firecrawl, Tavily) | `src/utils/exa.ts`, `src/utils/firecrawl.ts`, `src/utils/tavily.ts` |
| [ ]    | Mission artifacts — worker file helpers          | `src/mission/artifacts.ts`                                          |
| [ ]    | Mission conflict resolution                      | `src/mission/conflict.ts`                                           |
| [ ]    | Mission filesystem helpers                       | `src/mission/fs.ts`                                                 |
| [ ]    | Mission milestones tracker                       | `src/mission/milestones.ts`                                         |
| [ ]    | Mission types                                    | `src/mission/types.ts`                                              |
| [ ]    | Mission validation contract                      | `src/mission/validation.ts`                                         |
| [ ]    | Mode policy table                                | `src/utils/mode-policy.ts`                                          |
| [ ]    | URL validation                                   | `src/utils/url-validation.ts`                                       |

---

## Prompts

| Status | Prompt                                | Location                 |
| ------ | ------------------------------------- | ------------------------ |
| [x]    | Spec mode prompt fragment             | `src/prompts/spec.ts`    |
| [ ]    | Mission orchestrator fragment         | `src/prompts/mission.ts` |
| [ ]    | Mission worker fragment               | `src/prompts/mission.ts` |
| [ ]    | Mode-specific system prompt fragments | `src/prompts/modes.ts`   |

---

## Config

| Status | Feature    | Location                   |
| ------ | ---------- | -------------------------- |
| [x]    | Settings   | `src/config/settings.ts`   |
| [x]    | Shell risk | `src/config/shell-risk.ts` |

---

_Last updated: `src/` scan on 2026-06-04_
