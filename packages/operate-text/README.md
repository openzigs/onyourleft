# `@onyourleft/operate-text`

The Operate sections' wording and pure view models
([#2644](https://github.com/openzigs/onyourleft/issues/2644),
[ADR 0069](../../docs/adr/0069-the-instances-own-admin-pages-and-a-tls-only-admin-channel.md) D-7):
the sentences, the closed-word tables and the functions that turn an Operate route's JSON into rows of
label and value. The app's Operate panels (`apps/web/src/views/Operate*.tsx`) and the instance's own
admin pages (#2645 onwards) both draw from here, so they cannot disagree. `apps/instance` may not
import `apps/web`, and no package may import an app, so the only place both can read one sentence
from is a package.

> ⚠️ **Every sentence here is DRAFT wording awaiting the owner's approval**, as it was in the panels
> it came from (#2603 to #2607).

## Provenance and licence

**Apache-2.0**, because it is under `packages/` ([CLAUDE.md §3](../../CLAUDE.md)). The text and code
were moved from `apps/web` (AGPL-3.0-or-later) by #2644 with no change to what they say or return.
Moving them relicensed them: **the owner, as copyright holder, agreed to that on 2026-11-15** (ADR
0069, the owner's ruling 3, recorded in D-7). D-7 asks for the authorship to be checked over the lines
moved, on the day they move: on 2026-11-15 `git blame` gives every line of
`OperateStatusPanel.tsx`, `OperateBackupsPanel.tsx` and `OperateAccountsPanel.tsx` to one author, the
owner, and `git log` gives every commit to the same author.

## What is here

| Module | What it holds |
| --- | --- |
| `words.ts` | `durationText`, `bytesText`, `countText`, `momentText`: time, size, counts and a moment in the zone the caller names, with the zone named (#2917), in words |
| `status.ts` | `statusRows` and the rows it is built from (`diskRow`, `lastBackupRow`), `compareWithMainUrl`, the closed-word tables (migrations, keys, disks, the newest backup's off-box copy, the tunnel), and Status's sentences |
| `accounts.ts` | `REGISTRATION_MODE_TEXT`, the one table the registration mode's short line and sentence are read from, and `MODERATORS_ALWAYS_JOIN` |
| `backups.ts` | The Backups section's sentences, a snapshot's off-box words, `backupsStaleText` and `snapshotPlace` |
| `analysis.ts` | AI backend's sentences, headings and closed-word tables (where the model is set, its state, the server's state, a tool check's outcome, the owner's own key), and the lines drawn from the routes' answers: `aiNowLines`, `modelLine`, `gpuFitText`, `jobLine`, `jobCountLines`, `ownKeyText`, and `analysisHolds`, which says whether a read-back holds a change. Moved from `OperateAnalysisPanel.tsx` by #2648; on 2026-11-16 `git blame` gives every line of that file to the owner |

A row is `{ label, value, code, warning }`: `code` says the value is a machine name (the deployed
commit) and `warning` is a short label and a sentence to draw with it, or `null`. Each app draws a row
its own way; nothing here renders.

## Rules

- **No dependency, not even a workspace one.** A route's answer is restated structurally
  (`OperateStatusAnswer`), and the app passes its checked `OperateStatus` in as it is: a word the
  app's port admits and this type does not is a type error at the panel. `eslint.config.js` refuses an
  `@onyourleft/*` import here.
- **Platform-free**, as `packages/domain`: `tsconfig.json` narrows `lib` to ES2024 with `types: []`,
  and `eslint.config.js` applies `platformIsolation` to every file, the tests included. No DOM, no
  Node builtin, no React, no clock: `now` is a parameter.
- **No coordinate and no secret** (ADR 0004 D): every value a row carries is a count, a size, a length
  of time, a closed word or the deployed commit. The answers it reads have no field that could hold a
  place or a key.
- `apps/web/src/views/operate-text-moved.test.ts` holds that no name exported here is declared in
  `apps/web/src` again: a copy left behind would go on being drawn after the sentence here changed.

## Not here yet

The operator log's words (`operatorActionLabel`, the source words), the Accounts section's app-only
sentences (they name the app's Moderation screen), and the markup-heavy parts of the panels (the
restore steps' commands, a backup record's line) stay in `apps/web` for now; the admin page that first
needs one moves it (#2645, #2646, #2647).
