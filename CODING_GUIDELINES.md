# Coding Guidelines

## Core Principles

- Reuse existing modules and utilities when possible.
- Prefer the smallest correct change.
- When replacing behavior, remove the obsolete path instead of keeping parallel logic.
- Keep edits focused and consistent with local patterns.
- Do not add `TODO` or `FIXME` without a linked issue. The `unicorn/expiring-todo-comments` rule enforces that every `TODO` or `FIXME` comment includes an expiration date (e.g. `TODO [2026-01-01]: …`).
- This repo is TypeScript-only. Do not write `.js` files.
- Every file must be a self-contained module. Do not rely on global augmentation across files.

---

## TypeScript and Type Safety

### Annotations and inference

- Do not let any value, parameter, or return type implicitly widen to `any`. Annotate where the compiler cannot infer.
- Never assume a value is non-null without evidence. Check before using.
- Do not use `this` in plain functions. Use class methods or arrow functions instead.

### Optional properties

Do not assign `undefined` explicitly to an optional property. Omit the key entirely.

```ts
// BAD
const obj: { foo?: string } = { foo: undefined }

// GOOD
const obj: { foo?: string } = {}
```

### Index and array access

Accessing an array element or a record by key may return `undefined`. Always guard the result before using it.

```ts
// BAD
const name = items[0].name

// GOOD
const item = items[0]
if (item !== undefined) {
  console.warn(item.name)
}
```

When a type uses an index signature, access its properties with bracket notation, not dot notation.

### Control flow

- Every non-void function must return a value on every code path. Do not leave paths that fall off without returning.
- Remove unreachable code. Do not leave dead branches.
- Every `switch` case must end with `break`, `return`, or `throw`. No silent fallthrough.

### Class inheritance

When a method overrides a method from a base class, mark it with the `override` keyword.

### Unused code

Remove unused local variables and parameters. If a parameter must exist in the signature but is intentionally unused, prefix its name with `_`.

### Type assertions

Do not cast with `as SomeType` unless the compiler cannot narrow the type through any other means. When an assertion is truly necessary, add a comment explaining why it is safe. Prefer writing a proper type guard function instead.

```ts
// BAD
const value = (response as { data: string }).data

// GOOD — narrow with a guard
function hasData(v: unknown): v is { data: string } {
  return (
    typeof v === 'object' &&
    v !== null &&
    'data' in v &&
    typeof (v as Record<string, unknown>)['data'] === 'string'
  )
}
if (hasData(response)) {
  console.warn(response.data)
}
```

### Explicit types over inference shortcuts

Do not derive a type from a local function using `ReturnType<typeof myFn>`. Define and export an explicit named type instead. This keeps intent visible at the call site and avoids fragile coupling to implementation details.

### Template literals

Only interpolate numbers into template literals. Do not interpolate booleans, `null`, `undefined`, or `any`-typed values. Convert or guard first.

### Array sorting

Always pass an explicit comparator function when sorting non-string arrays. The default sort stringifies elements and produces incorrect results for numbers and objects.

### Readonly properties

Mark class properties that are never reassigned after construction as `readonly`.

---

## Imports and Exports

### Type-only imports and exports

When an import is used only as a type, add the `type` qualifier inline. Do the same for type-only re-exports. This keeps runtime bundles free of type-only references.

```ts
// BAD — no qualifier on a type-only import
import { MyFunction, MyOptions } from './myModule'

// GOOD — inline type qualifier on the type-only specifier
import { MyFunction, type MyOptions } from './myModule'
```

### No barrel files or pass-through re-exports

- Do not create files whose sole purpose is to re-export from other modules.
- Do not use `export *`.
- Do not write `export { Foo } from './somewhere'` in a file that adds nothing else.
- Consumers must import directly from the source module.

### Import hygiene

- All imports must appear at the top of the file, before any other code.
- Do not import from the same module more than once; merge specifiers into a single import.
- Remove every unused import.

### No inline lint suppressions

Do not suppress linting with `// eslint-disable` comments anywhere in source files. Fix the root cause. If a suppression has become stale and no longer covers an active finding, remove it.

