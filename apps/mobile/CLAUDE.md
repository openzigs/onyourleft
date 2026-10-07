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

⚠️ Three Capacitor trees are **pruned rather than exempted** — the copied web build under
`android/app/src/main/assets/public`, `android/app/src/main/res/xml/config.xml`, and
`android/capacitor-cordova-android-plugins/`. `cap sync` regenerates all three and Capacitor's own
nested `.gitignore` keeps them out of the repository, so they are absent from a clean clone and an
`.spdx-exempt` entry naming one would be a `LIC006` violation. `.prettierignore` carries the same
three plus two generated JSON assets, because **Prettier reads only the root `.gitignore`, not a
nested one** — without it `format:check` reports a minified bundle on any machine where a sync has
run, which is a local-only red with no fix a contributor can apply.
