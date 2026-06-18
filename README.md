# cradle

A **pi extension package** providing tools, commands, hooks, built-in agents, and skills for the pi coding agent.

## Pi Manifest

Registered in `package.json`:

```json
"pi": {
  "extensions": ["./cradle"],
  "skills": ["./skills"]
}
```

## Capabilities

### Permission System

Cradle adds a file-level permission layer on top of pi's built-in tools. Every `read`, `write`, and `bash` call passes through `assertPermission`, which checks project-configured directory allowlists. The CWD always has full permissions. For reads, SDK package directories, the cradle extension itself, `/tmp`, and standard config paths are implicitly allowed without explicit configuration. Any operation outside allowed directories throws a permission-denied error directing the user to `/cradle-settings`.

Permissions are configured per-project via `/cradle-settings`, which opens a custom TUI editor where users manage directory read/write/bash grants, subagent model assignments (low/medium/high risk), the advisor and compaction models, API keys for web providers (Firecrawl, Tavily, Exa, Jina), the system reminder token threshold, and reminder display toggle. Settings persist to `.pi/cradle/settings.json` (project) and `~/.pi/cradle/settings.json` (global).

### Shell Risk Classification

The `bash` tool introduces a dual-layer risk model. The model declares a `riskLevel` (low/medium/high/critical) and `riskReason` for every command. Independently, cradle pattern-matches the command string against `SHELL_RISK_PATTERNS.json` from the project root. If the detected risk level exceeds the declared level, the detected level wins. Commands classified as high or critical trigger user confirmation before execution. A shell lifecycle hook also surface-notifies the user when high/critical commands are detected regardless of the tool's own confirmation flow.

Pattern definitions live in a JSON schema (`cradle/schema/shell-risk-patterns.schema.json`) and are cached per-project directory for performance.

### File Tools (read, edit, write)

All file tools wrap pi's built-in definitions with permission checks and path normalization, but `read`, `edit`, and `write` add significant customization:

- **read** returns text files as hashlines in the form `line:hash| content`. The 6-character hash anchors the visible line content for follow-up edits while preserving line text after `| `.

- **edit** applies batched, hash-anchored line-range replacements. Each edit entry uses `{ from, fromHash, to, toHash, newText }`; the endpoint hashes must match the current `read` output, all ranges are validated atomically, and non-overlapping edits are applied bottom-to-top.

- **write** validates agent definition files. When the target path is a `.md` file inside an `agents/` directory, cradle parses the content through `validateAgent` and rejects invalid definitions with structured errors. It also carries prompt guidelines steering the model toward hash-anchored `edit` for partial file changes.

- **ls** adds an `ignore` parameter for exact-match entry filtering, layered on pi's built-in listing via custom filesystem operation injection.

### Multi-Mode Subagent Dispatch

The `subagent` tool supports three dispatch modes on a single tool:

- **single** — one agent, one task.
- **parallel** — an array of `{agent, task}` entries dispatched simultaneously.
- **chain** — sequential execution where each step's output is available as `{previous}` in the next step's task.

Agent discovery scans three sources: extension-bundled agents (`cradle/agents/`), project agents (`.pi/agents/`), and user agents (`~/.config/pi/agents/`). The `discover-agents` tool surfaces the full catalog with source labels and available tools per agent. Built-in agents are defined as Markdown prompt files:

| Agent                 | Purpose                                          |
| --------------------- | ------------------------------------------------ |
| `builder`             | General-purpose code generation                  |
| `iterative-retriever` | Bounded iterative retrieval across files and web |
| `reviewer`            | Code review and feedback                         |
| `web-fetcher`         | URL fetching with content extraction             |
| `web-searcher`        | Provider-backed web search with result synthesis |

### Multi-Agent Deliberation (advisor + council)

- **Advisor** spawns a single expert subagent with a structured context (what you're stuck on, relevant code, error messages, what you've tried, file paths to examine). It runs the subagent with read-only tool access and returns a focused single-turn response. Has custom TUI rendering for compact display.

- **Council** convenes four voices — Architect, Skeptic, Pragmatist, and Critic — each deliberating independently in isolated subagent contexts. A synthesis agent merges all four perspectives into a structured verdict. Accepts a `complexity` parameter (low/medium/high) for model selection. Has custom TUI rendering for multi-voice results.

