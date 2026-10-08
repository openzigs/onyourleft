# What this is, and the repository layout

An agent-instruction topic file. The root [`CLAUDE.md`](../../CLAUDE.md) holds the always-on rules and the map;
this file holds the rest of §1 (the v0.1 milestone and the instance) and §2's top level of the tree, moved out of the root verbatim on 2026-10-07 (#1170) so that it is loaded
only when it is needed. **Read it when you need the shape of the repository above one area, or the history of the server ruling.**

Same authority as the root. In the text below, "this file" and "CLAUDE.md" mean the root, the
area `CLAUDE.md` files and `docs/agents/` together, and a bare section number such as "§7" is
found through the root's topic map.

---


Decisions here are recorded in [`docs/adr/0005-tech-stack.md`](../adr/0005-tech-stack.md); the
layout and component boundaries are in [`docs/architecture.md`](../architecture.md).

## 1. What this is — the rest of it

The first milestone (v0.1) was deliberately small and **entirely local**: pair a BLE trainer, record
a ride, store it, view it, with no server, no account and no hosting bill. **That client is still the
whole product for a rider who wants nothing more**, and it stays that way.

**There is now a server as well: `apps/instance`**, the one self-hostable instance
([ADR 0036](../adr/0036-a-self-hostable-instance-server-now.md), the owner's ruling of 2026-09-28;
[ADR 0037](../adr/0037-instance-runtime-hosting-and-transport.md) for how it is built). Accounts
(#6), sync and ingestion (#7), self-hosting (#17) and race rooms (#16) are built on it. Its first
deploy is a Docker image on the owner's own machine behind a Cloudflare Tunnel (#807) — **no hosting
bill is implied**, and no issue may take a paid service as a prerequisite (ADR 0036 D-7).

## 2. Repository layout

The whole tree, one entry per directory with what it holds and why, is split by area across
[`docs/agents/web-client.md`](web-client.md), [`docs/agents/game.md`](game.md), [`docs/agents/mobile.md`](mobile.md), [`docs/agents/instance.md`](instance.md), [`docs/agents/packages.md`](packages.md). Read the one for the directory you are working in. The top level:

```
apps/                 AGPL-3.0-or-later, without exception

packages/             Apache-2.0, without exception

docs/
  architecture.md     layout, component boundaries, ADR index
  cost-model.md       what "free to the end user" costs and who pays it (#54) —
                      the inputs with their provenance, what follows from them at
                      three populations, and the line item that dominates at each.
                      ⚠️ Its arithmetic is a GATE, not prose: `check:cost-model`
                      recomputes every figure from the inputs beside it, so
                      editing a rate without the table is a red build. §4l
  adr/                numbered architecture decision records
  spikes/             numbered spike write-ups — a dated measurement, not a decision
  validation/         numbered hardware-validation procedures — a script for one
                      afternoon, with its result tables empty until somebody runs
                      it. Not an ADR and not a spike; it decides nothing

scripts/              dependency-free repository checks; run on a bare clone

.spdx-exempt          the files LIC001/LIC002 do not apply to, one exact path at a
                      time — third-party generator output only, enforced by LIC006

ASSETS.toml           the provenance, licence and SHA-256 of every committed
                      BINARY, which is the one file class no SPDX header can
                      reach and no dependency gate ever sees (#339). Enforced by
                      ASSET001–ASSET005, and ⚠️ discovery walks for binaries by
                      CONTENT rather than by extension, which is what stops a
                      `.gltf` beside a `.glb` reintroducing the hole

.github/
  workflows/rules.yml runs those checks on every pull request — see §4c
  dependabot.yml      weekly version updates, so DEP001 sees a bump before a
                      human does — and the minimumReleaseAge collision it causes
  pull_request_template.md
                      the closing keyword and the mutation list, because §7 and
                      §5 are the two rules a template can actually enforce
  ISSUE_TEMPLATE/     bug and feature, both routing a security report away from
                      a public issue
```
