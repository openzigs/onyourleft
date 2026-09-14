#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for scripts/check-wiring.mjs.
#
# Same shape as the other suites: each case builds a throwaway repository, runs
# the checker against it, and asserts on the output and the exit code.
#
# ⚠️ **The cases that matter are the ones where it must go RED**, and five of
# them are #278's five defects, reproduced from the tree as it actually was. A
# rule that cannot reproduce the cases that motivated it is the thing #278
# exists to prevent, so each historical case carries the commit its shape was
# read out of and can be checked against it:
#
#   git show f09c6e9^:apps/mobile/src/ble/plugin-port.ts   # 230
#   git show a023387^:apps/web/src/game/hud/fields.ts      # 237
#   git show 05b3fcf^:apps/web/src/game/hud/fields.ts      # 252 — stays GREEN
#   git show 0be92ee^:apps/web/src/game/scene.ts           # 259
#
# Two of the five are green on purpose and say so in their names. #236 is a CSS
# class with no rule and #252 is a union branch a caller never selects; both are
# in `check-wiring.mjs` §Limits, and a limit nobody has pinned is a limit that
# quietly becomes a false claim.
#
# Unlike the four bare-clone checkers this one needs Node and an install (it
# parses TypeScript with the compiler's own parser), so it is NOT part of
# `pnpm run check:repo`.
#
# Run: bash scripts/check-wiring.test.sh

# The assertions hold literal Markdown-ish text with backticks that must reach
# `grep -F` unexpanded, so they are single-quoted and SC2016 is the intended
# shape. Same call as scripts/check-a11y-suite.test.sh makes.
# shellcheck disable=SC2016

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="${SCRIPT_DIR}/check-wiring.mjs"

pass=0
fail=0
tmp=""

cleanup() { [ -n "${tmp}" ] && rm -rf "${tmp}"; }
trap cleanup EXIT

# new_fixture -- a repository with one app, its page, and an empty entry module.
#
# ⚠️ Both watched directories are created even when a case writes into neither:
# since #283 a WATCHED_PREFIXES entry naming a directory that is not there is a
# hard failure, so a fixture without them would exercise that rule instead of
# the one it is about. The case that DOES exercise it removes one deliberately.
new_fixture() {
  tmp="$(mktemp -d)"
  mkdir -p "${tmp}/apps/web/src/game" "${tmp}/apps/web/src/ride"
  printf '{"name":"onyourleft","private":true}' > "${tmp}/package.json"
  printf '{"name":"@onyourleft/web","private":true}' > "${tmp}/apps/web/package.json"
  cat > "${tmp}/apps/web/index.html" <<'HTML'
<!doctype html>
<html lang="en">
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
HTML
  : > "${tmp}/apps/web/src/main.tsx"
}

# write <relative path> -- file contents on stdin.
write() {
  mkdir -p "$(dirname "${tmp}/$1")"
  cat > "${tmp}/$1"
}

# run_check -- output on stdout+stderr, exit code in ${code}.
run_check() {
  out="$(node "${CHECK}" --root "${tmp}" 2>&1)"
  code=$?
}