Both are custom implementations with their own runners, prompt templates, and render functions. The council and iterative-retrieval designs were inspired by [github.com/affaan-m/ECC](https://github.com/affaan-m/ECC).

### Iterative Retrieval

Performs bounded, multi-cycle retrieval across local files and the web. The tool delegates to the `iterative-retriever` subagent with task parameters including search paths, keywords, exclusions, max cycles, minimum relevance threshold, and result limit. After execution, it parses structured sections from the subagent output: Relevant Paths (with relevance scores and reasons), Web Sources, Key Findings, Missing Gaps, Suggested Next Actions, and cycle count. All parsed into structured `details` for downstream consumers.

### Web Access

Two public-facing tools delegate to subagents, keeping raw page content and search results out of the main agent context:

- **Web Fetch** — dispatches to the `web-fetcher` subagent. The subagent uses `web_fetch_internal`, a raw fetcher with a multi-provider fallback chain (Tavily → Firecrawl → Exa → Jina → native fetch), URL caching with configurable max-age, SSRF protection via `validateUrl` (blocks private IPs, localhost, link-local), and chain mode with `{previous}` placeholder support.

- **Web Search** — dispatches to the `web-searcher` subagent. The subagent uses `web_search_internal`, a raw search tool with provider fallback (Tavily → Firecrawl → Exa), domain inclusion/exclusion, time-based search (`tbs`), source filtering, and country targeting.

Both internal tools require API keys configured through `/cradle-settings`.

### Todo State Management

The `todo` tool is a fully custom state machine. It reconstructs the current todo list from session message history, computes deltas (added, removed, status-changed items) against the previous list, and formats both the current list and change summary for display. The system-reminder hook reuses this state to inject active-task reminders when work continues past the token threshold.

### System Reminder Injection

The `system-reminder` hook intercepts `<system-reminder>` blocks in the system prompt, strips them for display, and re-injects them as periodic reminders. It tracks streamed token count per assistant turn. When the count exceeds the configured threshold (default 6000 tokens, configurable 500–50000), it aborts the current generation and schedules a follow-up user message with the reminder content plus a continuation prompt ("If you are stuck, ask the advisor. Otherwise, continue."). Active todo items are appended to the reminder automatically.

A token budget guard warns when the extracted reminder exceeds 500 tokens, and a settings toggle allows disabling reminder display entirely.

### Modes

Cradle introduces two structured interaction modes, each with its own command, lifecycle hooks, system prompt injection, and tool restrictions:

**Spec mode** (`/spec`) is plan-first. The system prompt instructs the agent to analyze and present plans before writing code. The mode restricts tools to read-only plus `write` limited to `.pi/specs/*.md` files. Toggling the mode persists state as a custom session entry so it survives session reloads.

**Orchestrator mode** (`/orchestrator`) is delegation-only. `bash`, `edit`, and `write` are blocked entirely. The mode restricts tools to inspection, search, and subagent dispatch. After each agent turn, an auto-review loop fires: the agent receives a review prompt asking it to assess whether the user's request is fully satisfied and respond with `CRADLE_ORCHESTRATOR_DECISION: STOP` or `CRADLE_ORCHESTRATOR_DECISION: CONTINUE`. If CONTINUE, the agent gets one follow-up turn to address gaps, then reviews again. The loop caps at 2 continuation cycles. If the agent needs to ask the user, it signals `CRADLE_ORCHESTRATOR_DECISION: ASK_USER` and the loop exits.

Both modes persist across sessions and auto-restore on session start.

### Context Compaction

The `compaction` hook intercepts `session_before_compact` and allows specifying a dedicated compaction model independent of the main conversation model. When configured via `/cradle-settings` with a `provider/model` string, cradle resolves the model through the registry, fetches its API key, and runs compaction through pi's `compact()` function with custom instructions and the agent's thinking level.

## Commands

| Command            | Description                  |
| ------------------ | ---------------------------- |
| `/spec`            | Enter spec mode for planning |
| `/orchestrator`    | Enter orchestrator mode      |
| `/cradle-settings` | Configure Cradle settings    |

## Credits

The council and iterative-retrieval implementations were inspired by [ECC](https://github.com/affaan-m/ECC) by [@affaan-m](https://github.com/affaan-m).

## AI Agent Guidelines

See [AGENTS.md](./AGENTS.md) for coding rules and conventions. See [ROADMAP.md](./ROADMAP.md) for planned work.

## License

MIT
