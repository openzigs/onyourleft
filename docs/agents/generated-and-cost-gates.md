# The generated-artefact and cost-model gates

Part of the agent instructions. The root [`CLAUDE.md`](../../CLAUDE.md) is the index; this file
carries §4k and §4l, moved out of it verbatim on 2026-10-05 so that it is read when it is needed
rather than loaded into every session. **Read it when you bump Capacitor, touch the committed Gradle files `cap sync` writes, or edit `docs/cost-model.md`.**

It has the same authority as the root file. Where the text below says "this file" or
"CLAUDE.md", it means the root index and the files under `docs/agents/` together; a bare
"§4c" is found through the topic map in the root.

---

### 4k. The generated-artefact gate

Added by [#299](https://github.com/openzigs/onyourleft/issues/299). It is
[`scripts/check-capacitor-generated.mjs`](../../scripts/check-capacitor-generated.mjs), it runs as
`pnpm run check:capacitor`, and it answers a question no other gate here asks: **is a file this
repository generated and committed still what its generator writes?**

`cap sync` writes two files that are committed —
`apps/mobile/android/capacitor.settings.gradle` and `apps/mobile/android/app/capacitor.build.gradle`
— and ⚠️ **pnpm's store path carries the PEER version as well as the package's own**, so
`@capacitor+android@8.5.1_@capacitor+core@8.5.1` is a different directory from
`@capacitor+android@8.5.2_@capacitor+core@8.5.2` and **any** Capacitor bump invalidates the first
file. [#276](https://github.com/openzigs/onyourleft/pull/276) and
[#277](https://github.com/openzigs/onyourleft/pull/277) did exactly that, and nothing could tell:
CI never builds Android, `release.yml` is tag-triggered and has never run, `check:wiring` walks the
TypeScript module graph and a Gradle settings file is outside it entirely — and ⚠️ **the documented
local sequence hides it**, because `apps/mobile/README.md` §1 is `build` → `cap sync` → `gradlew`
and the sync regenerates the file before Gradle reads it. The person most likely to notice is the
one whose workflow guarantees they cannot.

This is the **third** variant of a shape this repository keeps finding, and the common property is
that the green result is indistinguishable from the correct one:

| Variant | Gate |
|---|---|
| a unit wired to nothing (#278) | §4j, `check:wiring` |
| a guard that cannot fire (#229, #225) | the fixture suites, one red case per rule |
| **a generated artefact that has drifted from its source** (#299) | **§4k, `check:capacitor`** |
| a derived figure whose input has moved under it (#54) | §4l, `check:cost-model` |

| Rule | Fails when |
|---|---|
| `CAP001` | `pnpm install --frozen-lockfile` does not succeed, so the installed tree is not the one the lockfile describes |
| `CAP002` | the Capacitor project, or a file `cap update` generates and this repository commits, is not in the tree |
| `CAP003` | the generator could not be run, failed, or **exited 0 without writing one of the files** |
| `CAP004` | a committed file is not what `cap update android` writes |

⚠️ **The install is the half that is easy to drop, and dropping it is what
[#298](https://github.com/openzigs/onyourleft/pull/298) did.** That pull request regenerated the
settings file from a `node_modules` holding `@capacitor/android@8.5.1` while the lockfile said
8.5.2, and committed `@capacitor+android@8.5.1_@capacitor+core@8.5.2` — a fix for stale drift that
committed **different** stale drift, corrected in #300. `cap update` faithfully encodes whatever
`node_modules` holds and says nothing about whether that matches the lockfile, so a
regenerate-and-diff over an unverified install proves only that two wrong things agree. The check
therefore runs the frozen install itself rather than trusting a caller to have run one.

⚠️ **`cap update android`, not `cap sync`.** `sync` is `copy` + `update`; `copy` is the half that
copies the web build into the gitignored asset tree, and only `update` writes the two files in
question. So the check runs in about half a second and structurally cannot report the trees §3a
prunes.

⚠️ **Two gitignored directories are what make it independent of the web build, and both were
found by CI rather than locally.** `cap update` writes `capacitor.plugins.json` into
`android/app/src/main/assets/`, and — less obviously — it **falls back to a full `copy` when
`android/app/src/main/assets/public/` is missing**, which then refuses to start without
`apps/web/dist`. Both directories are `cap copy`'s output and gitignored, so both exist on the
machine of anyone who has ever run `cap sync` and on no clean clone: the first two CI runs of this
gate died on one each while the same command was green locally. The checker creates whichever is
absent and **removes it again only if it was the one that created it**. Read
`GENERATED_DIRECTORIES` before moving the CI step or concluding it belongs after `Build`.

⚠️ **Both files are overwritten with a marker before the generator runs**, and a marker that
survives is `CAP003` rather than agreement. Without it a generator that exited 0 without writing —
a platform argument it did not understand, a Capacitor release that moved a file — would be a
comparison of a file with itself, which passes whatever the file says. **The originals are put back
in a `finally`**: a checker that left the repaired file in the tree would turn a red gate into a
silent `git add -A`.

⚠️ **The cheaper check #299 floats does not work, and the measurement is worth keeping.** Asserting
that every `node_modules/.pnpm/…` path named in the file exists on disk needs no `cap update` and
is a few lines — but on 2026-09-15, on a machine that had installed both versions in turn,
`node_modules/.pnpm/@capacitor+android@8.5.1_@capacitor+core@8.5.2` was **still present and fully
populated**. pnpm leaves an orphaned store directory behind rather than pruning it, so the existence
check would have looked at #298's own artefact and passed. A gate whose answer depends on what a
developer happened to install last week is not a gate.

**Read `check-capacitor-generated.mjs` §Limits before reading a green run as more than it is.** It
does not run Gradle and says nothing about whether the project builds — nobody in this environment
can, and `apps/mobile/README.md` §4 records why.

### 4l. The cost-model gate

Added by [#54](https://github.com/openzigs/onyourleft/issues/54). It is
[`scripts/check-cost-model.mjs`](../../scripts/check-cost-model.mjs), it runs as `pnpm run
check:cost-model`, and the artefact it guards is
[`docs/cost-model.md`](../cost-model.md) — the answer to what "free to the end user" costs and who
pays it.

**The document holds the inputs and the outputs; the script holds the arithmetic; nothing holds two
of the three.** Every input is written down once with its provenance and a confidence word, and
every figure that follows from it is recomputed on each CI run. Editing a rate without the table is
a red build rather than a stale document.

| Rule | Fails when |
|---|---|
| `COST001` | the document, a table anchor, a table, or the three required scale columns is missing or unreadable |
| `COST002` | an input the model needs is absent from the inputs table, or its value is not a number |
| `COST003` | a stated figure disagrees with what the model computes from the inputs |
| `COST004` | an input carries no provenance, or a confidence outside `measured`/`read`/`inherited`/`inferred` |
| `COST005` | a table yielded no comparison at all |
| `COST006` | a stated dominant or second-largest line item is not the one the model computes |

This is the **fourth** variant of the shape §4k tabulates, and the common property is unchanged: the
green result is indistinguishable from the correct one. A cost table is arithmetic somebody did
once, in a document that outlives the day they did it — and two of this model's inputs moved while
it was being written. The Protomaps planet build grew **103.0 MB in the four days to 2026-09-15**,
and Verisign has announced a `.com` wholesale rise for **2026-11-01**.

⚠️ **`COST005` is counted per table rather than once for the run, and that is what makes it
reachable.** A run-wide count is satisfied by any one table having rows, so the donations table
could be skipped in its entirety while the projection kept the total above zero — a guard against a
vacuous pass that is itself vacuous. Both tables must have contributed something, and the suite has
a fixture where one parses as a table and yields nothing.

⚠️ **A fixture at the identity value of the operation it feeds tests nothing, and this suite shipped
one.** The first version priced Class B reads at **$1.00 per million**, which makes `× p_classB`
indistinguishable from omitting it — a mutation deleting that multiplication passed all 49
assertions the suite then had. A zero egress price hides the tile size the same way and a rate of
1.00 hides
`fx`. Every rate in `base_document` is now deliberately away from 1 and from 0, and the file says
so where a reader would otherwise simplify it back.

⚠️ **Read `check-cost-model.mjs` §Limits before reading a green run as more than it is.** It checks
that the document's conclusions follow from the document's premises; it says nothing about whether a
premise is true, and nothing about any bill, because there is no traffic and no invoice.

⚠️ **The prose is not checked, and that is where the figures a reader quotes live.** Only the three
anchored tables are. Every share, ratio, threshold and band stated in a *sentence* is outside every
rule — the crossover `--print` derives and a person pastes, the instance's percentage of each total,
the price band the box is said to dominate across. **This is the gate's blind spot and it is not
hypothetical**: #54's own review found **three** prose figures that were wrong the day they were
typed — an instance share taken against the infrastructure subtotal and quoted as a fully-loaded
one, a dominance claim false at the floor of its own stated band, and a donations arithmetic the
table beneath it already contradicted — inside the document arguing that derived figures rot. Each
is corrected and each now carries a note saying what it used to say. **A green `check:cost-model` is
evidence about the tables only.** Reviewing this document means recomputing every percentage, ratio
and band in its prose against the gated table above it; the stopping point is deliberate, because
machine-checking a sentence means pinning its wording and a gate that forbids rewording a paragraph
gets deleted.
