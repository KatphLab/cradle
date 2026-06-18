# Plan: Replace `edit` with hash-anchored line editing

## Objective

Replace Cradle's current exact-string `edit` implementation with a hash-anchored line-range editor while keeping the public tool name `edit`. The new implementation should make edits by line number plus endpoint content hashes, not by reproducing `oldText` blocks.

This is a clean replacement, not a backwards-compatibility layer. The existing `oldText`/`newText` schema and `createEditToolDefinition` delegation should be removed.

## Desired tool contract

### `read`

Update `read` so text output includes stable line hashes alongside line numbers.

Example output:

```text
1:5c2a| import path from 'node:path'
2:e3b0|
3:a91f| export function example(): string {
4:7d44|   return 'ok'
5:2b2c| }
```

Rules:

- Hash the line content after trimming trailing whitespace only.
- Preserve the visible line content exactly after the `|` separator.
- Keep image behavior unchanged.
- Keep existing truncation semantics unless implementation evidence shows Pi's built-in `read` cannot be reused safely.
- Use a hash width large enough to avoid routine collisions; prefer 6 hex chars unless tests demonstrate another width is better.

### `edit`

Replace the existing `edit` parameters with line-range edits:

```ts
{
  path: string
  edits: {
    from: number
    fromHash: string
    to: number
    toHash: string
    newText: string
  }
  ;[]
}
```

Semantics:

- `from` and `to` are 1-indexed inclusive line numbers.
- `fromHash` must match the current hash of line `from`.
- `toHash` must match the current hash of line `to`.
- `newText` replaces the complete inclusive range.
- `newText: ''` deletes the range.
- `newText` may contain multiple lines.
- The tool re-reads the file immediately before applying edits.
- The whole batch is atomic: if any edit is invalid, no changes are written.
- Multiple edits in one call are allowed, but ranges must not overlap.
- Apply valid edits from bottom to top so earlier line numbers remain stable while mutating the in-memory line array.

Out of scope for the replacement:

- Do not keep `oldText`/`newText` support.
- Do not register a second `edit_lines` tool.
- Do not add a legacy fallback to Pi's built-in exact-string edit tool.

## Implementation steps

### 1. Add shared hashline utilities

Create a focused utility module, likely `cradle/utils/hashlines.ts`.

Functions to include:

- `hashLineContent(line: string): string`
  - Trim trailing whitespace.
  - Hash with SHA-256 or another stable Node crypto hash.
  - Return the configured short hex prefix.

- `formatHashline(lineNumber: number, line: string): string`
  - Return `${lineNumber}:${hash}| ${line}`.

- `splitTextPreservingFinalNewline(content: string)` or equivalent helpers.
  - The edit implementation must preserve whether the original file ended with a final newline.
  - Normalize internal editing to line arrays without accidentally adding/removing final newline.

- `validateLineRangeEdit(...)`
  - Check positive integer line numbers.
  - Check `from <= to`.
  - Check range exists.
  - Check endpoint hashes.
  - Return precise, user-actionable errors.

Testing requirements:

- Same visible line with different trailing whitespace hashes identically.
- Different meaningful content hashes differently.
- Empty line hash is stable.
- Final newline preservation is covered.

### 2. Update `read` output

File: `cradle/tools/read.ts`

Preferred approach:

1. Keep permission normalization through `assertPermission`.
2. Reuse Pi's read implementation only if its returned text can be transformed reliably.
3. For text files, transform returned line output into hashline output.
4. For image results, return unchanged.

Important details to verify in tests:

- Existing `offset` and `limit` still map to correct real file line numbers.
- Truncated reads still show correct line hashes for the returned range.
- Large-file limits still protect context size.
- Binary/image behavior is unaffected.

If Pi's built-in read output already includes line numbers or truncation markers that make transformation brittle, implement Cradle's own text-read path instead:

