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

# Every path WATCHED_PREFIXES names, read from the checker rather than copied.
#
# ⚠️ **Read rather than written down**, which is `check-a11y-suite.mjs`'s rule
# about `test:a11y`'s selector applied to this one. A copy here drifts from the
# real list, and #406 is what that costs: it added `apps/web/src/offline/` and
# every one of these fixtures went red at once, because a prefix naming no
# directory is a hard failure and `new_fixture` created two directories BY NAME.
# Deriving them makes adding a prefix a one-line change in one file, which is
# what it should always have been.
#
# ⚠️ Resolved **here**, at the top, and not inside `new_fixture`: a derivation
# that returned nothing would otherwise leave every case below exercising the
# missing-directory rule instead of the one it is about — 86 confusing failures
# instead of one clear one — and an `exit` inside a process substitution exits
# the subshell rather than this script.
WATCHED_DIRECTORIES="$(
  sed -n 's/^const WATCHED_PREFIXES = \[\(.*\)\];$/\1/p' "${CHECK}" |
    tr ',' '\n' |
    sed -e "s/[[:space:]]//g" -e "s/'//g" |
    grep .
)"
if [ -z "${WATCHED_DIRECTORIES}" ]; then
  printf 'check-wiring.test: could not read WATCHED_PREFIXES out of %s\n' "${CHECK}" >&2
  exit 1
fi

