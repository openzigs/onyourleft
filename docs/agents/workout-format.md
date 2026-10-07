# The workout file format

Part of the agent instructions. The root [`CLAUDE.md`](../../CLAUDE.md) is the index; this file
carries the "workout file format" part of §6, moved out of it verbatim on 2026-10-05 so that it is read when it is needed
rather than loaded into every session. **Read it when you touch workouts, their file format, or an import of somebody else's workout format.**

It has the same authority as the root file. Where the text below says "this file" or
"CLAUDE.md", it means the root index and the files under `docs/agents/` together; a bare
"§4c" is found through the topic map in the root.

---

### The workout file format is this project's own — ADR 0017 answered it

⚠️ **This section used to say the question was open and that
`packages/domain/src/workout/` defined the model and no format. A reviewer who remembers that is
reading the old file.** [#202](https://github.com/openzigs/onyourleft/issues/202) settled it and
[ADR 0017](../adr/0017-workout-file-format.md) records the decision.

**The de facto format is not adopted.** Its three obstacles were each answered rather than noted,
and the answers are why the decision went the way it did:

- **L1** greps every diff for `zwift`, case-insensitively, and permits a hit only in prose or in an
  exact R3 template instance. An adopted extension would appear in a file picker's `accept` string,
  in an exported filename and probably in a directory name. That is a hit L1 forbids outright, not
  one it invites a defence of. **Under our own format the argument does not arise.**
- **R1** permits taking facts and forbids taking *somebody's compilation* of them as a table, and an
  element set is such a compilation. R1's escape hatch — re-derive from the specification — is
  **closed here**, because there is no published specification and **every open implementation is
  GPL-2.0, GPL-3.0 or AGPL-3.0**, which §3 makes fatal anywhere under `packages/`. That is the
  material difference from FIT, where published documentation existed. **Under our own format R1 is
  not engaged: nothing was consulted.**
- **ADR 0006 R2's provenance** column would have read "recalled". **Under our own format it reads
  `packages/domain/src/workout/workout.ts`, #201**, which is the strongest provenance any format in
  this tree has.

**So `packages/domain/src/workout/format.ts` is the format**, and it is JSON mirroring the model
one-for-one. Four things about it are decisions rather than details:

- **One key, `onYourLeftWorkout: 1`, is both the identity and the version** (D-3). A `format` string
  beside a `version` number can disagree with itself; one key cannot. **The decoder never looks at
  the filename.**
- ⚠️ **An unrecognised key is refused, not ignored** (D-4) — the opposite of the usual convention.
  A future field that changed what a workout *does* would otherwise be dropped silently and the
  rider would ride something else against a machine applying resistance to them. Forward
  compatibility comes from the version number instead. The cost is that an older build refuses a
  newer file wholesale, and that is the intended trade.
- ⚠️ **The format is in `packages/domain`, not `packages/fit`** (D-5). `packages/fit` is where
  *other people's* formats live and its identity is ADR 0006's clean-room posture; a serialisation
  of our own model has none of those questions to declare.
- ⚠️ **`validateWorkout` now bounds the expansion**, and until #202 nothing did: `expandWorkout`
  allocates one entry per segment, and ten thousand interval blocks at `MAXIMUM_REPEATS` is two
  million. The bound is in `validateWorkout` rather than in the decoder **so that it covers a
  hand-edited IndexedDB row as well as a file** — one rule instead of two that can drift.

**What this costs, and it is worth saying plainly: the free library is not bought.** A rider with a
folder of workouts in the de facto format cannot open them here, and this project starts with a
corpus of zero. #14's fifth criterion — *"at least 50 workouts from the existing open ZWO corpus
parse"* — **is not met and is not claimed to be**; ADR 0017 supersedes it. Importing that format is
[#210](https://github.com/openzigs/onyourleft/issues/210), with the licence and corpus questions
attached, and ADR 0017's §"What would make this ADR wrong" says what would reopen it.
