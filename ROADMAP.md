# Cradle Extension Roadmap

> Simple task tracker for the cradle pi extension.

---

## Tools

| Status | Tool                                               | Location                                                                                                                        |
| ------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [x]    | Bash — shell command execution                     | `cradle/tools/bash.ts`                                                                                                          |
| [x]    | Edit — text replacement in files                   | `cradle/tools/edit.ts`                                                                                                          |
| [x]    | Glob — file path pattern matching                  | `cradle/tools/glob.ts`                                                                                                          |
| [x]    | Grep — file content search                         | `cradle/tools/grep.ts`                                                                                                          |
| [x]    | Ls — directory listing                             | `cradle/tools/ls.ts`                                                                                                            |
| [x]    | Read — file reading                                | `cradle/tools/read.ts`                                                                                                          |
| [x]    | Write — file writing                               | `cradle/tools/write.ts`                                                                                                         |
| [x]    | Todo — task list updates                           | `cradle/tools/todo.ts`                                                                                                          |
| [x]    | Subagent — single/parallel/chain subagent dispatch | `cradle/tools/subagent.ts`, `cradle/tools/subagent/subagent-modes.ts`, `cradle/tools/subagent/subagent-render.ts`               |
| [x]    | Discover Agents — list available subagents         | `cradle/tools/discover-agents.ts`                                                                                               |
| [x]    | Advisor — expert advisor consultation              | `cradle/tools/advisor.ts`, `cradle/tools/advisor/runner.ts`, `cradle/tools/advisor/prompt.ts`, `cradle/tools/advisor/render.ts` |
| [x]    | Web Fetch — safe URL fetch with SSRF prevention    | `cradle/tools/webfetch/index.ts`, `cradle/tools/webfetch/providers/`                                                            |
| [x]    | Web Search — provider-backed search                | `cradle/tools/websearch/index.ts`, `cradle/tools/websearch/providers/`                                                          |
| [ ]    | CreateMission — mission metadata scaffolding       | `cradle/tools/create-mission.ts`                                                                                                |
| [ ]    | EndFeatureRun — worker completion boundary         | `cradle/tools/end-feature-run.ts`                                                                                               |
| [ ]    | ExitSpecMode — spec approval handoff               | `cradle/tools/exit-spec-mode.ts`                                                                                                |
| [ ]    | GenerateDroid — custom agent definition writer     | `cradle/tools/generate-droid.ts`                                                                                                |
| [ ]    | Skill bridge — pi skill invocation                 | `cradle/tools/skill.ts`                                                                                                         |
| [ ]    | ToolSearch — deferred tool activation              | `cradle/tools/tool-search.ts`                                                                                                   |

---

## Commands

| Status | Command                                           | Location                            |
| ------ | ------------------------------------------------- | ----------------------------------- |
| [x]    | `/settings` — extension settings editor           | `cradle/commands/settings.ts`       |
| [x]    | `/spec` — spec mode toggle                        | `cradle/commands/spec.ts`           |
| [x]    | `/stats` — session statistics                     | `cradle/commands/stats.ts`          |
| [ ]    | `/compact` — compact current conversation/session | `cradle/commands/compact.ts`        |
| [ ]    | `/mission` — show current mission status          | `cradle/commands/mission.ts`        |
| [ ]    | `/mission-list` — list all missions               | `cradle/commands/mission-list.ts`   |
| [ ]    | `/mission-resume <id>` — restore a mission        | `cradle/commands/mission-resume.ts` |
| [ ]    | `/todos` — full-screen todo overlay               | `cradle/commands/todos.ts`          |

---

## TUI

| Status | Feature                                                    | Notes                                                                |
| ------ | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| [-]    | AskUser render — rich TUI display for questionnaire output | Not planned                                                          |
| [ ]    | Todo TUI — proper inline/overlay todo display              | System reminder hook injects todo text, but no dedicated TUI overlay |

---

## Hooks

| Status | Hook                                                           | Location                           |
| ------ | -------------------------------------------------------------- | ---------------------------------- |
| [x]    | Shell hook — command risk assessment                           | `cradle/hooks/shell.ts`            |
| [x]    | Spec mode hook — spec mode enforcement                         | `cradle/hooks/spec-mode.ts`        |
| [x]    | System reminder hook — prompt injection with todo reminders    | `cradle/hooks/system-reminder.ts`  |
| [ ]    | Notification hook — completion/status notification integration | `cradle/hooks/notification.ts`     |
| [ ]    | Mode policy enforcement — unified tool gating                  | `cradle/hooks/mode-policy.ts`      |
| [ ]    | Mission reminder — orchestrator/worker prompt injection        | `cradle/hooks/mission-reminder.ts` |
| [ ]    | Todo widget — persistent todo display                          | `cradle/hooks/todo-widget.ts`      |

---

## Infra / Utils

| Status | Feature                                          | Location                                                                     |
| ------ | ------------------------------------------------ | ---------------------------------------------------------------------------- |
| [x]    | Subagent discovery                               | `cradle/subagents/agents.ts`                                                 |
| [x]    | Subagent render — result formatting              | `cradle/subagents/render.ts`                                                 |
| [x]    | Subagent runner                                  | `cradle/subagents/runner.ts`                                                 |
| [x]    | Subagent types                                   | `cradle/subagents/types.ts`                                                  |
| [x]    | Subagent utilities                               | `cradle/subagents/utilities.ts`                                              |
| [x]    | Subagent validation                              | `cradle/subagents/validate.ts`                                               |
| [x]    | Todo state management                            | `cradle/utils/todo-state.ts`                                                 |
| [x]    | Spec mode state                                  | `cradle/utils/spec-state.ts`                                                 |
| [x]    | Tool utilities                                   | `cradle/utils/tool.ts`                                                       |
| [x]    | Typebox utilities                                | `cradle/utils/typebox.ts`                                                    |
| [x]    | Search provider helpers (Exa, Firecrawl, Tavily) | `cradle/utils/exa.ts`, `cradle/utils/firecrawl.ts`, `cradle/utils/tavily.ts` |
| [ ]    | Mission artifacts — worker file helpers          | `cradle/mission/artifacts.ts`                                                |
| [ ]    | Mission conflict resolution                      | `cradle/mission/conflict.ts`                                                 |
| [ ]    | Mission filesystem helpers                       | `cradle/mission/fs.ts`                                                       |
| [ ]    | Mission milestones tracker                       | `cradle/mission/milestones.ts`                                               |
| [ ]    | Mission types                                    | `cradle/mission/types.ts`                                                    |
| [ ]    | Mission validation contract                      | `cradle/mission/validation.ts`                                               |
| [ ]    | Mode policy table                                | `cradle/utils/mode-policy.ts`                                                |
| [ ]    | URL validation                                   | `cradle/utils/url-validation.ts`                                             |

---

## Prompts

| Status | Prompt                                | Location                    |
| ------ | ------------------------------------- | --------------------------- |
| [x]    | Spec mode prompt fragment             | `cradle/prompts/spec.ts`    |
| [ ]    | Mission orchestrator fragment         | `cradle/prompts/mission.ts` |
| [ ]    | Mission worker fragment               | `cradle/prompts/mission.ts` |
| [ ]    | Mode-specific system prompt fragments | `cradle/prompts/modes.ts`   |

---

## Config

| Status | Feature    | Location                      |
| ------ | ---------- | ----------------------------- |
| [x]    | Settings   | `cradle/config/settings.ts`   |
| [x]    | Shell risk | `cradle/config/shell-risk.ts` |

---

_Last updated: `cradle/` scan on 2026-06-04_