- Read file with `node:fs/promises`.
- Detect supported image extensions and delegate those to Pi's read tool.
- For text, enforce the same 2000-line / 50KB cap described in the current tool description.
- Apply `offset` and `limit` before formatting hashlines.

Update the `read` description to say that text output is hashline formatted and edits should use those hashes.

### 3. Replace `edit` schema and implementation

File: `cradle/tools/edit.ts`

Remove:

- `createEditToolDefinition` import.
- Exact-string `EditToolParameters` shape.
- Delegation to `createEditToolDefinition(context.cwd)`.
- Prompt guidance about `oldText` uniqueness and whitespace-tolerant matching.

Add:

- New `EditToolParameters` with `{ from, fromHash, to, toHash, newText }` ranges.
- Direct filesystem implementation using `node:fs/promises`.
- Permission check via `assertPermission(filePath, context.cwd, 'write')`.
- Existing approval gate behavior via `checkFileBlocked`.
- Existing subagent bypass via `isCradleSubagentProcess()`.
- Existing deferred operation behavior via `createDeferredOperationResult(...)`.
- Existing rendering with `renderToolCallWithMode('edit', ...)`.

Validation behavior:

- Reject empty `edits`.
- Reject non-integer, zero, or negative line numbers.
- Reject `from > to`.
- Reject ranges outside file bounds.
- Reject overlapping ranges.
- Reject endpoint hash mismatches with an error like:

```text
edit: line 42 hash mismatch for fromHash — claimed "abc123", actual "def456".
Current line 42: "  return value"
Read the file again and retry with the current hash.
```

- Reject hash values that are empty or malformed.
- If a line range is valid but `newText` has no final newline, do not force one inside the replacement; final file newline preservation should be deliberate and tested.

Atomic write behavior:

1. Read current file content.
2. Validate every edit against the current content.
3. Build the next content in memory.
4. Write only after all validation passes.
5. Return a concise success result including the number of edits and path.

### 4. Update approval replay integration

File: `cradle/tools/approval.ts`

The approval tool imports `executeApprovedEdit` and replays deferred edit operations. Update it to use the new `EditToolParameters` shape.

Tasks:

- Ensure deferred edit payloads preserve line-range parameters.
- Update any validation/type guards for deferred operations if they assume `oldText`.
- Keep operation name as `edit`.
- Ensure approved replays call the new direct filesystem implementation.

### 5. Update mode hooks if needed

Files to inspect/update:

- `cradle/hooks/spec-mode.ts`
- `cradle/hooks/orchestrator-mode.ts`

Expected minimal change:

- Both currently gate by tool name `edit`, so the mode logic should remain conceptually correct.
- Update tests/fixtures that construct edit tool inputs, because `edit` no longer accepts `oldText`.

### 6. Update prompt snippets and guidelines

File: `cradle/tools/edit.ts`

New tool description should be explicit:

```text
Modify existing text files by replacing inclusive line ranges anchored by current line hashes from the read tool. Re-read the target file before editing if hashes may be stale.
```

New prompt guidance:

- Read the target file before editing.
- Use the exact line numbers and hashes shown by `read`.
- Prefer one `edit` call with multiple non-overlapping ranges for related changes in one file.
- If any hash mismatch occurs, read the file again and retry with current hashes.
- Do not guess hashes.
- Use `write` only for new files or deliberate whole-file replacement.

Update `write` prompt guidance in `cradle/tools/write.ts` if it mentions old exact-string edit behavior indirectly. It can continue saying to use `edit` for targeted changes.

### 7. Update tests

Primary test files:

- `cradle/tools/__tests__/edit.test.ts`
- `cradle/tools/__tests__/tool-output-mode-render.test.ts`
- `cradle/hooks/__tests__/spec-mode.test.ts`
- `cradle/hooks/__tests__/orchestrator-mode.test.ts`
- Any approval/deferred-operation tests that use edit payloads.

Add/replace edit tests for:

1. Replaces a single line when endpoint hash matches.
2. Replaces multiple lines with multiple lines.
3. Deletes a line range with `newText: ''`.
4. Applies multiple non-overlapping edits atomically.
5. Applies bottom-to-top so line numbers are stable.
6. Rejects stale `fromHash` and leaves file unchanged.
7. Rejects stale `toHash` and leaves file unchanged.
8. Rejects overlapping ranges and leaves file unchanged.
9. Rejects out-of-bounds ranges and leaves file unchanged.
10. Preserves final newline when appropriate.
11. Preserves no-final-newline files when appropriate.
12. Keeps approval blocking/deferred operation behavior intact.
13. Keeps subagent approval bypass intact.
14. Keeps render behavior intact.

Add read tests for:

1. Text output includes `line:hash| content`.
2. Hash line numbers honor `offset`.
3. `limit` returns the expected hashline subset.
4. Trailing whitespace does not affect the hash.
5. Empty lines are represented clearly.
6. Image reads remain unaffected if currently covered by Pi delegation.

### 8. Update documentation

Files likely needing updates:

- `README.md`
- Possibly `CODING_GUIDELINES.md` only if it contains tool usage rules; do not edit if not needed.

README updates:

- Replace the File Tools section's exact-string edit description with hash-anchored line-range editing.
- Mention that `read` emits hashlines for text files.
- Explain that `edit` rejects stale hashes and requires re-reading after mismatch.

Do not edit tooling configuration files.

### 9. Run validation

Follow repo rules and use pnpm only.

Suggested sequence:

```bash
pnpm test -- cradle/tools/__tests__/edit.test.ts cradle/tools/__tests__/tool-output-mode-render.test.ts
pnpm test -- cradle/hooks/__tests__/spec-mode.test.ts cradle/hooks/__tests__/orchestrator-mode.test.ts
pnpm typecheck
pnpm check
```

If formatting/linting fails:

```bash
pnpm fix
pnpm check
```

The work is not complete until `pnpm check` passes.

## Edge cases and decisions

### Hash width

Use 6 hex chars by default. It is still compact but safer than 3 hex chars. Keep the width in one constant so it can be adjusted deliberately.

### Hash normalization

Only trim trailing whitespace before hashing. Do not trim leading whitespace; indentation is meaningful code content.

### Line endings

Normalize editing internally around `\n`, but preserve original file line ending style if practical:

- If the file contains `\r\n`, write `\r\n`.
- Otherwise write `\n`.

At minimum, tests must prevent accidental content corruption.

### Insertions

Do not add a separate insertion schema in the first implementation. Insert by replacing an anchored nearby range with text that includes the original line plus inserted content. This keeps the schema smaller and forces every mutation to anchor to existing content.

A future insertion-specific API can be considered only if real usage shows the replacement pattern is too awkward.

### Empty files

The first implementation may reject editing empty files and instruct the agent to use `write` for new/empty whole-file content. This is clean and avoids unanchored edits.

### Generated files and binary files

`edit` should operate on text files. If decoding fails or NUL bytes suggest binary content, reject with a clear error and do not write.

## Acceptance criteria

- `edit` no longer accepts `oldText`/`newText` exact-string replacement entries.
- `edit` accepts only hash-anchored line ranges.
- `read` provides the line numbers and hashes needed by `edit`.
- Hash mismatches produce precise errors with actual hash and current line content.
- Failed validation never partially writes a file.
- Approval/deferred replay still works for `edit`.
- Spec/orchestrator restrictions still block `edit` by mode as before.
- Documentation describes hashline editing accurately.
- `pnpm check` passes.

## Implementation order

1. Implement hashline utility with unit tests.
2. Update `read` text output and tests.
3. Replace `edit` schema and direct filesystem implementation.
4. Update approval replay and deferred-operation tests.
5. Update mode/render tests and prompt guidance.
6. Update README documentation.
7. Run targeted tests.
8. Run `pnpm check` and fix root causes.
