import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applyPatchTool, parsePatchFiles } from './apply-patch.js'

async function execApplyPatch(
  patch: string,
  workingDirectory: string,
  signal: AbortSignal | undefined = new AbortController().signal,
) {
  return applyPatchTool.execute(
    'test-call',
    { patch },
    signal,
    undefined,
    // @ts-expect-error minimal context mock
    { cwd: workingDirectory },
  )
}

let tempRoot: string
let deniedRoot: string

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'pi-apply-patch-test-'))
  deniedRoot = await mkdtemp(path.join(tmpdir(), 'pi-apply-patch-denied-'))
})

afterAll(async () => {
  await rm(tempRoot, { force: true, recursive: true })
  await rm(deniedRoot, { force: true, recursive: true })
})

describe('parsePatchFiles', () => {
  it('extracts changed and created files', () => {
    const files = parsePatchFiles(`--- a/existing.txt
+++ b/existing.txt
@@ -1 +1 @@
-old
+new
--- /dev/null
+++ b/created.txt
@@ -0,0 +1 @@
+created
`)

    expect(files).toEqual([
      { path: 'created.txt', created: true },
      { path: 'existing.txt', created: false },
    ])
  })

  it('rejects path traversal', () => {
    expect(() =>
      parsePatchFiles(`--- a/../outside.txt
+++ b/../outside.txt
@@ -1 +1 @@
-old
+new
`),
    ).toThrow('path traversal')
  })

  it('rejects deletions', () => {
    expect(() =>
      parsePatchFiles(`--- a/remove.txt
+++ /dev/null
@@ -1 +0,0 @@
-remove
`),
    ).toThrow('deletion')
  })

  it('accepts paths without git diff prefixes', () => {
    const files = parsePatchFiles(`--- existing.txt
+++ existing.txt
@@ -1 +1 @@
-old
+new
`)

    expect(files).toEqual([{ path: 'existing.txt', created: false }])
  })

  it('rejects missing new file headers', () => {
    expect(() =>
      parsePatchFiles(`--- a/missing-new-header.txt
@@ -1 +1 @@
-old
+new
`),
    ).toThrow('expected +++ header')
  })

  it('rejects empty old file headers', () => {
    expect(() =>
      parsePatchFiles(`--- 
+++ b/file.txt
@@ -1 +1 @@
-old
+new
`),
    ).toThrow('Malformed patch header')
  })

  it('rejects empty normalized paths', () => {
    expect(() =>
      parsePatchFiles(`--- a/.
+++ b/.
@@ -1 +1 @@
-old
+new
`),
    ).toThrow('empty patch path')
  })

  it('rejects patches without file headers', () => {
    expect(() =>
      parsePatchFiles(`@@ -1 +1 @@
-old
+new
`),
    ).toThrow('no file headers')
  })

  it.each([
    ['binary files', 'Binary files a/image.png and b/image.png differ'],
    ['renames', 'rename from old.txt'],
    ['deleted files', 'deleted file mode 100644'],
  ])('rejects unsupported %s', (_name, patchLine) => {
    expect(() => parsePatchFiles(`${patchLine}\n`)).toThrow(
      'Unsupported patch operation',
    )
  })
})

describe('applyPatchTool', () => {
  it('applies a modification patch', async () => {
    await writeFile(path.join(tempRoot, 'modify.txt'), 'old line\nkeep\n')

    const result = await execApplyPatch(
      `--- a/modify.txt
+++ b/modify.txt
@@ -1,2 +1,2 @@
-old line
+new line
 keep
`,
      tempRoot,
    )

    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Applied patch'),
    })
    await expect(
      readFile(path.join(tempRoot, 'modify.txt'), 'utf8'),
    ).resolves.toBe('new line\nkeep\n')
  })

  it('creates a new file', async () => {
    const result = await execApplyPatch(
      `--- /dev/null
+++ b/new-file.txt
@@ -0,0 +1,2 @@
+hello
+world
`,
      tempRoot,
    )

    expect(result.details).toEqual({
      changedFiles: ['new-file.txt'],
      createdFiles: ['new-file.txt'],
    })
    await expect(
      readFile(path.join(tempRoot, 'new-file.txt'), 'utf8'),
    ).resolves.toBe('hello\nworld\n')
  })

  it('reports git apply check failures', async () => {
    await writeFile(path.join(tempRoot, 'missing-context.txt'), 'actual\n')

    await expect(
      execApplyPatch(
        `--- a/missing-context.txt
+++ b/missing-context.txt
@@ -1 +1 @@
-expected
+changed
`,
        tempRoot,
      ),
    ).rejects.toThrow('check failed')
  })

  it('denies writes outside allowed directories', async () => {
    const deniedFile = path.join(deniedRoot, 'denied.txt')
    await writeFile(deniedFile, 'denied\n')

    await expect(
      execApplyPatch(
        `--- a/${deniedFile}
+++ b/${deniedFile}
@@ -1 +1 @@
-denied
+changed
`,
        tempRoot,
      ),
    ).rejects.toThrow('absolute patch path')
  })
})
