# The wiring gate

Part of the agent instructions. The root [`CLAUDE.md`](../../CLAUDE.md) is the index; this file
carries §4j, moved out of it verbatim on 2026-10-05 so that it is read when it is needed
rather than loaded into every session. **Read it when you add a module under `apps/web/src/game/`, `ride/`, `offline/`, `net/`, a `*-port.ts`, touch the trainer-command seam in `packages/`, or write `@unwired` / `@test-facing`.**

It has the same authority as the root file. Where the text below says "this file" or
"CLAUDE.md", it means the root index and the files under `docs/agents/` together; a bare
"§4c" is found through the topic map in the root.

---

### 4j. The wiring gate

Added by [#278](https://github.com/openzigs/onyourleft/issues/278). It is
[`scripts/check-wiring.mjs`](../../scripts/check-wiring.mjs), it runs as `pnpm run check:wiring`, and it
is the one gate here that looks **between** units rather than inside one.

Five defects in one week were a correct, unit-tested, typechecked, linted unit **wired to nothing**:
`BleClient.initialize()` called only from a method nothing called, so no device could be paired on
Android at all (#230); `advanceBot` with no caller, so there was no pacer (#237); `ghostFinished`
exported, tested and computed by nobody, so a rider who beat their own best was never told (#259).
⚠️ **§5's mutation requirement cannot see any of them** — `advanceBot` had a test proven to fail
without it, and the test says nothing about whether anything calls it. Neither can the typechecker:
**an exported function nobody calls and an optional parameter nobody supplies are both perfectly
well typed.**

| Rule | Fails when |
|---|---|
| `WIRE001` | a watched module no production module imports |
| `WIRE002` | an exported symbol in a watched module that no production declaration names |
| `WIRE003` | a method declared on a `*-port.ts` interface — or on one in the **trainer-command seam** — that no production declaration calls |
| `WIRE004` | an export marked `@test-facing` that no test, spec or browser harness reads (nor any held `@test-facing` export one does) — it is dead; **or** either tag on an export production DOES name — the exemption is stale ([#438](https://github.com/openzigs/onyourleft/issues/438)) |

**The entry point is read out of `apps/*/index.html`**, so it is the page Vite actually builds
rather than a path written down twice — **or, for an app with no page, out of its `package.json`'s
`main`** (since [#767](https://github.com/openzigs/onyourleft/issues/767)): `apps/instance` is
started as `node src/main.ts`, and without this every `*-port.ts` it grows would be reported as
reached by nothing. Two fixture cases pin both directions. ⚠️ **`apps/web/browser/` is deliberately NOT an entry
point**: a harness page is a gate, and #236 is exactly what happens when a harness's own canvas is
mistaken for the product's. Neither is a test — every one of the five defects was unit-tested and
green, so a test calling something is not evidence that anything ships it.

⚠️ **The watched set is the client's own seams** — `apps/web/src/game/`, `apps/web/src/ride/`,
`apps/web/src/offline/`, `apps/web/src/net/` (since #782's review: the room session, snapshots and
interest set) and every `*-port.ts` under `apps/` — **plus five named modules in `packages/`, and
nothing else there.** ⚠️ It reads exports and port methods, **never a class's members**:
`net/room-session.ts` §`RoomSession.finish` has no production reader (#785's) and is green here.
⚠️ **This paragraph used to end "not the packages underneath", full stop, and a reviewer who
remembers that is reading the old file.**
[#362](https://github.com/openzigs/onyourleft/issues/362) is what changed it: `createSimulationWriter`
and #90's gradient driver both live in `packages/`, no rule here looked at them, and the trainer game
computed a gradient, drew the hill, put it on the HUD and **never told the trainer** — 252 inbound
notifications and zero writes over a whole ride on a real FTMS machine, on the one path in the
program that applies physical resistance to a person. That is the second defect of this shape after
#237's `advanceBot`, so [#363](https://github.com/openzigs/onyourleft/issues/363) stopped treating
the limit as a hypothetical.

⚠️ **What it is NOT is "watch `packages/`", and the reason is measured rather than asserted.**
Applying `WIRE001` and `WIRE002` to every non-test source under `packages/` on the tree at `4bfee83`
reports **171 findings over 180 files** — 39 modules nothing imports (the whole of
`packages/fit/tools/`, the #44 simulator, seven `vitest.config.ts`) and 132 exports nothing names,
most of them the ones §4b records as having no production consumer *by design*. A noisy rule gets an
allowlist, and an allowlist that grows is how a rule stops firing. So the selector is a **principle
rather than a directory**, and the principle is §6's own — *"a smart trainer applies physical
resistance to a person who is pedalling"*. `TRAINER_COMMAND_SEAM` is the five modules that stand
between this program and that: what decides a setpoint (`domain/src/trainer/simulation.ts`), what the
commands are (`protocol/src/fitness-machine-control.ts`), what paces them onto the wire
(`simulation-writer.ts`, `erg-writer.ts`) and which control point they are addressed to
(`trainer-control-choice.ts`).

⚠️ **Two numbers, on two trees, and they are easy to conflate — this paragraph did.** On `4bfee83`
those five report **26** findings (17 `WIRE002`, 9 `WIRE003`), and
`TrainerControl.setSimulationParameters` is one of them: that is #362, reported by this gate on the
tree it actually shipped from, which is #363's whole claim. On `main` after #362's wiring landed the
residual is **7** — measured by stripping the `@unwired` tags from those five files in a throwaway
worktree and re-running, which is the only way to read a residual rather than a count of
exemptions. ⚠️ **A sentence here read "on the same tree those five report 7" and was wrong**: 7 is
the post-fix residual and 26 is the pre-fix finding, and #362 is in the 26 and not in the 7. The
design conclusion is unchanged either way — 26 against `packages/`-wide's 171 is the ratio the
selector is chosen on — but the label mattered enough to correct, because this file is where the
next person reads what was measured.

⚠️ **A watchlist, not an allowlist**, which is the distinction #363's third criterion turns on:
adding a path adds coverage, and the only way out is an `@unwired` at the declaration carrying a
reason a person can read, refused when reasonless, exactly as under `apps/`. All seven of the
residual findings now carry such a reason, and **three of them are one real gap** —
[#370](https://github.com/openzigs/onyourleft/issues/370), `chooseTrainerControl` and the two
declarations only it reads, which no transport feeds, so a rider whose trainer serves only a
proprietary control point is told "no controllable trainer" rather than the truth. ⚠️ An
`@unwired` on a genuine gap is not the gap being waved through: the reason has to name the issue
that owns it, and these three do. ⚠️ **The limit is narrowed and not removed**: #237's `advanceBot` is
in `packages/physics/src/pacer.ts` and is still not named, because a bot pacer moves a shape on a
screen rather than a brake.

⚠️ **Measure that set before you read a green run as a clean client: it is 52 watched files, of which
47 are 30 % of the 156 non-test sources under `apps/*/src` and 5 are the trainer-command seam.** The
`*-port.ts` suffix is the half that found #282, not the directories: `segments/match-port.ts` matches
it, while `segments/backfill.ts`, the module that was actually dead, is in no watched directory and
**is not reported**. The gate prints all three counts for this reason, the watched one first; a run
that says *"285 production modules"* and nothing else reads like coverage of a population it never
checked. ⚠️ **The third count is the seam's own — `5 of 5 trainer-command seam modules` — and it is
REPORTED rather than asserted.** `missingSeamFiles` raises when *some* of the five are absent and
deliberately not when *all* are, because a tree with none of them is a tree with no trainer in it,
which is what almost every fixture in `check-wiring.test.sh` is. In this repository, where all five
do exist, that leaves deleting the whole seam in one commit a silent pass — so `0 of 5` in the log
is what distinguishes it from a healthy run, and two fixtures pin both ends of that count. ⚠️ **These are counts and they age**, and they were 41 of 143 until #362 added two more
`apps/` files and #363 added the seam, and 51 of 154 until #366 added `game/scenery-palette.ts`;
re-read them from the gate's own success line rather than from this paragraph. ⚠️ **Its
`model-bytes-testing.ts` sibling is deliberately NOT in that count**: the suffix `-testing.ts` is
what `isTestSupport` reads, and a file that parses glTF and PNG for a gate is not product code.

⚠️ **`WATCHED_PREFIXES` is written down in the checker rather than discovered, so it is asserted to
exist.** A selector like that fails closed against *deleting* what it names and open against
*renaming* it — rename `ride/` to `riding/` and every rule passes over an empty population while the
success line claims every seam is reachable. That is #142's shape (§4e), and it is why a prefix
naming no directory, and a watched set holding no file, are both hard failures with their own
fixtures. Moving a watched directory means editing `check-wiring.mjs` in the same commit.

⚠️ **`TRAINER_COMMAND_SEAM` is asserted the same way, with one wrinkle: it is checked
all-or-nothing.** A tree holding none of the five is a tree with no trainer in it — which is what
almost every fixture in `check-wiring.test.sh` is — and a tree holding *some* of them is one where a
path has moved, which is a hard failure naming the path. ⚠️ And **every entry is load-bearing**: on
the way in, deleting `packages/domain/src/trainer/simulation.ts` from the list left the whole suite
green, so there is now a case that puts an unwired declaration in all five at once and names each. A
watchlist that can be quietly shortened is an allowlist with better manners.

**Where something legitimately has no production caller, say so at the declaration**: `@unwired`
followed by a reason, in its doc comment. The tag alone is refused — an exemption nobody can read is
a config-file list with extra steps — and it is refused on **all three** paths, including a file's
own doc comment, which is the broadest of them because it silences a whole module. A reasonless tag
is reported as `WIRE000` rather than quietly honoured.

⚠️ **Test-facing arithmetic has its own tag since
[#438](https://github.com/openzigs/onyourleft/issues/438), `@test-facing`, and a reviewer who
remembers every bound a test asserts against spending an `@unwired` is reading the old file.** #436
took the `@unwired` population under `apps/` from 21 to 32 in one change, nearly all of it
`camera.ts` and `bicycle.ts` stating the composition so `camera.test.ts` and two browser gates can
hold the renderer to it — each correct, and indistinguishable in a count from a genuine gap, which
is how *"an allowlist that grows is how a rule stops firing"* starts. #438 weighed three options:

| Option | Verdict | Why |
|---|---|---|
| 1. Leave it | rejected | the population grows with every derived gate, and a free-text reason cannot go red when the test it names is deleted |
| 2. A sibling module outside `WATCHED_PREFIXES` | rejected | fewer tags by watching LESS — an unwatched module is exactly where a genuinely dead export hides, and moving 23 declarations out of `camera.ts` and its neighbours reshapes files the renderer reads for a counting problem |
| 3. A second tag, counted apart | **chosen, and made stricter than the first** | same watched set, same rules, and the new tag is **verified**: `@test-facing <reason>` exempts an export from `WIRE002` only while a test, a spec, a double or a browser harness reads it, or a held `@test-facing` export does. When nothing does, `WIRE004` calls it dead |

It exempts **exports only** — a whole file only tests import is still `WIRE001`, and a port method
only a double calls is still `WIRE003`, because both are #230's shape. `WIRE004` also reports
**either** tag on an export production DOES name: a stale exemption is a false statement at the
declaration, and on the tree #438 was measured on it found three — `world.ts` §`PEAK_IRRADIANCE`
(wired by #366's `MAXIMUM_LIT_CHANNEL` and still claiming nothing evaluated it),
`bicycle.ts` §`BICYCLE_FRONT_METRES` (named by `BICYCLE_LENGTH_METRES`, so the tag exempted
nothing), and `ride/metrics.ts` §`isReadable` (wired by #400). **Measured** (tags opening a
comment line in non-test files, on `56a735e` and after — #436's reviewer counted 32 by another
method): raw `@unwired` tags under `apps/` **31 → 6**; exemptions the gate honours **32 → 9** `@unwired` + **22**
`@test-facing`, the missing one being `isReadable`, now wired. The success line reports both counts
beside the watched count — read them off the run, because they age. ⚠️ The count went down by
**re-labelling under a stricter rule**, not by watching less: `WATCHED_PREFIXES` and the seam are
unchanged, and the mutation that honours `@test-facing` whether or not a test reads it turns five
fixture cases red.

⚠️ **"Reads" means an identifier in the parsed code since
[#447](https://github.com/openzigs/onyourleft/issues/447), and until then it meant the name
appearing anywhere in the file's text** — so a `@test-facing` export mentioned only in a comment of
a test, or inside a string, was held alive by a sentence. `check-wiring.mjs` §`identifiersIn` walks
the TypeScript parser's own tree, which carries no comment and no string contents, and the same
applies to a held export holding up another: a mention in its doc comment no longer counts.
Measured on the tree #447 was written on: the held count was **22** either way, so nothing here was
being held up by a comment alone (it is 19 after #426, which shipped three of them). What it still cannot tell is WHICH declaration a name refers to — a test's own local
of the same name holds the export alive — and that is §Limits' collision, stated for `WIRE002`
already. Reverting `identifiersIn` to a match over the file's full text turns five fixture cases
red.

⚠️ **The tag has to OPEN a line to be a tag, and until
[#292](https://github.com/openzigs/onyourleft/issues/292) it did not have to** — a reviewer who
remembers being told not to spell `@unwired` in a watched file's prose is reading the old file.
`unwiredReason` matched it anywhere in the stripped comment, so a paragraph *saying the exemption
had been removed* parsed as a live one with the rest of the sentence as its reason, and on the
file-comment path that silenced `WIRE001` for the whole module. It happened: #290's wording of
`segments/match-port.ts`'s note re-exempted the file that had been this gate's first finding.
Naming the tag in prose is now safe — it is matched at the start of a stripped line, with the
leading whitespace a one-line `/** @unwired … */` leaves behind and nothing else. Three prose
mentions in the tree parsed as exemptions before that change and none of them was load-bearing;
all sixteen real ones parse unchanged, measured rather than reasoned about.

⚠️ **`apps/mobile/src/ble/plugin-port.ts`
§`isEnabled` carried one naming [#284](https://github.com/openzigs/onyourleft/issues/284) and no
longer does** — a reviewer who remembers this paragraph citing it as the example of a tag that is a
defect rather than a decision is reading the old file. #284 wired it: the Devices screen reads
`apps/web/src/support/shell-support-port.ts` inside the shell, so the answer a rider on Android gets
comes from the plugin rather than from the WebView's `navigator.bluetooth`. ⚠️ **That gave this
gate half the chain and not all of it, measured both ways round**: deleting the screen's branch is a
red `WIRE003`, and having `main.tsx` hand the screen no port at all is **green**, because an
optional prop nobody supplies is the third §Limits entry. It is recorded at the port's own
declaration rather than only here. ⚠️ **`segments/match-port.ts` carried the other one and no longer does** — a
reviewer who remembers this paragraph naming it is reading the old file. It was this gate's first
finding, [#282](https://github.com/openzigs/onyourleft/issues/282): nothing in the client ran the
segment matcher, so no segment effort had ever been written and the effort screens read a table only
a test filled. `apps/web/src/segments/sweep.ts` is what runs it now, and removing that wiring turns
the gate red with four `WIRE003`s rather than nothing — measured, because a note deleted from a file
proves only that the note is gone.

⚠️ **A green seam is not a working trainer, and the two tests that say so fail for different
reasons.** `check:wiring` asks whether any production declaration *names*
`setSimulationParameters`; `apps/web/src/game/trainer-wiring.test.tsx` drives the real component and
reads what a **trainer** was handed. Deleting the `sample` call inside `GameView`'s tick leaves the
gate green — `GameView` still names `createGradientSession` — and turns three of that file's
assertions red. Neither replaces the other.

⚠️ **`apps/web/src/offline/sw.ts` and `worker-core.ts` carry the two newest tags, and they are the
first pair here that is STRUCTURAL rather than a decision or a defect** ([#406](https://github.com/openzigs/onyourleft/issues/406)). A
service worker is a **second entry point**: Rollup builds it in its own pass into `dist/sw.js`, and
the browser reaches it through a URL rather than an import, so nothing in the graph this gate walks
from `index.html` can ever import it. What the prefix buys instead is `register.ts`, which
`main.tsx` **does** import — measured both ways round: deleting the call from `main.tsx` is a red
`WIRE001` naming `register.ts`, and restoring it is green. A future worker module needs a tag of the
same shape, and that is the cost the prefix was added with its eyes open to.

⚠️ **Read `check-wiring.mjs` §Limits before concluding something is wired because the gate is
green.** It cannot see a call made through a string key, a dynamic import whose specifier is not a
literal, or a prop threaded through JSX it does not follow — which is #252, measured against the
tree as it was and **pinned as a green case** in `check-wiring.test.sh` so that the limit cannot
quietly become a false claim.
