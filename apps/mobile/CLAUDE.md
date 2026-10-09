# apps/mobile — area instructions

Claude Code loads this file whenever a session works on files under `apps/mobile/`, on top of the root
[`CLAUDE.md`](../../CLAUDE.md), whose always-on rules still apply. Keep it short: it has an 8 KB budget
(`AGENT003`), and detail belongs in the topic files it points at. Same authority as the root.


## Always here

- Every file this repository authors or edits is **AGPL-3.0-or-later**. Capacitor's own generated
  files are listed one exact path at a time in `.spdx-exempt` (§3a, `LIC006`) and carry no header.
- The shell wraps `apps/web`'s build: client code written here is never copied into the APK. The
  trainer game and HUD live in `apps/web/src/game/` ([`docs/agents/game.md`](../../docs/agents/game.md) §4h).
- CI builds no Android. Do not claim an Android behaviour works until a validation part is filled in.

## Read before working here

- [`docs/agents/mobile.md`](../../docs/agents/mobile.md) — what each directory here holds.
- [`README.md`](README.md) and [`RELEASE.md`](RELEASE.md) — what has and has not been proved, and signing.
- [`docs/agents/generated-and-cost-gates.md`](../../docs/agents/generated-and-cost-gates.md) §4k — before bumping Capacitor.
- [`docs/agents/web-bluetooth.md`](../../docs/agents/web-bluetooth.md) — Bluetooth's limits on both platforms.

## The Capacitor trees that are pruned, not exempted

`cap sync` writes three trees that are pruned from every rule rather than listed in `.spdx-exempt`,
and `.prettierignore` names them too. Which three, and why an exemption naming one would fail, is
[`docs/agents/licence-boundary.md`](../../docs/agents/licence-boundary.md) §3a.
