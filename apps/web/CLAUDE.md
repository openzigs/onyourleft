# apps/web — area instructions

Claude Code loads this file whenever a session works on files under `apps/web/`, on top of the root
[`CLAUDE.md`](../../CLAUDE.md), whose always-on rules still apply. Keep it short: it has an 8 KB budget
(`AGENT003`), and detail belongs in the topic files it points at. Same authority as the root.


## Always here

- Every file is **AGPL-3.0-or-later**: `// SPDX-License-Identifier: AGPL-3.0-or-later`.
- The Android shell ships this build, so the game and the HUD live here and not in `apps/mobile`.
- `src/privacy/no-network.test.ts` admits exactly one module for instance traffic (#777); a feature that
  works with no instance must keep working with none (the root's §1 invariants).
- A layout claim (`position`, `z-index`, `scroll-margin`, persistent chrome, a touch target) is
  measured in the browser gate, never read off the CSS: jsdom performs no layout.

## Read before working here

- [`docs/agents/web-client.md`](../../docs/agents/web-client.md) — anywhere in `apps/web` outside `src/game/`.
- [`docs/agents/game.md`](../../docs/agents/game.md) §4h — the trainer game, `src/game/`.
- [`docs/agents/accessibility.md`](../../docs/agents/accessibility.md) §4e — a route, a view, a token or a contrast pair.
- [`docs/agents/browser-gate.md`](../../docs/agents/browser-gate.md) §4f — `browser/`, a Playwright spec, layout, the map, the offline worker.
- [`docs/agents/wiring-gate.md`](../../docs/agents/wiring-gate.md) §4j — a module in `src/game/`, `ride/`, `offline/`, `net/`, or a `*-port.ts`.
- [`docs/agents/web-bluetooth.md`](../../docs/agents/web-bluetooth.md) — pairing, reconnection, or any GATT promise.
