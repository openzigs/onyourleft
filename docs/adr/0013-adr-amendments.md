# ADR 0013: Amending an accepted ADR — a dated, append-only Amendments section

- **Status**: Accepted
- **Date**: 2026-09-05
- **Deciders**: No owner decision was sought or given for this ADR, and none is claimed. The decision
  below is the author's engineering work, constrained by one rule that is already merged:
  `CLAUDE.md` §7, which lists `docs/adr/*.md` as a protected path and says an ADR is amended by a
  **new** ADR that supersedes it, not by editing it in place
- **Issue**: [#147](https://github.com/openzigs/onyourleft/issues/147)
- **Number**: **0013**, not 0012. `0012` is reserved in
  [`docs/architecture.md`](../architecture.md)'s ownership table for
  [#64](https://github.com/openzigs/onyourleft/issues/64)'s data-licence decision, which is what
  [#119](https://github.com/openzigs/onyourleft/issues/119) exists to reserve. Taking 0012 here
  would consume the number in the same pull request that reserved it, and reintroduce the dangling
  pointer one row down
- **Supersedes**: nothing. It **adds a second, narrower mechanism** beside supersession; it does not
  replace it, and §7's rule against editing a body is unchanged
- **Constrains**: every future change to a file under `docs/adr/`, and
  [#64](https://github.com/openzigs/onyourleft/issues/64), whose ADR will discharge ADR 0001's
  *Data* deferral and should record that it has
- **Relates to**: [ADR 0001](0001-licence.md) (whose *Data* deferral names the wrong ADR number —
  the first thing this convention is used on), [ADR 0011](0011-stream-storage.md) (whose decision H
  carries the stale sentence #147 was opened for)

---

## Context

Eleven ADRs were written in a week, describing a codebase that changed underneath them in the same
week. Two of them now carry a statement that is false, and neither can be repaired:

1. **[ADR 0011](0011-stream-storage.md) decision H** says `@onyourleft/domain`'s `UnitError` "does
   name" a coordinate value. Since [#104](https://github.com/openzigs/onyourleft/issues/104) it does
   not, for a latitude or longitude label. [#110](https://github.com/openzigs/onyourleft/issues/110)
   corrected the other two copies of that sentence — in `CLAUDE.md` and
   [`docs/architecture.md`](../architecture.md) — and deliberately left this one, because it is
   under a protected path.
2. **[ADR 0001](0001-licence.md)'s *Data* section** defers the ODbL question to "ADR 0007". ADR 0007
   is the patent posture and says nothing about ODbL. That is
   [#119](https://github.com/openzigs/onyourleft/issues/119), and it too was found and *not* fixed,
   for the same reason.

The protected-path rule is right, and it is the reason both were left alone. An ADR is a record of
what was decided **at the time**; quietly editing the body destroys the only thing it is for, and a
reader can no longer tell what the deciders actually knew. But the rule as written offers exactly
two moves — **supersede the whole document**, or **let it rot** — and neither fits one stale verb
and one wrong number. A superseding ADR for either would be a document whose entire content is
"one sentence in the other one is out of date", which buries the real decision record under
bookkeeping. Letting them rot is what has happened twice already, and it is compounding.

The repository has been improvising around this. `docs/architecture.md` line 275 already records an
attribution mismatch with ADR 0009 "here rather than by editing a protected ADR in place", and
[ADR 0010](0010-map-tiles-and-routing.md)'s *Notes* record #119's dangling pointer rather than
repairing it. Both are the same workaround: **put the correction somewhere the ADR's own reader will
never see it.** A reader who reaches ADR 0011 line 200 is not also reading `docs/architecture.md`.

#147 put three options. This ADR takes the third.

## Decision

### D-1. An accepted ADR may carry one `## Amendments` section, and it is the last section

A dated note may be **appended** to an ADR, in a section named `## Amendments`, recording that
something stated in the body has since become false. The shape:

```markdown
---

## Amendments

Appended under [ADR 0013](0013-adr-amendments.md). Nothing above this line has been edited.

- **2026-09-05** — Decision H's second paragraph is no longer true. `UnitError` stopped naming a
  coordinate value in #104; the codec's per-channel masking it describes is still in force, and
  still necessary, because `altitude` is not covered by the domain's label rule. (#147)
```

The section goes at the **end of the file**, nothing follows it, and each entry is one bullet
opening with a bold ISO date. Entries are **in date order**, because they are appended.

The horizontal rule and the standing line under the heading are **part of the prescribed shape, not
decoration**, and they are one line each on purpose. The rule separates a section that is not part
of the argument above it from one that is; the standing line answers the question a reader arriving
here asks first — *has the body been edited?* — where they are, rather than in an ADR they would
have to go and find. Neither is an entry: `ADR003` reads entries as top-level bullets, so prose
before the first one is not checked for a date. Anything longer than that line belongs in this ADR,
which is why the two amendments this convention was established for carry exactly it and nothing
more.

### D-2. The body above it is never edited. That rule does not move

An amendment is an **append**. Not one character of the body changes — not a verb, not a number, not
a link. This is the whole distinction being drawn, and it is what keeps the record intact: the ADR
still says what it said on the day, and the reader is told, at the bottom, what has happened since.

The `Status` field is part of the body, so an amendment does not change it. An ADR with amendments
is still `Accepted`.

### D-3. What may be amended: a fact. What may not: a decision

| Kind of drift | Mechanism |
|---|---|
| A statement about the codebase that has become false — "the domain package does name it" | **Amendment** |
| A pointer that does not resolve — a wrong ADR number, a renamed file, a moved section | **Amendment** |
| A figure that has drifted, where the ADR's argument does not turn on it | **Amendment** |
| **The decision itself is wrong, or is being reversed** | **A superseding ADR.** Unchanged |
| The decision still stands but its *reasoning* has been overtaken | **A superseding ADR** — that is a new decision on the same question |

The line is: an amendment says *"this description of the world is out of date"*. It never says
*"and so we now do something different"*. The moment a correction would change what a reader should
**do**, it is a decision, and a decision gets an ADR with `Status`, `Context`, `Decision` and
`Consequences` like every other.

### D-4. An entry is added, never edited or removed

The section is an append-only log. A later entry may say that an earlier entry is itself now
out of date; nothing deletes one. That is the same reasoning as D-2, one level down — an amendment
log that can be rewritten is not a record either.

### D-5. Enforced by rule `ADR003`, not by this document

`scripts/check-repo-rules.sh` fails the build when an ADR has two `## Amendments` sections, when
**any heading at all** follows the section, when an entry does not open with a bold ISO date, when
an entry is dated **before the one above it**, or when an unclosed code fence would hide any of
those. That is the enforcement half, and it is not optional politeness: the two things D-1
distinguishes — *appending a note* and *editing the body while calling it an amendment* — produce
diffs that look alike in review and are opposites in what they do to the record. `CLAUDE.md` §8
already makes this argument about `pull_request_target`: "a documented ban is not a gate".

The **date order** check is the one part of "it was an append" that is visible in the file rather
than only in the diff: an entry put at the top of the section — the natural move if you read the
section as a newest-first changelog — leaves an older date below a newer one. It cannot catch an
append carrying a backdated date, and does not claim to. The **unclosed fence** check is there
because the rule skips fenced blocks, so an odd number of fences does not weaken it, it switches it
off for that ADR: the heading is blanked with everything after it, the file is skipped whole, and a
second section, a following section and an undated entry all pass in silence.

**What `ADR003` cannot check** is that the change was literally an append. That is a property of the
diff, not of the file, and `scripts/check-repo-rules.sh` runs on a bare clone with no git history by
design. The "last section, nothing after it" rule is the closest structural proxy, and it catches
the realistic mistake — a note tucked into the body next to the sentence it corrects. **A reviewer
still has to read the diff**, and for a change under `docs/adr/` the question is always the same
one: does any hunk touch a line that already existed?

### D-6. The decision record index does not gain a row per amendment

[`docs/architecture.md`](../architecture.md)'s index lists ADRs, not their revisions. An amendment
is a change *within* an ADR and is found by reading it. Adding a row per amendment would make the
index a second, partial copy of the amendment logs, which drifts.

`ADR002`'s filename rule needs no change either: an amendment creates no file. Both were checked
because #147 asked for them to be, and the answer in both cases is that nothing is needed.

## Consequences

**What this buys.** A reader who reaches ADR 0011 line 200 can find out that the sentence is no
longer true, from the same document, without a superseding ADR whose only content is that sentence.
The two known cases are repaired in the pull request that establishes this, rather than accumulating
into a third.

**What it costs.** A third state — an ADR that is `Accepted`, unedited, and partly out of date — that
a reader has to know to look for. Mitigated only weakly: the section is at the end, and an ADR here
is long. A reader who stops at decision H still reads a false sentence. This convention makes the
correction **findable**, not unmissable, and that is the honest limit of it.

**The abuse this opens, and why it is accepted.** "Amend, do not supersede" is easier than writing a
new ADR, so the pressure will be to record decisions as amendments. D-3 draws the line and nothing
enforces it — `ADR003` can check a date, not whether a sentence changes what a reader should do.
That is a review question, permanently. It was accepted because the alternative on offer is the
status quo, which has already produced two uncorrected falsehoods and two workarounds that put the
correction where the ADR's reader will not see it.

**What would overturn this.** If the amendment logs start carrying decisions, or if an ADR
accumulates so many entries that the body no longer describes anything recognisable, the answer is
a superseding ADR for that document and a stricter reading of D-3 — not a fourth mechanism.

## Notes

- The three options in #147 were: leave it and note it on the issue; write a superseding ADR; or
  establish this convention. The first two were rejected for the reasons in *Context*: the first is
  what has already happened twice, and the second is disproportionate to a verb.
- **This ADR has no `## Amendments` section of its own**, and that is not an oversight — there is
  nothing to record yet. `ADR003` requires that the section, when present, has entries, precisely so
  that an empty one cannot be added pre-emptively and read as though it said something.
- `ADR003` skips fenced code blocks, which is why the example under D-1 can show the heading at
  column one without the rule reading it as this ADR's own section. The tests for that are in
  `scripts/check-repo-rules.test.sh`, both directions: a fenced example is not the section, and a
  fence does not blind the checker to a real section further down.
- **A setext heading after the section is deliberately not caught.** `Notes` underlined with hyphens
  is a heading in CommonMark, and `ADR003` matches only `#`-prefixed ones. A row of hyphens at
  column one is also a horizontal rule and a table separator, this repository writes no setext
  heading, and `strip_fences` settles the same question the same way for tilde fences: a rule that
  guesses at a syntax nobody uses is a rule nobody can predict. A test records the limit so it stays
  a decision rather than becoming an oversight.
- **Whether appending to a merged ADR is itself "editing it in place" was a live question**, raised
  in the review of [#150](https://github.com/openzigs/onyourleft/pull/150) against #119's third
  acceptance criterion and against the instruction on both issues to stop if you find yourself
  editing `0001-licence.md` or `0011-stream-storage.md`. It is answered **no**, on the ground that
  #147's option 3 — the option that comment goes on to endorse by name — *is defined as* appending
  to an existing ADR, so a reading under which the append is forbidden establishes a convention
  that can never be applied to the two documents it was established for, and leaves #147's third
  acceptance criterion (a reader arriving at ADR 0011 line 200 can tell the sentence is no longer
  true) unmet by anything short of the superseding ADR #147 rejected as disproportionate. The
  substantive test is the one D-2 states and the diff answers: **0 deletions, 0 modified lines**.
  The ruling is still the owner's, and it is cheap to reverse: each append is a trailing
  `## Amendments` section and nothing else in either file changed, so dropping both is deleting
  those two sections. What would then need a second edit is *Context* item 1 and 2 here and the
  first paragraph of *Consequences*, which say the two known cases were repaired in the pull request
  that established this. Nothing in `ADR003`, in the 0012 reservation or in the test harness depends
  on them.
- **`ADR003` checks a date's shape, not its validity** — `2026-13-99` passes, and a test records
  that it does so the rule is never credited with more than it checks. A calendar in the bash 3.2 a
  bare macOS clone ships is not worth the lines, and a typo in a date nobody disputes is not the
  failure this rule exists for.
- `scripts/check-repo-rules.sh` runs over a **fork's** tree in CI, so an ADR's text is untrusted
  input. The rule quotes the offending line into a message and derives line numbers from it, and
  neither reaches `eval`, a `printf` format string or bash arithmetic. There is a test that feeds it
  a command substitution and asserts the checker reports it and does not run it.