# new_fixture -- a repository with one app, its page, and an empty entry module.
#
# ⚠️ Every watched directory is created even when a case writes into none of
# them: since #283 a WATCHED_PREFIXES entry naming a directory that is not there
# is a hard failure, so a fixture without them would exercise that rule instead
# of the one it is about. The case that DOES exercise it removes one
# deliberately.
new_fixture() {
  tmp="$(mktemp -d)"
  while IFS= read -r watched; do
    mkdir -p "${tmp}/${watched}"
  done <<< "${WATCHED_DIRECTORIES}"
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

# seam_stubs -- every module of TRAINER_COMMAND_SEAM, as an inert stub.
#
# ⚠️ The seam is checked ALL-OR-NOTHING: a tree with none of the five is a tree
# that has no trainer in it, which is what almost every fixture here is, and a
# tree with *some* of them is one where a path has moved and is a hard failure.
# So a case that wants one seam file has to lay down the other four, and each
# carries a file-level `@unwired` because nothing imports it -- which is the
# WIRE001 path rather than the rule under test.
seam_stubs() {
  for path in \
    packages/domain/src/trainer/simulation.ts \
    packages/sensors/protocol/src/fitness-machine-control.ts \
    packages/sensors/protocol/src/simulation-writer.ts \
    packages/sensors/protocol/src/erg-writer.ts \
    packages/sensors/protocol/src/trainer-control-choice.ts; do
    write "${path}" <<'TS'
/** @unwired a fixture stub; the case under test overrides whichever it needs. */
export {};
TS
  done
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

# --- The tag has to BE a tag, not a word in a sentence (#292) ----------------
# `unwiredReason` matched the tag anywhere in the stripped comment, so any prose
# mention of it inside a watched file's own doc comment silenced `WIRE001` for
# the whole module — including a paragraph written to say the exemption had been
# REMOVED, which is the most natural place to name it. Measured on #290's
# branch: the gate whose first finding was `segments/match-port.ts` could no
# longer report that finding on that file.
#
# ⚠️ These two cases are a pair and only mean something together. The red one
# alone would pass against a regex that had stopped recognising the tag at all.
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
 * This file carried an `@unwired` note until #282 wired it, and the note is
 * gone because the defect it named is fixed.
 */

export interface MatchStore {
  listActivities(): Promise<void>;
}
TS
run_check
assert_red 'a prose mention of the tag in a file comment exempts nothing'
assert_says 'and still reports the module as unreached' 'WIRE001 apps/web/src/segments/match-port.ts'
assert_silent_about 'and does not read the sentence as a reason' 'WIRE000'

# The other half: a real tag opens its own stripped line and is still honoured,
# in the same comment as a sentence that merely names it.
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
 * An `@unwired` tag named mid-sentence is prose and exempts nothing.
 *
 * @unwired #282 — nothing runs the matcher yet, and that is a defect with an
 * issue rather than a decision.
 */

export interface MatchStore {
  listActivities(): Promise<void>;
}
TS
run_check
assert_green 'a tag opening a line is honoured beside a sentence that names it'

# And on the declaration path, which strips a `//` margin rather than a `*` one.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { startRide } from './ride/controller';
startRide();
TS
write apps/web/src/ride/controller.ts <<'TS'
export function startRide(): void {}

// This bound used to carry an `@unwired` note and no longer needs one.
export const PROCEDURE_TIMEOUT = 5;
TS
run_check
assert_red 'a prose mention above a declaration exempts nothing either'
assert_says 'and names the export it cannot reach' '`PROCEDURE_TIMEOUT` is'

new_fixture
write apps/web/src/main.tsx <<'TS'
import { startRide } from './ride/controller';
startRide();
TS
write apps/web/src/ride/controller.ts <<'TS'
export function startRide(): void {}

// @unwired a bound `controller.test.ts` asserts against; nothing reads it.
export const PROCEDURE_TIMEOUT = 5;
TS
run_check
assert_green 'a tag opening a line comment is still honoured'

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

# --- #406: the offline seam is watched, and its directory is derived ---------
#
# The third watched prefix, and the first added for a seam that did not exist
# yet rather than after a defect. A registration module nothing calls is a
# client that silently has no service worker -- correct, unit-tested,
# typechecked and wired to nothing, which is this gate's population exactly.
#
# ⚠️ It is also what caught the drift this suite had: `new_fixture` created the
# two watched directories BY NAME, so adding a third turned all 83 cases red at
# once. `watched_directories` reads them out of the checker now.
new_fixture
write apps/web/src/main.tsx <<'TS'
export {};
TS
write apps/web/src/offline/register.ts <<'TS'
export function registerServiceWorker(): void {}
TS
run_check
assert_red 'an offline module the entry point cannot reach is reported'
assert_says 'and names it' 'WIRE001 apps/web/src/offline/register.ts'

new_fixture
write apps/web/src/main.tsx <<'TS'
import { registerServiceWorker } from './offline/register';
registerServiceWorker();
TS
write apps/web/src/offline/register.ts <<'TS'
export function registerServiceWorker(): void {}
TS
run_check
assert_green 'and is green once main.tsx calls it'

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
# ⚠️ The seam count is REPORTED rather than asserted by the gate -- see
# `missingSeamFiles`, which cannot make an all-absent seam a hard failure
# without failing every fixture here that legitimately has no trainer in it. A
# tree with none of the five must therefore SAY so, because that is the whole
# of the protection: in the real repository, where all five exist, `0 of 5` in
# the log is the only thing that distinguishes a seam deleted wholesale from a
# healthy run.
assert_says 'and says how much of the trainer-command seam it found' '0 of 5 trainer-command seam'

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

# --- #362: the gradient the game never wrote, as the tree actually was --------
#
# ⚠️ **The case #363 exists for**, and the one that could not have been written
# before it: every rule here used to stop at `apps/`, and both halves of #90
# live in `packages/`. The shape is read out of the tree at 4bfee83:
#
#   git show 4bfee83:packages/sensors/protocol/src/fitness-machine-control.ts
#
# `TrainerControl` is declared in a module production code imports -- through
# the protocol barrel -- so WIRE001 is silent and WIRE002 is silent, and the
# only rule that can see it is the one that asks whether each declared METHOD
# has a caller. The client calls `setTargetPower` from the workout session and
# nothing calls `setSimulationParameters`, which is exactly what `adb logcat`
# showed: 252 inbound notifications, zero writes.
new_fixture
seam_stubs
write packages/sensors/protocol/src/fitness-machine-control.ts <<'TS'
export interface TrainerControl {
  requestControl(): Promise<void>;
  setTargetPower(target: number): Promise<number>;
  setSimulationParameters(parameters: { grade: number }): Promise<void>;
  stop(): Promise<void>;
}
TS
write apps/web/src/main.tsx <<'TS'
import { startRide } from './ride/controller';
startRide();
TS
write apps/web/src/ride/controller.ts <<'TS'
import type { TrainerControl } from '../../../../packages/sensors/protocol/src/fitness-machine-control';

let held: TrainerControl | undefined;

export function startRide(): void {
  void held?.requestControl();
  void held?.setTargetPower(200);
  void held?.stop();
}
TS
run_check
assert_red '#362: a trainer command with no caller is reported'
assert_says '#362: and it names the method' 'TrainerControl.setSimulationParameters'
assert_says '#362: and the file it is declared in' 'fitness-machine-control.ts'
assert_silent_about '#362: the commands that ARE wired are not reported' 'setTargetPower'

# --- ...and green once the game actually writes one ---------------------------
#
# The same tree with #362's fix in it. Both halves matter: a rule that could not
# go green on the fixed tree would be one nobody could satisfy.
write apps/web/src/game/gradient.ts <<'TS'
import type { TrainerControl } from '../../../../packages/sensors/protocol/src/fitness-machine-control';

export function writeGradient(control: TrainerControl, grade: number): void {
  void control.setSimulationParameters({ grade });
}
TS
write apps/web/src/ride/controller.ts <<'TS'
import type { TrainerControl } from '../../../../packages/sensors/protocol/src/fitness-machine-control';
import { writeGradient } from '../game/gradient';

let held: TrainerControl | undefined;

export function startRide(): void {
  void held?.requestControl();
  void held?.setTargetPower(200);
  void held?.stop();
  if (held !== undefined) {
    writeGradient(held, 6);
  }
}
TS
run_check
assert_green '#362: wiring the gradient up turns it green'

# --- #230's shape, one package along: a call from a method nobody calls -------
#
# The seam inherits WIRE003's whole rule and not only its population. A gradient
# written inside a function the client never calls is #362 with an extra step,
# and it is the failure mode a `grep` for `setSimulationParameters` would miss.
new_fixture
seam_stubs
write packages/sensors/protocol/src/fitness-machine-control.ts <<'TS'
export interface TrainerControl {
  setSimulationParameters(parameters: { grade: number }): Promise<void>;
}
TS
write apps/web/src/main.tsx <<'TS'
import { startRide } from './ride/controller';
startRide();
TS
write apps/web/src/ride/controller.ts <<'TS'
import type { TrainerControl } from '../../../../packages/sensors/protocol/src/fitness-machine-control';

let held: TrainerControl | undefined;

// Nothing calls this, so the call inside it reaches no wire.
function driveTheHill(): void {
  void held?.setSimulationParameters({ grade: 6 });
}

export function startRide(): void {}
TS
run_check
assert_red '#362: a gradient written from a function nobody calls is still unwired'
assert_says '#362: and it is reported as WIRE003' 'WIRE003'

# --- A seam exemption needs a reason, exactly as an apps/ one does ------------
new_fixture
seam_stubs
write packages/sensors/protocol/src/fitness-machine-control.ts <<'TS'
export interface TrainerControl {
  /** @unwired */
  setSimulationParameters(parameters: { grade: number }): Promise<void>;
}
TS
write apps/web/src/main.tsx <<'TS'
import { startRide } from './ride/controller';
startRide();
TS
write apps/web/src/ride/controller.ts <<'TS'
import type { TrainerControl } from '../../../../packages/sensors/protocol/src/fitness-machine-control';
export function startRide(): void {
  const held: TrainerControl | undefined = undefined;
  void held;
}
TS
run_check
assert_red 'a reasonless exemption on the trainer seam is refused'
assert_says 'and it is reported as WIRE000' 'WIRE000'

write packages/sensors/protocol/src/fitness-machine-control.ts <<'TS'
export interface TrainerControl {
  /** @unwired no screen offers a gradient yet; #362 is the issue that wires it. */
  setSimulationParameters(parameters: { grade: number }): Promise<void>;
}
TS
run_check
assert_green 'a reasoned exemption on the trainer seam is honoured'
assert_says 'and a tree holding the whole seam says so' '5 of 5 trainer-command seam'

# --- The seam fails closed when one of its paths has moved -------------------
#
# ⚠️ A path list fails closed against DELETING what it names and open against
# RENAMING it, which is #142's shape and the reason `missingPrefixes` exists one
# rule up. All five absent is an ordinary tree with no trainer in it; four of
# five is a module that has moved, and the gate must not pass over it quietly.
new_fixture
seam_stubs
rm "${tmp}/packages/sensors/protocol/src/simulation-writer.ts"
write apps/web/src/main.tsx <<'TS'
import { startRide } from './ride/controller';
startRide();
TS
write apps/web/src/ride/controller.ts <<'TS'
export function startRide(): void {}
TS
run_check
assert_red 'a moved trainer-seam module is a hard failure'
assert_says 'and it names the path that moved' 'simulation-writer.ts'
assert_says 'and says what the list is' 'TRAINER_COMMAND_SEAM'

# --- A tree with no trainer at all is not a half-missing seam ----------------
#
# Every other fixture in this file is one of these. If the seam were required
# rather than all-or-nothing, none of them would exercise the rule it is about.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { startRide } from './ride/controller';
startRide();
TS
write apps/web/src/ride/controller.ts <<'TS'
export function startRide(): void {}
TS
run_check
assert_green 'a tree with none of the seam present is not a failure'
assert_silent_about 'and it says nothing about the seam' 'TRAINER_COMMAND_SEAM'

# --- Nothing else under packages/ is watched ---------------------------------
#
# ⚠️ The measurement that keeps #363 honest. Watching `packages/` wholesale
# reports 171 findings on the real tree -- CLAUDE.md §4b records most of them as
# deliberate -- so the seam has to be the five paths and not the directory they
# are in. A sibling of a watched file, unimported and unexported-from, must be
# invisible here.
new_fixture
seam_stubs
write packages/sensors/protocol/src/heart-rate.ts <<'TS'
export const BODY_SENSOR_LOCATION = 0x2a38;
export function decodeHeartRate(): number {
  return 0;
}
TS
write packages/domain/src/analysis/critical-power.ts <<'TS'
export function fitCriticalPower(): number {
  return 0;
}
TS
write apps/web/src/main.tsx <<'TS'
import { startRide } from './ride/controller';
startRide();
TS
write apps/web/src/ride/controller.ts <<'TS'
export function startRide(): void {}
TS
run_check
assert_green 'an unconsumed packages/ module outside the seam is not reported'
assert_silent_about 'and neither is its export' 'decodeHeartRate'
assert_silent_about 'nor one in another package' 'fitCriticalPower'

# --- Every entry of the seam is load-bearing ---------------------------------
#
# ⚠️ **The case that stops the watchlist shrinking.** A path list can be made
# weaker by deleting a line, and nothing above would have noticed: removing
# `packages/domain/src/trainer/simulation.ts` from TRAINER_COMMAND_SEAM left the
# whole suite green, because every case up to here happens to use the protocol
# module. So this one puts an unwired declaration in **all five** at once and
# requires each of them to be named. Deleting any entry turns it red.
new_fixture
write packages/domain/src/trainer/simulation.ts <<'TS'
export interface SimulationDriver {
  sample(distance: number): number | undefined;
}
export function createSimulationDriver(): SimulationDriver {
  return { sample: () => undefined };
}
TS
write packages/sensors/protocol/src/fitness-machine-control.ts <<'TS'
export interface TrainerControl {
  setSimulationParameters(parameters: { grade: number }): Promise<void>;
}
TS
write packages/sensors/protocol/src/simulation-writer.ts <<'TS'
export interface SimulationWriter {
  offerGradient(grade: number): void;
}
TS
write packages/sensors/protocol/src/erg-writer.ts <<'TS'
export interface ErgWriter {
  offerTarget(watts: number): Promise<void>;
}
TS
write packages/sensors/protocol/src/trainer-control-choice.ts <<'TS'
export function chooseTrainerControl(): string {
  return 'none';
}
TS
write apps/web/src/main.tsx <<'TS'
import { startRide } from './ride/controller';
import type { TrainerControl } from '../../../packages/sensors/protocol/src/fitness-machine-control';
import type { SimulationWriter } from '../../../packages/sensors/protocol/src/simulation-writer';
import type { ErgWriter } from '../../../packages/sensors/protocol/src/erg-writer';
import type { SimulationDriver } from '../../../packages/domain/src/trainer/simulation';
// A side-effect import, so the module is in the production graph and its
// export is still named by nobody -- WIRE002 rather than WIRE001.
import '../../../packages/sensors/protocol/src/trainer-control-choice';

// Every seam module is IMPORTED -- which is the point: WIRE001 is silent, and
// only the method-level and export-level rules can see what is unreached.
export type Held = TrainerControl | SimulationWriter | ErgWriter | SimulationDriver;
startRide();
TS
write apps/web/src/ride/controller.ts <<'TS'
export function startRide(): void {}
TS
run_check
assert_red 'an unwired declaration in any seam module is reported'
assert_says 'the gradient driver is watched' 'SimulationDriver.sample'
assert_says 'the control point is watched' 'TrainerControl.setSimulationParameters'
assert_says 'the gradient writer is watched' 'SimulationWriter.offerGradient'
assert_says 'the ERG writer is watched' 'ErgWriter.offerTarget'
assert_says 'the gradient driver factory is watched' 'createSimulationDriver'
assert_says 'the control-point choice is watched' 'chooseTrainerControl'

# --- #438: `@test-facing`, the verified exemption ------------------------------
#
# Arithmetic stated so that a test can hold the product to it — `camera.ts`'s
# composition, a contrast floor — has no production caller BY DESIGN. Until
# #438 each such export spent an `@unwired` whose reason was free text nobody
# could check. `@test-facing` exempts it from WIRE002 only while a test, a spec
# or a browser harness actually READS it, and the success line counts the two
# populations apart. Every case below has a red twin.

# The green case: a bound only a test reads.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { buildScene } from './game/scene';
buildScene();
TS
write apps/web/src/game/scene.ts <<'TS'
export function buildScene(): void {}
/**
 * The most a rider may fill of the frame.
 *
 * @test-facing a bound scene.test.ts holds the composition to.
 */
export const MAXIMUM_SHARE = 0.5;
TS
write apps/web/src/game/scene.test.ts <<'TS'
import { MAXIMUM_SHARE } from './scene';
void MAXIMUM_SHARE;
TS
run_check
assert_green '#438: a @test-facing export a test reads passes'
assert_says '#438: and the success line counts it apart from @unwired' '1 @test-facing exports read by a gate'
assert_says '#438: and counts the @unwired population beside it' '0 @unwired exemptions'

# Red: the same tag with no test reading it. This is the dead export a module
# outside the watched set would have hidden (#438's option 2, rejected).
new_fixture
write apps/web/src/main.tsx <<'TS'
import { buildScene } from './game/scene';
buildScene();
TS
write apps/web/src/game/scene.ts <<'TS'
export function buildScene(): void {}
/**
 * @test-facing a bound scene.test.ts holds the composition to.
 */
export const MAXIMUM_SHARE = 0.5;
TS
run_check
assert_red '#438: a @test-facing export nothing reads fails'
assert_says '#438: as WIRE004, naming it' 'WIRE004 apps/web/src/game/scene.ts:5 — `MAXIMUM_SHARE` is marked `@test-facing`'

# Green: a browser harness is a gate too — and still not an entry point.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { buildScene } from './game/scene';
buildScene();
TS
write apps/web/src/game/scene.ts <<'TS'
export function buildScene(): void {}
/** @test-facing the browser gate measures the rider against it. */
export function riderBox(): number {
  return 1;
}
TS
write apps/web/browser/harness.ts <<'TS'
import { riderBox } from '../src/game/scene';
riderBox();
TS
run_check
assert_green '#438: a browser harness reading it holds it'

# Green: held through another held @test-facing export (the composition is
# built from the model's dimensions, and only the composition is asserted).
new_fixture
write apps/web/src/main.tsx <<'TS'
import { buildScene } from './game/scene';
buildScene();
TS
write apps/web/src/game/scene.ts <<'TS'
export function buildScene(): void {}
/** @test-facing the composition's input. */
export const RIDER_HEIGHT = 1.8;
/** @test-facing asserted in scene.test.ts. */
export function riderShare(): number {
  return RIDER_HEIGHT / 4;
}
TS
write apps/web/src/game/scene.test.ts <<'TS'
import { riderShare } from './scene';
riderShare();
TS
run_check
assert_green '#438: held through a held @test-facing export'
assert_says '#438: and both are counted' '2 @test-facing exports read by a gate'

# Red: two tagged exports naming only EACH OTHER hold nothing up. Held is a
# closure from the tests outward, not a mutual alibi.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { buildScene } from './game/scene';
buildScene();
TS
write apps/web/src/game/scene.ts <<'TS'
export function buildScene(): void {}
/** @test-facing names the other. */
export function first(): number {
  return second();
}
/** @test-facing names the first. */
export function second(): number {
  return first();
}
TS
run_check
assert_red '#438: two tagged exports that only name each other are dead together'
assert_says '#438: the first is reported' '`first` is marked `@test-facing`'
assert_says '#438: and so is the second' '`second` is marked `@test-facing`'

# Red: a reasonless tag, on the WIRE000 precedent.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { buildScene } from './game/scene';
buildScene();
TS
write apps/web/src/game/scene.ts <<'TS'
export function buildScene(): void {}
/** @test-facing */
export const MAXIMUM_SHARE = 0.5;
TS
write apps/web/src/game/scene.test.ts <<'TS'
import { MAXIMUM_SHARE } from './scene';
void MAXIMUM_SHARE;
TS
run_check
assert_red '#438: a @test-facing tag with no reason fails'
assert_says '#438: as WIRE000' 'WIRE000 apps/web/src/game/scene.ts:3 — `MAXIMUM_SHARE` carries `@test-facing` with no reason'

# Red: the tag does NOT reach a whole file. A module only tests import is a
# module that ships nothing, and that is WIRE001 however it is labelled.
new_fixture
write apps/web/src/main.tsx <<'TS'
export {};
TS
write apps/web/src/game/bounds.ts <<'TS'
/**
 * @test-facing every bound in this file is read by a test.
 */
export const MAXIMUM_SHARE = 0.5;
TS
write apps/web/src/game/bounds.test.ts <<'TS'
import { MAXIMUM_SHARE } from './bounds';
void MAXIMUM_SHARE;
TS
run_check
assert_red '#438: @test-facing on a file nothing imports is still WIRE001'
assert_says '#438: named as such' 'WIRE001 apps/web/src/game/bounds.ts'

# Red: nor a port method — a method only a test calls is #230 exactly.
new_fixture
write apps/web/src/main.tsx <<'TS'
import type { AudioPort } from './game/audio-port';
export function play(port: AudioPort): void {
  port.start();
}
TS
write apps/web/src/game/audio-port.ts <<'TS'
export interface AudioPort {
  start(): void;
  /** @test-facing only the double calls it. */
  stop(): void;
}
TS
write apps/web/src/game/audio.test.ts <<'TS'
import type { AudioPort } from './audio-port';
export const stopped = (port: AudioPort): void => port.stop();
TS
run_check
assert_red '#438: @test-facing does not exempt a port method'
assert_says '#438: it is WIRE003' 'WIRE003 apps/web/src/game/audio-port.ts:4 — `AudioPort.stop`'

# Red: WIRE004's stale half. An exemption on something production DOES name —
# `@test-facing` or `@unwired` — is a false statement at the declaration. On the
# tree #438 was measured on it found three: `PEAK_IRRADIANCE`, which #366 had
# wired, and two more.
for tag in test-facing unwired; do
  new_fixture
  write apps/web/src/main.tsx <<'TS'
import { buildScene, MAXIMUM_SHARE } from './game/scene';
buildScene(MAXIMUM_SHARE);
TS
  write apps/web/src/game/scene.ts <<TS
export function buildScene(share: number): number {
  return share;
}
/** @${tag} a bound nothing in the client reads. */
export const MAXIMUM_SHARE = 0.5;
TS
  write apps/web/src/game/scene.test.ts <<'TS'
import { MAXIMUM_SHARE } from './scene';
void MAXIMUM_SHARE;
TS
  run_check
  assert_red "#438: a stale @${tag} on a wired export fails"
  assert_says "#438: as WIRE004, stale @${tag}" "\`MAXIMUM_SHARE\` carries \`@${tag}\` and production names it"
done

# Green, and the pair to the stale case: an ordinary @unwired is still counted.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { buildScene } from './game/scene';
buildScene();
TS
write apps/web/src/game/scene.ts <<'TS'
export function buildScene(): void {}
/** @unwired a decision: nothing may call this until #999 lands. */
export function later(): void {}
TS
run_check
assert_green '#438: an ordinary @unwired still exempts'
assert_says '#438: and is counted as one' '1 @unwired exemptions, 0 @test-facing exports read by a gate'

# --- #447: "read by a gate" means READ, not mentioned ----------------------
#
# Until #447 WIRE004 matched the export's name anywhere in a gate's TEXT, so a
# test that only said "see scene.ts MAXIMUM_SHARE" in a comment held the export
# alive. Each red case below is green on the textual matcher, measured by
# reverting `identifiersIn` to a regex over the file.

# Red: named only in a comment of a test.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { buildScene } from './game/scene';
buildScene();
TS
write apps/web/src/game/scene.ts <<'TS'
export function buildScene(): void {}
/** @test-facing a bound scene.test.ts holds the composition to. */
export const MAXIMUM_SHARE = 0.5;
TS
write apps/web/src/game/scene.test.ts <<'TS'
// The frame share is bounded by MAXIMUM_SHARE in scene.ts, which this file
// used to import and no longer does.
/** See {@link MAXIMUM_SHARE}. */
export const nothing = 0;
TS
run_check
assert_red '#447: a @test-facing export named only in a comment of a test is dead'
assert_says '#447: as WIRE004, naming it' '`MAXIMUM_SHARE` is marked `@test-facing`'

# Red: named only inside a string of a test.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { buildScene } from './game/scene';
buildScene();
TS
write apps/web/src/game/scene.ts <<'TS'
export function buildScene(): void {}
/** @test-facing a bound scene.test.ts holds the composition to. */
export const MAXIMUM_SHARE = 0.5;
TS
write apps/web/src/game/scene.test.ts <<'TS'
export const label = 'MAXIMUM_SHARE is asserted elsewhere';
export const template = `and MAXIMUM_SHARE here`;
TS
run_check
assert_red '#447: a @test-facing export named only inside a string of a test is dead'

# Green: the same export, actually used — a property access through a
# namespace import counts, because it is an identifier the code refers to.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { buildScene } from './game/scene';
buildScene();
TS
write apps/web/src/game/scene.ts <<'TS'
export function buildScene(): void {}
/** @test-facing a bound scene.test.ts holds the composition to. */
export const MAXIMUM_SHARE = 0.5;
TS
write apps/web/src/game/scene.test.ts <<'TS'
import * as scene from './scene';
void scene.MAXIMUM_SHARE;
TS
run_check
assert_green '#447: a @test-facing export read through a namespace import is held'

# Red: held through another tagged export ONLY by that export's doc comment.
new_fixture
write apps/web/src/main.tsx <<'TS'
import { buildScene } from './game/scene';
buildScene();
TS
write apps/web/src/game/scene.ts <<'TS'
export function buildScene(): void {}
/** @test-facing the composition's input. */
export const RIDER_HEIGHT = 1.8;
/**
 * Built from RIDER_HEIGHT once, and not any more.
 *
 * @test-facing asserted in scene.test.ts.
 */
export function riderShare(): number {
  return 0.45; // was RIDER_HEIGHT / 4
}
TS
write apps/web/src/game/scene.test.ts <<'TS'
import { riderShare } from './scene';
riderShare();
TS
run_check
assert_red '#447: a comment in a held export does not hold another up'
assert_says '#447: the input is reported' '`RIDER_HEIGHT` is marked `@test-facing`'

printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
[ "${fail}" -eq 0 ]
