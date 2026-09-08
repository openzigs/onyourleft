<!--
Two things in this template have cost this repository real incidents. They are
the two with a ⚠️. Everything else is ordinary.
-->

## What this changes

<!-- One paragraph. What a reviewer needs before they read the diff. -->

## Issue

<!--
⚠️ THE CLOSING KEYWORD MUST BE RIGHT WHEN THE PULL REQUEST IS OPENED.

GitHub creates the issue link at open time and **editing this body afterwards
does not remove it** — nor does overriding the squash message on merge. An issue
linked by `Closes #N` that was later softened to `Refs #N` still closes, and the
close event carries no commit id, which is the only outward tell. This cost #42,
#43 and #31, each closed against an explicit written decision not to.

Use `Refs #N` when any acceptance criterion is deferred, needs hardware nobody
in the loop has, or is otherwise not discharged by this pull request.

Prose counts too: #29 was closed by a `Resolves #29` inside an ADR table cell.
-->

Closes #
<!-- or: Refs # -->

## Mutations

<!--
⚠️ THIS IS THE GATE. CLAUDE.md §5: there is no coverage percentage in this
repository and you must not add one — the mutation list is what stands in for
it. For each meaningful test: break the implementation, watch the test go red,
restore it, and record what went red here.

A mutation that comes back GREEN is a finding. Report it and fix it; do not
drop it from the list.

  M1  <what you broke>                        RED (<n> tests)
  M2  <what you broke>                        GREEN -> RED, see below
-->

| Mutation | Result |
| --- | --- |
|  |  |

## Gate

<!-- Tick what you actually ran. An unticked box is more useful than a wrong tick. -->

- [ ] `pnpm run check:repo`
- [ ] `pnpm run format:check`
- [ ] `pnpm run lint`
- [ ] `pnpm run typecheck`
- [ ] `pnpm run test`
- [ ] `pnpm run build`
- [ ] `pnpm run check:licences` (if any dependency changed)
- [ ] `pnpm run test:browser` (if `apps/web/src/map/` or the harness changed)

## What is NOT discharged

<!--
Anything an acceptance criterion asks for that this pull request does not
deliver, and what would settle it. "Nothing" is a fine answer. A criterion
reported as met when nothing checked it is worse than one reported as open.
-->
