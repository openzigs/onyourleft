# Conventions in full

An agent-instruction topic file. The root [`CLAUDE.md`](../../CLAUDE.md) holds the always-on rules and the map;
this file holds the §7 conventions beyond the root's always-on ones: branches, the closing-keyword history, ADRs and their next free number, spikes, the changelog, and the protected-paths table, moved out of the root verbatim on 2026-10-07 (#1170) so that it is loaded
only when it is needed. **Read it when you open a branch or pull request, write an ADR or a spike, or edit a protected path.**

Same authority as the root. In the text below, "this file" and "CLAUDE.md" mean the root, the
area `CLAUDE.md` files and `docs/agents/` together, and a bare section number such as "§7" is
found through the root's topic map.

---


## 7. Conventions — the full list

- **Branches**: `feature/issue-{number}-{slug}`, from `main`. (Observed convention — `#18` used
  `feature/issue-18-licence`.)
- **A closing keyword must be correct when the pull request is OPENED.** GitHub creates the
  issue link at open time, and **editing the body afterwards does not remove it** — neither
  does overriding the squash commit message with `gh pr merge --body`. An issue linked by an
  `Closes #N` that was later softened to `Refs #N` still closes on merge, and the close event
  carries no commit id, which is the only outward tell. This cost #42, #43 and #31, each of
  which was closed against an explicit, written decision not to close it. If a PR must not
  close an issue — because an acceptance criterion is deferred, or needs hardware nobody in
  the loop has — **write `Refs #N` in the body you open with**. If you discover it too late,
  the honest repair is to file the remainder as its own issue and say on the closed one what
  happened; reopening leaves a mostly-done issue open for something that is really separate
  work. Prose that merely *mentions* a keyword counts too: #29 was closed by `Resolves #29`
  inside an ADR table cell.
- **ADRs**: `docs/adr/NNNN-kebab-case.md`, with **Status, Context, Decision, Consequences** —
  and since [#416](https://github.com/openzigs/onyourleft/issues/416) that is `ADR004` rather than
  prose. ⚠️ A reviewer who remembers this sentence being unenforced is reading the old file:
  deleting an ADR's `- **Status**: Accepted` line used to leave `check-repo-rules.sh` reporting
  clean at exit 0. Numbers are unique and `ADR001` enforces it. Check `docs/architecture.md` for which numbers are taken
  **and which are claimed by open issues** before you pick one. **The next free number is 0046.**
  Which numbers were taken, by which issue and when, and the reservations, are the record in
  [`docs/agents/adr-numbering.md`](adr-numbering.md); read it before picking one.
- **Spikes**: `docs/spikes/NNNN-kebab-case.md`. A spike write-up is **not an ADR and does not
  decide anything** — it is a dated measurement that an ADR or an issue may then rest on, and it
  ages the way a measurement does. `scripts/check-repo-rules.sh`'s `ADR003` and `ADR004` are scoped
  to `docs/adr/` and do not apply — a spike has no Status and no Decision to be missing. ⚠️ **The
  numbering rules DO apply since [#493](https://github.com/openzigs/onyourleft/issues/493), and a
  reviewer who remembers the whole `ADR00*` family being out is reading the old file**: `SPIKE001`
  and `SPIKE002` are siblings of `ADR001` and `ADR002` rather than a widening of them, because the
  remedy differs. Do not renumber one, and do not edit a finding out of one: if a later run
  contradicts it, that is a second write-up. **A colliding number is resolved by the file that has
  not merged taking the next free one** — which is why `SPIKE001`'s message says that and `ADR001`'s
  does not.
- **Changelog**: there is **no `CHANGELOG.md` and no changelog convention** in this repository. Do
  not add one as a drive-by; if a release needs one, that is its own issue.

### The protected paths, with their reasons

| Path | Why |
|---|---|
| `LICENSE` | Byte-identical AGPL-3.0 text. Editing licence text is itself a licensing problem. SHA-256 recorded in ADR 0001. |
| `LICENSES/Apache-2.0.txt` | Same, for Apache-2.0. |
| `COPYRIGHT` | Copyright is held by "The On Your Left contributors", each retaining their own. ⚠️ Since [ADR 0025](../adr/0025-app-store-additional-permission.md) it also carries the **GNU AGPL §7 additional permission** for the Apple App Store and Google Play. That paragraph is a licence grant in the copyright holders' name: **rewording it is a legal act, not an edit**, and widening it needs every contributor's consent. |
| `docs/adr/*.md` | An ADR is amended by a **new** ADR that supersedes it, not by editing it in place — **with one narrow exception, [ADR 0013](../adr/0013-adr-amendments.md)**: a dated entry may be **appended** to an `## Amendments` section at the end of the file, recording that a statement of fact in the body has become false. The body is still never edited, `Status` does not change, and **reversing a decision still needs a superseding ADR**. Rule `ADR003` checks the shape; it cannot check that the change was an append, so a reviewer reading a `docs/adr/` diff asks the one question that matters — **does any hunk touch a line that already existed?** |