---

## Module Architecture and Boundaries

The project is divided into layers. The following dependency rules are strictly enforced:

| Layer                    | May depend on                                                             |
| ------------------------ | ------------------------------------------------------------------------- |
| `cradle/lib/**`          | `cradle/lib/**`, `cradle/utils/**`, `cradle/config/**`, `cradle/types/**` |
| `cradle/utils/**`        | `cradle/utils/**`, `cradle/config/**`, `cradle/types/**`                  |
| `cradle/config/**`       | `cradle/config/**`, `cradle/types/**`                                     |
| `cradle/types/**`        | `cradle/types/**`                                                         |
| `cradle/**` (production) | Must not import from `__tests__`                                          |

Violating these boundaries is a lint error that blocks merging.

---

## Code Style and Complexity

### Naming

- Do not abbreviate identifiers unless the abbreviation is in the approved list: `args`, `env`, `err`, `fn`, `temp`.
- Prefix intentionally unused parameters and destructured array items with `_`.
- File names must match their import path casing exactly. Inconsistent casing across platforms is a compile error.

### Object and string literals

- Always use shorthand property syntax: `{ name }` not `{ name: name }`.
- Always use template literals for string interpolation; do not concatenate with `+`.

### Complexity and size limits

Keep functions simple and focused. The hard limits are:

| What                  | Limit                                         |
| --------------------- | --------------------------------------------- |
| Cyclomatic complexity | 10 branches                                   |
| Cognitive complexity  | 12                                            |
| Function body length  | 80 lines (excluding blank lines and comments) |
| Function parameters   | 7                                             |

When a function approaches these limits, extract helpers or restructure control flow. Do not raise the limits.

### Console output

Do not use `console.log` or `console.info` in production code. Use `console.warn` for recoverable anomalies and `console.error` for genuine errors only.

### Declaration order

Do not reference a class, variable, enum, or type alias before it is declared in the file. Function declarations (hoisted) are exempt from this rule.

---

## Testing and Quality

- Test any change to: state transitions, side effects (file I/O, network, environment), data contract or output shape, and error/edge cases.
- For every behavior change, add or update tests covering both the success path and the failure path.
- Minimum contract: at least one happy-path assertion and one failure/error-path assertion per changed behavior.
- Test public APIs only, using varied data scenarios. Do not test internal helper functions directly. If a helper has complex logic worth testing, test it through the public API that consumes it.
- Do not leave skipped or todo tests. Enforced by `no-restricted-syntax` (catches `it.skip`, `test.todo`, etc.). Note: test files override `no-restricted-syntax` for parent-import flexibility, so the skipped-test check applies in non-test source files. In test files, this is enforced by code review.
- Keep per-file coverage at or above 90% for statements, branches, functions, and lines.
- Test files are exempt from the function-length limit, empty-function restrictions, and the useless-undefined restriction. All other rules apply.
- Before claiming work complete, run the verification checklist:
  - `pnpm check`
  - targeted tests for changed files and features
- Do not bypass quality gates or pre-commit hooks.

---

## Error Handling

- Normalize unknown thrown values to `Error` at module boundaries. Never rethrow a raw `unknown`.
- Show safe, actionable messages to users. Do not expose stack traces or internal identifiers.
- Preserve useful diagnostics for developers: context, the failed operation, and safe identifiers.
- Guard every index access and optional chain result before using the value.

---

## Dependency Changes

- Add or update dependencies only when existing repo modules cannot solve the problem cleanly.
- Include a short rationale in the PR or commit message for each dependency change.
- Review security and license impact before merging.
- Keep `pnpm-lock.yaml` consistent with dependency changes. Do not create `package-lock.json` or `yarn.lock`.

---

## Security

- Do not introduce `eval`, the `Function` constructor, unsafe shell execution, or hardcoded secrets.
- Treat every security finding from static analysis (`eslint-plugin-security`) as a defect, not a warning.
- Do not suppress security findings with lint-disable comments. Fix the root cause.
