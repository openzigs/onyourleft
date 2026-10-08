# Scope, trademarks, prior art and the Garmin licence

An agent-instruction topic file. The root [`CLAUDE.md`](../../CLAUDE.md) holds the always-on rules and the map;
this file holds the parts of §6 beyond its always-on rules: how `SCOPE001` reads manifests, the Garmin licence text, the load-metric trademarks, the workout format and prior art's licences, moved out of the root verbatim on 2026-10-07 (#1170) so that it is loaded
only when it is needed. **Read it when you name a training metric, touch workouts, read or borrow from another project, or touch `SCOPE001`.**

Same authority as the root. In the text below, "this file" and "CLAUDE.md" mean the root, the
area `CLAUDE.md` files and `docs/agents/` together, and a bare section number such as "§7" is
found through the root's topic map.

---


## 6. The rest of §6

### ANT+ — what `SCOPE001` reads

⚠️ **It scans package manifests too, and until #15 it did not.** The rule walked the SPDX header
extension list — `.ts .tsx .js .jsx .mjs .cjs .css .sh .kt .kts .java .gradle .xml` — which covers
**code** by extension and **permission** through an `AndroidManifest.xml`, and left the third word
of the sentence above unenforced: `ant-plus` or `@abandonware/ant-plus` in a `package.json`
`dependencies` block was not a source file and passed a rule whose whole job is to stop the scope
quietly returning. A second loop now scans every `package.json` under `packages/` and `apps/`,
`node_modules` pruned. It is the same word-bounded pattern, so `antenna`, `Levenshtein` and
`participant` still do not match; [spike 0002](../spikes/0002-background-recording.md) §"Criterion
5" records the hole and how it was found.

### The Garmin FIT SDK — what may be quoted

**The licence text itself is public** on GitHub
(`garmin/fit-javascript-sdk/LICENSE.txt`) and **is safe to quote** — quoting the terms is how the
decision gets recorded. Quoting the *SDK source* is not. See
[#58](https://github.com/openzigs/onyourleft/issues/58).

### The names of the load metrics are registered trademarks — ours are our own

Checked for [#76](https://github.com/openzigs/onyourleft/issues/76), which flagged the question and
recorded that it had **not** been verified. It has been now:

- **NORMALIZED POWER** — USPTO registration **4450848**, serial **85913880**, owner
  TRAININGPEAKS, LLC, filed 2013-04-24, registered 2013-12-17.
- **"Training Stress Score"** and **"Intensity Factor"** are reported registered to the same owner
  (Peaksware / TrainingPeaks), and all of them passed to **Garmin** with its acquisition of
  TrainingPeaks on 2026-07-22.
- ⚠️ **`CTL`, `ATL` and `TSB` are reported registered too**, which #76 did not flag. That landed on
  [#77](https://github.com/openzigs/onyourleft/issues/77)'s chart, which uses its own plain names
  instead: **`base`** (the slow average), **`recent`** (the fast one) and **`freshness`** (the gap).
- **"Functional Threshold Power" / "FTP" could not be established either way.** `packages/store`
  calls the setting `thresholdPower`, which is plainly descriptive, so nothing turns on it.

⚠️ **The primary registers could not be reached from this environment** — `tmsearch.uspto.gov`,
`trademarks.justia.com`, `trademarkia.com` and `trainingpeaks.com` are all blocked by the egress
proxy — so the registration numbers above come from search-result summaries rather than from a
record read directly. Re-verify before relying on them for anything beyond "pick a different name".

**So this project uses its own plainly descriptive names**, which is the trivially avoidable path:
`effortWeightedPower`, `thresholdFraction`, `rideLoad`, `base`, `recent`, `freshness`. **Do not
rename them to the familiar ones**
in code, in a UI label, in a metric key or in a column header. The *formulae* are unaffected — they
are published (Allen & Coggan, 2006) and a trademark protects a name, not arithmetic.

### The workout file format is this project's own — ADR 0017 answered it

This project's own format, not the de facto one: [ADR 0017](../adr/0017-workout-file-format.md)
decides it, and why, with the four things about `packages/domain/src/workout/format.ts` that are
decisions rather than details, is [`docs/agents/workout-format.md`](workout-format.md).

### Reading prior art is fine. Copying from it binds this project's licence.

**Every mature prior-art project in this space except `incyclist/devices` (MIT) is GPL-2.0, GPL-3.0
or AGPL-3.0:**

| Project | Licence |
|---|---|
| GoldenCheetah | GPL-2.0 |
| qdomyos-zwift | GPL-3.0 |
| Auuki | AGPL-3.0 |
| OpenTrainer | CC BY-NC-4.0 — **not open source under the OSD** |
| `incyclist/devices` | MIT |

**Reading them to check a protocol detail or a formula is fine.** Copying code from them **binds this
project's licence** — and under §3 it is fatal to anything under `packages/`, because none of those
licences may appear there at all.

Facts are not copyrightable: a physical constant or an equation from a published paper (Martin et al.
1998, for instance) carries no such restriction. An implementation of it does.

**You are being told this before you borrow, not in review.**
