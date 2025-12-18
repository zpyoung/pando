# Investigation: 0 MB Bug

## Bug summary
When running `pando add` with rsync enabled, the human-readable output always reports:

`✓ Files synced: 0 files (0.00 MB)`

even when rsync clearly transferred files into the new worktree.

This is visible in the add command output formatting in `src/commands/add.ts`.

## Root cause analysis
The rsync summary numbers shown by `pando add` come from `RsyncHelper.parseRsyncStats()` in `src/utils/fileOps.ts`.

That parser currently assumes an rsync `--stats` output format containing:

- `Number of created files: ...`
- `Total file size: ... bytes`

However, on macOS (and other environments) the `rsync` implementation is often **openrsync** (rsync 2.6.9 compatible). Its `--stats` output differs:

- It uses `Number of files transferred: ...` (not `Number of created files`)
- It reports sizes with a `B` suffix (e.g. `Total transferred file size: 2097152 B`) instead of `... bytes`

Example observed locally:

```
Number of files transferred: 1
Total transferred file size: 2097152 B
sent 2097561 bytes  received 42 bytes ...
```

Because `parseRsyncStats()` only matches `Number of created files` and `Total file size: ... bytes`, the regexes do not match on openrsync output, leaving the default values:

- `filesTransferred = 0`
- `totalSize = 0`

Those zeros then propagate to the display in `src/commands/add.ts`.

## Affected components
- `src/utils/fileOps.ts`: `RsyncHelper.parseRsyncStats()` parses rsync output too narrowly.
- `src/commands/add.ts`: renders `setupResult.rsyncResult.filesTransferred` and `totalSize`.
- `test/e2e/commands/add.e2e.test.ts`: has an E2E expectation that MB > 0 for rsync operations; this can fail on environments using openrsync.

## Proposed solution
1. **Make rsync stats parsing cross-implementation/cross-version** in `src/utils/fileOps.ts`:
   - Parse file count from (in priority order):
     - `Number of regular files transferred: N` (rsync 3.x)
     - `Number of files transferred: N` (openrsync/older rsync)
     - `Number of created files: N` (fallback)
     - Optional fallback: derive from the maximum `(xfer#N, ...)` value in `--progress` output.
   - Parse transferred size from:
     - `Total transferred file size: VALUE UNIT`
     - Fallback to `Total file size: VALUE UNIT`
     - Support both `bytes` and `B` (and ideally other suffixes if present) and convert to bytes.

2. **Add regression tests** (likely in `test/utils/fileOps.test.ts`) that validate parsing of:
   - openrsync stats output (`... transferred: 1`, `...: 2097152 B`)
   - a representative rsync 3.x stats output (`... created files ...`, `... bytes`)

3. (Optional) Consider switching display to use transferred-size semantics explicitly (i.e., ensure `totalSize` corresponds to *transferred* file size, not total file list size), since that’s what users intuitively expect for “Files synced: … (X MB)”.

## Edge cases / notes
- If rsync output is localized (non-English), regex parsing may still fail; the `(xfer#N)` fallback can help.
- If no files transfer, expected values remain `0 files (0.00 MB)`.
- Parsing should tolerate commas in numbers and stray `\r` characters from progress output.

