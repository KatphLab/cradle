---
name: code-optimizer
description: Optimize existing code files in place. Use for requests to simplify code, reduce LOC, remove redundant/dead code, refactor a file, or optimize changed source files from git status.
---

# Code Optimizer

Reduce and simplify existing code in place while preserving intended behavior.

## Target selection

1. If the user names files, optimize only those files.
2. Otherwise run `git status --short` and select changed hand-written source files.
3. Skip generated files, snapshots, lockfiles, docs, assets, build output, vendored code, and tooling config unless explicitly requested.
4. If targets are numerous, mixed, deleted, or ambiguous, ask which files to optimize.
5. Do not edit outside the target set without approval.

## Rules

- Preserve public behavior, APIs, data shapes, errors, logging, security checks, and framework/plugin contracts unless asked to change them.
- Prefer targeted simplification over stylistic rewrites.
- Do not remove code that may be a public export, dynamic dispatch path, hook, fixture, or contract.
- Respect repository instructions and forbidden files.
- Do not overwrite, discard, stage, commit, or reset user changes unless explicitly asked.

## Workflow

### 1. Inspect

For each target file:

- Read the full relevant file.
- Check tests, imports, exports, and call sites when needed.
- Record baseline with `wc -l <file>` and `git diff -- <file>`.

### 2. Simplify

Make only changes that reduce code or redundancy while improving readability:

- remove duplicated branches, conditions, helpers, types, constants, wrappers, unused imports, unreachable code, obsolete comments, and unused private code
- inline tiny private helpers when they obscure more than clarify
- merge equivalent control-flow paths
- replace verbose loops with clear built-ins when readability improves
- collapse unnecessary temporaries, redundant comments, and redundant type annotations
- use data-driven mappings instead of repeated conditionals when shorter and clearer

Keep separation that supports testability, domain clarity, error handling, performance, or security review. Do not code-golf.

### 3. Validate

- Run approved formatting/lint fixes only.
- Run narrow relevant checks first, then the repo gate when practical.
- Inspect final `git diff -- <file>` and `wc -l <file>`.
- If checks fail, fix the root cause or report what remains.

## Final response

State:

- files optimized
- main simplifications
- LOC before/after when available
- checks run and results
- skipped files or safety concerns