assert_green() {
  local name="$1"
  if [ "${code}" -eq 0 ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL: %s\n  expected exit 0, got %d:\n%s\n\n' "${name}" "${code}" "${out}"
  fi
}

assert_red() {
  local name="$1"
  if [ "${code}" -ne 0 ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL: %s\n  expected a non-zero exit, got 0:\n%s\n\n' "${name}" "${out}"
  fi
}

assert_says() {
  local name="$1" expected="$2"
  if printf '%s' "${out}" | grep -qF -- "${expected}"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL: %s\n  expected to contain: %s\n  got:\n%s\n\n' "${name}" "${expected}" "${out}"
  fi
}

assert_silent_about() {
  local name="$1" unexpected="$2"
  if printf '%s' "${out}" | grep -qF -- "${unexpected}"; then
    fail=$((fail + 1))
    printf 'FAIL: %s\n  expected NOT to mention: %s\n  got:\n%s\n\n' "${name}" "${unexpected}" "${out}"
  else
    pass=$((pass + 1))
  fi
}

# --- The wired case ----------------------------------------------------------
new_fixture
write apps/web/src/main.tsx <<'TS'
import { startRide } from './ride/controller';
startRide();
TS
write apps/web/src/ride/controller.ts <<'TS'
export function startRide(): void {}
TS
run_check
assert_green 'a symbol the entry point reaches passes'
assert_says 'and says how much it walked' 'production modules'

# --- WIRE002: an export nothing names ----------------------------------------
# #259 in its general form.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { startRide } from './ride/controller';
startRide();
TS
write apps/web/src/ride/controller.ts <<'TS'
export function startRide(): void {}
export function stopRide(): void {}
TS
run_check
assert_red 'an export no production declaration names fails'
assert_says 'and names the rule, the file, the line and the symbol' 'WIRE002 apps/web/src/ride/controller.ts:2'
assert_says 'and names the symbol itself' '`stopRide`'

# --- WIRE002 is not satisfied by a test ---------------------------------------
# ⚠️ The case the whole gate turns on: every one of #278's five defects was
# unit-tested and green. A test importing the symbol must not make it wired.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { startRide } from './ride/controller';
startRide();
TS
write apps/web/src/ride/controller.ts <<'TS'
export function startRide(): void {}
export function stopRide(): void {}
TS
write apps/web/src/ride/controller.test.ts <<'TS'
import { stopRide } from './controller';
stopRide();
TS
run_check
assert_red 'a test calling it does not count as wiring'
assert_says 'and still names it' '`stopRide`'

# --- WIRE002 is not satisfied by the browser harness --------------------------
# #236: the browser gate drove its OWN canvas, not the product's.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { startRide } from './ride/controller';
startRide();
TS
write apps/web/src/ride/controller.ts <<'TS'
export function startRide(): void {}
export function stopRide(): void {}
TS
write apps/web/browser/index.html <<'HTML'
<!doctype html>
<html lang="en"><body><script type="module" src="./harness.ts"></script></body></html>
HTML
write apps/web/browser/harness.ts <<'TS'
import { stopRide } from '../src/ride/controller';
stopRide();
TS
run_check
assert_red 'a harness page is not a production entry point'
assert_says 'and the symbol it alone reaches is still reported' '`stopRide`'

# --- WIRE002 green once something production reaches it -----------------------
new_fixture
write apps/web/src/main.tsx <<'TS'
import { startRide, stopRide } from './ride/controller';
startRide();
stopRide();
TS
write apps/web/src/ride/controller.ts <<'TS'
export function startRide(): void {}
export function stopRide(): void {}
TS
run_check
assert_green 'wiring it up clears the finding'

# --- WIRE002 sees JSX, shorthand and a namespace import -----------------------
new_fixture
write apps/web/src/main.tsx <<'TS'
import * as game from './game/panel';
const renderer = await import('./game/renderer');
const options = { hud: game.Hud };
renderer.draw(options);
TS
write apps/web/src/game/panel.tsx <<'TSX'
export function Hud(): null {
  return null;
}
TSX
write apps/web/src/game/renderer.ts <<'TS'
export function draw(options: unknown): void {
  void options;
}
TS
run_check
assert_green 'a namespace import and a literal dynamic import are both wiring'

# --- WIRE001: a module nothing imports ---------------------------------------
new_fixture
write apps/web/src/main.tsx <<'TS'
import { startRide } from './ride/controller';
startRide();
TS
write apps/web/src/ride/controller.ts <<'TS'
export function startRide(): void {}
TS
write apps/web/src/game/scene.ts <<'TS'
export function buildScene(): void {}
TS
run_check
assert_red 'a watched module no production module imports fails'
assert_says 'and names the file rather than each of its exports' 'WIRE001 apps/web/src/game/scene.ts'
assert_says 'and says what that means' 'none of it ships'

# --- WIRE003: #230, a port method called only from an uncalled method ---------
# Shape read from `git show f09c6e9^:apps/mobile/src/ble/plugin-port.ts` and its
# transport: `initialize()` was on the port, implemented, and named only inside
# `availability()` — which nothing in apps/web ever called.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { createTransport } from './ble/transport';
const transport = createTransport();
await transport.discover();
TS
write apps/web/src/ble/plugin-port.ts <<'TS'
export interface BlePluginPort {
  initialize(): Promise<void>;
  requestDevice(): Promise<string>;
}
TS
write apps/web/src/ble/transport.ts <<'TS'
import type { BlePluginPort } from './plugin-port';

declare const plugin: BlePluginPort;

export function createTransport(): { discover(): Promise<string>; availability(): Promise<void> } {
  return {
    async discover() {
      return plugin.requestDevice();
    },
    async availability() {
      await plugin.initialize();
    },
  };
}
TS
run_check
assert_red '#230: a port method reached only from a method nothing calls fails'
assert_says 'and names the port member' '`BlePluginPort.initialize`'
assert_says 'and says why the call inside availability() did not count' 'that is #230 exactly'
assert_silent_about 'and says nothing about the method that IS called' '`BlePluginPort.requestDevice`'

# --- WIRE003 green once the call sits on a reachable path --------------------
# The #230 fix: `ensureInitialized`, called from `discover()`.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { createTransport } from './ble/transport';
const transport = createTransport();
await transport.discover();
TS
write apps/web/src/ble/plugin-port.ts <<'TS'
export interface BlePluginPort {
  initialize(): Promise<void>;
  requestDevice(): Promise<string>;
}
TS
write apps/web/src/ble/transport.ts <<'TS'
import type { BlePluginPort } from './plugin-port';

declare const plugin: BlePluginPort;

export function createTransport(): { discover(): Promise<string> } {
  return {
    async discover() {
      await plugin.initialize();
      return plugin.requestDevice();
    },
  };
}
TS
run_check
assert_green '#230: the fix that moved the call onto the pairing path is green'

# --- WIRE003 does not report a data field ------------------------------------
# A port's readonly data is not a call, and reporting one is how this becomes
# the noisy rule #278 says not to build.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { openStore } from './store/adapter';
await openStore().listRides();
TS
write apps/web/src/store/store-port.ts <<'TS'
export interface RideStore {
  readonly athleteId: string;
  listRides(): Promise<void>;
}
TS
write apps/web/src/store/adapter.ts <<'TS'
import type { RideStore } from './store-port';

export function openStore(): RideStore {
  return { athleteId: 'a', listRides: () => Promise.resolve() };
}
TS
run_check
assert_green 'a port field that is data rather than a call is not reported'

# --- WIRE003: a destructured call counts -------------------------------------
# Missing this reads every destructured consumer as no consumer at all.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { openStore } from './store/adapter';
import type { RideStore } from './store/store-port';

function show({ listRides }: RideStore): void {
  void listRides();
}
show(openStore());
TS
write apps/web/src/store/store-port.ts <<'TS'
export interface RideStore {
  listRides(): Promise<void>;
}
TS
write apps/web/src/store/adapter.ts <<'TS'
import type { RideStore } from './store-port';

export function openStore(): RideStore {
  return { listRides: () => Promise.resolve() };
}
TS
run_check
assert_green 'a destructured call is a call'

# --- #237: the pacer, as the tree actually was -------------------------------
# `git show a023387^`: `advanceBot` had no caller and `SceneInput.botDistance`
# was declared, optional and never supplied, so the HUD's PACER field read an em
# dash for a whole ride. ⚠️ `advanceBot` itself lived in `packages/physics`,
# which this gate does not watch (see WATCHED_PREFIXES); what it reports on that
# tree is the client half of the same missing wiring, `gapAgainst`.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { hudFields } from './game/hud/fields';
hudFields();
TS
write apps/web/src/game/hud/fields.ts <<'TS'
export function hudFields(): string[] {
  return ['power', 'cadence'];
}

/** The gap to a chased rider, in seconds. Built, tested, and called by nobody. */
export function gapAgainst(theirDistance: number): number {
  return theirDistance;
}
TS
run_check
assert_red '#237: the pacer gap the HUD never asked for fails'
assert_says 'and names it' '`gapAgainst`'

# --- #259: ghostFinished -----------------------------------------------------
# `git show 0be92ee^:apps/web/src/game/scene.ts`: exported, unit-tested, green,
# and computed by nobody, so a rider who beat their own best was never told.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { sceneFrame } from './game/scene';
sceneFrame();
TS
write apps/web/src/game/scene.ts <<'TS'
export function sceneFrame(): void {}

/** Whether the ghost has crossed the line. */
export function ghostFinished(elapsed: number, total: number): boolean {
  return elapsed >= total;
}
TS
write apps/web/src/game/scene.test.ts <<'TS'
import { ghostFinished } from './scene';
ghostFinished(1, 2);
TS
run_check
assert_red '#259: a predicate nothing computes fails, unit test and all'
assert_says 'and names it' '`ghostFinished`'

# --- #252: the ghost's gap, which this gate deliberately does NOT catch ------
# `git show 05b3fcf^`: `gapReading` read `gapTo === 'ghost'` and `GameView`
# could only ever pass `'bot'`. Both names are perfectly reachable, so the gate
# is silent — measured against the real tree, and pinned here so the limit
# cannot quietly become a false claim. See check-wiring.mjs §Limits.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { gapReading } from './game/hud/fields';
gapReading(12, 'bot');
TS
write apps/web/src/game/hud/fields.ts <<'TS'
export function gapReading(gap: number, gapTo: 'bot' | 'ghost'): string {
  return gapTo === 'ghost' ? `Your best ${String(gap)}` : `Pacer ${String(gap)}`;
}
TS
run_check
assert_green '#252: a union branch no caller selects is a STATED LIMIT, not a finding'

# --- #236: the canvas class with no rule, also not this gate's job -----------
# The issue says so itself: a CSS class with no rule is a different search, and
# it belongs with #266.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { GameCanvas } from './game/GameView';
GameCanvas();
TS
write apps/web/src/game/GameView.tsx <<'TSX'
export function GameCanvas(): string {
  return '<canvas class="oyl-game__world"></canvas>';
}
TSX
write apps/web/src/design/theme.css <<'CSS'
/* SPDX-License-Identifier: AGPL-3.0-or-later */
.oyl-shell {
  display: block;
}
CSS
run_check
assert_green '#236: a class with no CSS rule is a STATED LIMIT, not a finding'

# --- The exemption -----------------------------------------------------------
new_fixture
write apps/web/src/main.tsx <<'TS'
import { startRide } from './ride/controller';
startRide();
TS
write apps/web/src/ride/controller.ts <<'TS'
export function startRide(): void {}

/**
 * The longest a procedure may go unanswered.
 *
 * @unwired a bound `controller.test.ts` asserts against; nothing reads it.
 */
export const PROCEDURE_TIMEOUT = 5;
TS
run_check
assert_green 'an @unwired declaration with a reason passes'

new_fixture
write apps/web/src/main.tsx <<'TS'
import { startRide } from './ride/controller';
startRide();
TS
write apps/web/src/ride/controller.ts <<'TS'
export function startRide(): void {}

/** @unwired */
export const PROCEDURE_TIMEOUT = 5;
TS
run_check
assert_red 'an @unwired with no reason fails'
assert_says 'and says why a bare tag is refused' 'with extra steps'

# --- A reasonless tag is refused on the WIRE001 path too ---------------------
# ⚠️ The file-comment exemption is the BROADEST of the three — it silences a
# whole module — and it was the one branch with no fixture, which is how it
# shipped reading a reasonless tag as "exempt" (`unwiredReason` returns `null`
# there, not `undefined`). One fixture per exemption path, not per rule.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { startRide } from './ride/controller';
startRide();
TS
write apps/web/src/ride/controller.ts <<'TS'
export function startRide(): void {}
TS
write apps/web/src/segments/match-port.ts <<'TS'
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the sweep needs from the store.
 *
 * @unwired
 */

export interface MatchStore {
  listActivities(): Promise<void>;
}
TS
run_check
assert_red 'a bare @unwired in a file comment does not exempt the whole module'
assert_says 'and reports it as a reasonless tag rather than silently passing' 'WIRE000 apps/web/src/segments/match-port.ts'
assert_says 'and says why a bare tag is refused there too' 'with extra steps'

# --- The exemption reaches a port method and a whole module ------------------
new_fixture
write apps/web/src/main.tsx <<'TS'
import { openStore } from './store/adapter';
await openStore().listRides();
TS
write apps/web/src/store/store-port.ts <<'TS'
export interface RideStore {
  listRides(): Promise<void>;
  /**
   * The unacknowledged sibling.
   *
   * @unwired declared so that nothing calls it; a test asserts it stays
   * uncalled, which is CLAUDE.md §4h's `writeWithoutResponse`.
   */
  writeWithoutResponse(): Promise<void>;
}
TS
write apps/web/src/store/adapter.ts <<'TS'
import type { RideStore } from './store-port';

export function openStore(): RideStore {
  return { listRides: () => Promise.resolve(), writeWithoutResponse: () => Promise.resolve() };
}
TS
run_check
assert_green 'a port sibling declared so nothing calls it passes when it says so'

new_fixture
write apps/web/src/main.tsx <<'TS'
import { startRide } from './ride/controller';
startRide();
TS
write apps/web/src/ride/controller.ts <<'TS'
export function startRide(): void {}
TS
write apps/web/src/segments/match-port.ts <<'TS'
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the sweep needs from the store.
 *
 * @unwired #282 — nothing runs the matcher yet, and that is a defect with an
 * issue rather than a decision.
 */

export interface MatchStore {
  listActivities(): Promise<void>;
}
TS
run_check
assert_green 'a module exempted in its own file comment passes'

# --- A test-support file is neither watched nor production -------------------
new_fixture
write apps/web/src/main.tsx <<'TS'
import { startRide } from './ride/controller';
startRide();
TS
write apps/web/src/ride/controller.ts <<'TS'
export function startRide(): void {}
TS
write apps/web/src/ride/testing.ts <<'TS'
export function stubController(): void {}
TS
run_check
assert_green 'a testing.ts under a watched directory is not product code'

# --- A test double does not wire anything, even when production imports one ---
# The guard is in `productionModules` as well as in the watched set: a double is
# not product code, so walking into one must not mark what it names as shipped.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { stubController } from './ride/testing';
stubController();
TS
write apps/web/src/ride/controller.ts <<'TS'
export function startRide(): void {}
TS
write apps/web/src/ride/testing.ts <<'TS'
import { startRide } from './controller';

export function stubController(): void {
  startRide();
}
TS
run_check
assert_red 'an import of a test double does not make what it names production'
assert_says 'and reports the module the double alone reaches' 'WIRE001 apps/web/src/ride/controller.ts'

# --- Nothing outside the watched set is reported -----------------------------
# The noise rule: `knip` would report both of these and #278 says not to.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { startRide } from './ride/controller';
startRide();
TS
write apps/web/src/ride/controller.ts <<'TS'
export function startRide(): void {}
TS
write apps/web/src/transfer/export-activity.ts <<'TS'
export function exportActivity(): void {}
TS
write apps/web/src/detail/series.ts <<'TS'
export function chartPoints(): void {}
TS
run_check
assert_green 'an unreached export outside the watched set is not this gate&apos;s business'
assert_silent_about 'and is not named' 'exportActivity'

# --- It fails closed when there is no entry point ----------------------------
# A reachability check with no root would report everything as unreached, or —
# worse, and this is the shape this repository keeps shipping — pass vacuously.
new_fixture
rm "${tmp}/apps/web/index.html"
write apps/web/src/game/scene.ts <<'TS'
export function buildScene(): void {}
TS
run_check
assert_red 'no entry point is a failure rather than a clean run'
assert_says 'and says why' 'would pass vacuously'

# --- The watched set itself fails closed ------------------------------------
# #142's shape, one gate later: WATCHED_PREFIXES is written down rather than
# discovered, so a renamed watched directory would leave every rule passing over
# an empty population while the success line claimed every seam was reachable.
new_fixture
rmdir "${tmp}/apps/web/src/ride"
mkdir -p "${tmp}/apps/web/src/riding"
write apps/web/src/main.tsx <<'TS'
import { buildScene } from './game/scene';
buildScene();
TS
write apps/web/src/game/scene.ts <<'TS'
export function buildScene(): void {}
TS
write apps/web/src/riding/controller.ts <<'TS'
export function startRide(): void {}
export function stopRide(): void {}
TS
run_check
assert_red 'a watched directory that has been renamed away is a failure, not a quiet skip'
assert_says 'and names the prefix that is missing' 'apps/web/src/ride/'

# --- ...and so does a watched set that is present but empty ------------------
new_fixture
write apps/web/src/main.tsx <<'TS'
console.log('nothing to see');
TS
run_check
assert_red 'watched directories holding no source file is a failure rather than a clean run'
assert_says 'and says the run would have asserted nothing' 'assert nothing at all'

# --- The success line counts the population it CHECKED, not only the walk ----
new_fixture
write apps/web/src/main.tsx <<'TS'
import { startRide } from './ride/controller';
startRide();
TS
write apps/web/src/ride/controller.ts <<'TS'
import { buildScene } from '../game/scene';

export function startRide(): void {
  buildScene();
}
TS
write apps/web/src/game/scene.ts <<'TS'
export function buildScene(): void {}
TS
run_check
assert_green 'a wired tree passes'
assert_says 'and says how many watched files it read, not only how far it walked' '2 watched files'

# --- A workspace specifier resolves through the exports map ------------------
new_fixture
write apps/web/package.json <<'JSON'
{ "name": "@onyourleft/web", "private": true }
JSON
write packages/domain/package.json <<'JSON'
{ "name": "@onyourleft/domain", "private": true, "exports": { ".": "./src/index.ts" } }
JSON
write packages/domain/src/index.ts <<'TS'
export { metres } from './units';
TS
write packages/domain/src/units.ts <<'TS'
export function metres(value: number): number {
  return value;
}
TS
write apps/web/src/main.tsx <<'TS'
import { metres } from '@onyourleft/domain';
import { rideLength } from './ride/controller';
rideLength(metres(1));
TS
write apps/web/src/ride/controller.ts <<'TS'
export function rideLength(value: number): number {
  return value;
}
TS
run_check
assert_green 'a workspace specifier is followed through the package exports map'

printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
[ "${fail}" -eq 0 ]
