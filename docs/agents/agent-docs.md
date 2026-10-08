# How the agent instructions are organised

An agent-instruction topic file. The root [`CLAUDE.md`](../../CLAUDE.md) holds the always-on rules and the map;
this file holds the description of the index and the topic map as #1156 wrote them, moved out of the root verbatim on 2026-10-07 (#1170) so that it is loaded
only when it is needed. **Read it when you add or move agent instructions, touch `AGENT001`–`AGENT003`, or run the conservation check.**

Same authority as the root. In the text below, "this file" and "CLAUDE.md" mean the root, the
area `CLAUDE.md` files and `docs/agents/` together, and a bare section number such as "§7" is
found through the root's topic map.

---


## The arrangement since #1170

Three layers, each loaded only as far as a session needs it:

1. The root `CLAUDE.md`, loaded into every session on every turn: the always-on rules, the essential
   commands and the topic map. **15 KB budget** (15 360 bytes), `AGENT002`.
2. An area `CLAUDE.md` — `apps/web/`, `apps/instance/`, `apps/mobile/`, `packages/` — which Claude Code
   loads when a session works on files beneath it: the area's own rules and which topic files to read
   there. **8 KB budget each** (8 192 bytes), `AGENT003`.
3. The topic files under `docs/agents/`, read when the work reaches their subject. Every one is linked
   from the root's map (`AGENT001`).

Nothing was reworded when text moved between them. `scripts/check-agent-docs-conservation.sh --exact`
against a tree of the previous state proves that every non-blank line is still there exactly as often
(link targets aside, because a moved relative link is retargeted); `commands.md` §4a says how to run it.

## The index as #1156 left it, kept verbatim

⚠️ The text below described the root between 2026-10-05 and 2026-10-07. Its **48 KB** budget and its
claim that §2–§8 are in the root are the old file: the budget is 15 KB, and the map in the root says
where each section is now. It is kept because the move that replaced it moves text and deletes none.

This file is the **index**: the hard rules and invariants every task needs, the essential
commands, the conventions, and a map. Everything else lives in topic files under
[`docs/agents/`](./), moved there verbatim so that a session loads only what it uses.
**Read the topic file the map below names before working in its area** — it has the same
authority as this file. A reference elsewhere in the repository to "CLAUDE.md" with no file
beside it means this index and those topic files together; a section number (§4c, §4f …) is
found through the topic map's second column.

> ⚠️ **HARD RULE — do not add detail to this file.** New rules, gotchas, measurements and history
> go in the matching `docs/agents/` topic file. Only a genuinely new topic gets a one-line entry
> in the topic map below. This file has a **48 KB budget** (49 152 bytes), enforced by `AGENT002`
> in `pnpm run check:repo`: it is loaded into every agent session on every turn, and it grew from
> 97 KB to 659 KB in a month because detail kept being appended here.

| File | Sections | Read it when |
|---|---|---|
| [`docs/agents/commands.md`](commands.md) | §4a | You need a command beyond the handful in the root, want to know what a check prints or enforces (the rule tables: LIC, ADR, SPIKE, REL, XML, SH, ASSET, ENV, DOC, DEP), or the stack table |
| [`docs/agents/project-state.md`](project-state.md) | §4b | You are about to claim something exists, works, or has been verified — Android, sensors, the FIT codec, the store, physics, rooms, sync — or are adding a dependency |
| [`docs/agents/ci.md`](ci.md) | §4c | You touch `.github/workflows/`, add or move a gate, change a timeout or a Vitest case timeout, move something to the nightly job, or read a CI timing |
| [`docs/agents/lint-boundaries.md`](lint-boundaries.md) | §4d | You add an import across packages, touch `eslint.config.js` or a package tsconfig, or work in a platform-free package (`packages/domain`, `physics`, `sensors`, `protocol`, the instance core) |
| [`docs/agents/accessibility.md`](accessibility.md) | §4e | You add or change a route, a view, a design token, a contrast pair, or a `*.a11y.test.*` file |
| [`docs/agents/browser-gate.md`](browser-gate.md) | §4f | You touch anything under `apps/web/browser/`, a Playwright spec or harness page, layout, position, z-index, touch targets, the map, the offline worker, or `playwright.config.ts` |
| [`docs/agents/licence-gates.md`](licence-gates.md) | §4g, part of §3 | You add, remove or bump a dependency, or touch the third-party notices |
| [`docs/agents/route-planning.md`](route-planning.md) | §4i | You work on route planning, the routing interface, or anything that would talk to a routing engine |
| [`docs/agents/wiring-gate.md`](wiring-gate.md) | §4j | You add a module under `apps/web/src/game/`, `ride/`, `offline/`, `net/`, a `*-port.ts`, touch the trainer-command seam in `packages/`, or write `@unwired` / `@test-facing` |
| [`docs/agents/generated-and-cost-gates.md`](generated-and-cost-gates.md) | §4k, §4l | You bump Capacitor, touch the committed Gradle files `cap sync` writes, or edit `docs/cost-model.md` |
| [`docs/agents/web-client.md`](web-client.md) | §2 tree: `apps/web` | You work anywhere in `apps/web` outside `src/game/` — the shell, design system, map, ride screen, recording, offline, privacy, the side camera (`src/camera/`), instance client, rooms, ride analysis, the browser harness pages, or the asset/brand/font tools |
| [`docs/agents/game.md`](game.md) | §4h, §2 tree: `apps/web/src/game` | You work on the trainer game — the simulation, renderer, camera, bicycle, racing line, scenery, terrain, water, settlements, HUD, gradient control, the realistic world — or wonder why it is in `apps/web` and not `apps/mobile` |
| [`docs/agents/mobile.md`](mobile.md) | §2 tree: `apps/mobile` | You work in `apps/mobile` (also read `apps/mobile/README.md` and `apps/mobile/RELEASE.md`) |
| [`docs/agents/instance.md`](instance.md) | §2 tree: `apps/instance` | You work in `apps/instance` — the server, its store, identity, sync, the history index, the room core and its adapters, or a rider's rooms |
| [`docs/agents/packages.md`](packages.md) | §2 tree: `packages/` | You work in any package under `packages/` (and read that package's own README) |
| [`docs/agents/coverage.md`](coverage.md) | part of §5 | You touch the coverage configuration, read a coverage figure, or wonder why a file reads as untested |
| [`docs/agents/store-harness.md`](store-harness.md) | part of §5 | You write or test anything that persists data — a store write path, a migration, a fake |
| [`docs/agents/workout-format.md`](workout-format.md) | part of §6 | You touch workouts, their file format, or an import of somebody else's workout format |
| [`docs/agents/adr-numbering.md`](adr-numbering.md) | part of §7 | You are about to write an ADR and need to know which numbers were taken, by what, and why some were reserved (the next free number itself stays in the root) |
| [`docs/agents/toolchain.md`](toolchain.md) | part of §8 | You bump TypeScript, Node, Vitest or pnpm, add a dependency with an install script, touch `pnpm-workspace.yaml`, or test the recorder's auto-pause |
| [`docs/agents/where-to-look.md`](where-to-look.md) | §9 | You need to find which file answers a question — grep this file for a keyword rather than reading it end to end |

Section numbers are stable, because the rest of the repository cites them: §1, §2 (the packages
table and the top level), §3, §3a, §4 (the essentials), §5, §6, §7 and §8 are in this file, and
every other section, or part of one, is in the file the map names in its second column.

## 9. Where to look

The question-to-file table is [`docs/agents/where-to-look.md`](where-to-look.md) — grep it for a keyword rather
than reading it end to end.
