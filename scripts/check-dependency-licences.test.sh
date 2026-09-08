#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for scripts/check-dependency-licences.mjs.
#
# Same shape as the other suites: each case builds a throwaway input, runs the
# checker against it, and asserts on the output and the exit code.
#
# The cases that carry the weight are the ones where the checker must go RED.
# A licence gate that always exits 0 is indistinguishable from a clean tree,
# and this repository has now shipped a rule that could not fire five separate
# times — in a lint rule (#133), an a11y audit rule (#141), a shell test helper
# (#150), a fuzz arm (#146) and an a11y suite rule (#155). So every branch of
# the policy has a case that fails, not only a case that passes.
#
# The closures are supplied with `--closures` rather than by running pnpm, so a
# case costs milliseconds and needs no install. That seam is not a gap: the CI
# step runs the checker for real, with no `--closures`, against the actual
# workspace immediately after this suite.
#
# Unlike the six bare-clone checkers, this one needs Node. It is therefore NOT
# part of `pnpm run check:repo`.
#
# Run: bash scripts/check-dependency-licences.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="${SCRIPT_DIR}/check-dependency-licences.mjs"

pass=0
fail=0
tmp=""

cleanup() { [ -n "${tmp}" ] && rm -rf "${tmp}"; }
trap cleanup EXIT

tmp="$(mktemp -d)"

# closures <json> -- write a closures document and echo its path.
closures() {
  local file
  file="${tmp}/closures.$$.${RANDOM}.json"
  printf '%s' "$1" > "${file}"
  printf '%s' "${file}"
}

# one_dep <directory> <closure> <licence> -- the single-dependency document
# every policy case is a variation of.
one_dep() {
  local directory="$1" closure="$2" licence="$3"
  local distributed='[]' build='[]'
  local entry
  entry="[{\"name\":\"probe\",\"license\":\"${licence}\"}]"
  if [ "${closure}" = "distributed" ]; then distributed="${entry}"; else build="${entry}"; fi
  printf '{"@onyourleft/probe":{"directory":"%s","distributed":%s,"build":%s}}' \
    "${directory}" "${distributed}" "${build}"
}

# assert_clean <name> <closures-file>
assert_clean() {
  local name="$1" file="$2" output status
  output="$(node "${CHECK}" --closures "${file}" 2>&1)"
  status=$?
  if [ "${status}" -eq 0 ]; then
    printf 'ok   %s\n' "${name}"
    pass=$((pass + 1))
  else
    printf 'FAIL %s -- expected exit 0, got %d\n%s\n' "${name}" "${status}" "${output}"
    fail=$((fail + 1))
  fi
}

# assert_violation <name> <closures-file> <needle> -- must exit 1 AND say why.
# Both halves matter: an exit code with the wrong reason is a test that would
# stay green through a rewrite that broke the message.
assert_violation() {
  local name="$1" file="$2" needle="$3" output status
  output="$(node "${CHECK}" --closures "${file}" 2>&1)"
  status=$?
  if [ "${status}" -ne 1 ]; then
    printf 'FAIL %s -- expected exit 1, got %d\n%s\n' "${name}" "${status}" "${output}"
    fail=$((fail + 1))
    return
  fi
  if printf '%s' "${output}" | grep -qF "${needle}"; then
    printf 'ok   %s\n' "${name}"
    pass=$((pass + 1))
  else
    printf 'FAIL %s -- exit 1 but output did not contain %s\n%s\n' "${name}" "${needle}" "${output}"
    fail=$((fail + 1))
  fi
}

# --- Permissive passes everywhere -------------------------------------------

for licence in MIT BSD-2-Clause BSD-3-Clause Apache-2.0 ISC; do
  assert_clean "permissive ${licence} ships in an Apache-2.0 package" \
    "$(closures "$(one_dep packages/domain distributed "${licence}")")"
done

assert_clean "permissive ships in the AGPL application" \
  "$(closures "$(one_dep apps/web distributed MIT)")"

# --- Strong copyleft: the path decides, in BOTH closures (ADR 0015 D-3) ------

assert_violation "GPL shipped in an Apache-2.0 package is a violation" \
  "$(closures "$(one_dep packages/domain distributed GPL-3.0-only)")" \
  'probe is GPL-3.0-only, which is not permitted in the distributed closure of an Apache-2.0 package'

assert_violation "GPL at BUILD TIME in an Apache-2.0 package is still a violation" \
  "$(closures "$(one_dep packages/domain build GPL-3.0-only)")" \
  'not permitted in the build-time closure of an Apache-2.0 package'

assert_violation "AGPL in an Apache-2.0 package is a violation" \
  "$(closures "$(one_dep packages/store distributed AGPL-3.0-or-later)")" \
  'probe is AGPL-3.0-or-later'

assert_violation "LGPL in an Apache-2.0 package is a violation" \
  "$(closures "$(one_dep packages/fit distributed LGPL-3.0-only)")" \
  'probe is LGPL-3.0-only'

assert_clean "GPL in the AGPL application is permitted" \
  "$(closures "$(one_dep apps/web distributed GPL-3.0-only)")"

assert_clean "AGPL in the AGPL application is permitted" \
  "$(closures "$(one_dep apps/web distributed AGPL-3.0-or-later)")"

# --- The set ADR 0015 D-2 rules on: build-time yes, shipped-from-a-leaf no ---
#
# `Unlicense` is in this loop rather than in the permissive one above because
# ADR 0016 D-1 put it in `POLICY.weak`, and it is judged by that table wherever
# it sits. Its red case is the one that matters: the licence arrived as a
# build-time dependency of `apps/mobile`, which is the position that PASSES, so
# without the shipped-from-a-leaf case the entry would have only ever been seen
# to go green.

for licence in MPL-2.0 BlueOak-1.0.0 CC0-1.0 MIT-0 0BSD Unlicense; do
  assert_clean "${licence} at build time in an Apache-2.0 package is permitted" \
    "$(closures "$(one_dep packages/domain build "${licence}")")"
  assert_violation "${licence} SHIPPED from an Apache-2.0 package is a violation" \
    "$(closures "$(one_dep packages/domain distributed "${licence}")")" \
    "probe is ${licence}, which is not permitted in the distributed closure"
done

assert_clean "MPL-2.0 shipped in the AGPL application is permitted" \
  "$(closures "$(one_dep apps/web distributed MPL-2.0)")"

assert_clean "Unlicense shipped in the AGPL application is permitted" \
  "$(closures "$(one_dep apps/web distributed Unlicense)")"

# The position `Unlicense` actually occupies in the tree today: `@capacitor/cli`
# reaches `bplist-parser` and `bplist-creator` through `xcode`, at build time,
# under `apps/mobile`. This is the case that has to pass for #87 to install at
# all, so it is asserted rather than inferred from the loop above.
assert_clean "Unlicense at build time in the AGPL application is permitted" \
  "$(closures "$(one_dep apps/mobile build Unlicense)")"

# --- Non-OSI fails in every closure and under every path ---------------------

for licence in BUSL-1.1 SSPL-1.0 CC-BY-NC-4.0; do
  assert_violation "${licence} is a violation in the application" \
    "$(closures "$(one_dep apps/web distributed "${licence}")")" \
    "probe is ${licence}"
  assert_violation "${licence} is a violation at build time in a package" \
    "$(closures "$(one_dep packages/domain build "${licence}")")" \
    "probe is ${licence}"
done

# --- SPDX expressions -------------------------------------------------------
#
# OR passes if ANY operand is admitted (the recipient chooses); AND passes only
# if EVERY operand is (a combined work imposes all of them at once). Getting
# these the wrong way round is the failure that would admit `MIT AND BUSL-1.1`.

assert_clean "an OR expression passes on either admitted operand" \
  "$(closures "$(one_dep apps/web distributed '(MIT OR Apache-2.0)')")"

assert_clean "an OR expression passes when only ONE operand is admitted" \
  "$(closures "$(one_dep apps/web distributed '(MIT OR BUSL-1.1)')")"

assert_violation "an OR expression fails when NO operand is admitted" \
  "$(closures "$(one_dep apps/web distributed '(BUSL-1.1 OR SSPL-1.0)')")" \
  'probe is (BUSL-1.1 OR SSPL-1.0)'

assert_clean "an AND expression passes when every operand is admitted" \
  "$(closures "$(one_dep apps/web distributed 'MIT AND ISC')")"

assert_violation "an AND expression fails when ANY operand is not admitted" \
  "$(closures "$(one_dep apps/web distributed 'MIT AND BUSL-1.1')")" \
  'probe is MIT AND BUSL-1.1'

assert_clean "OR binds looser than AND, so one admitted branch carries it" \
  "$(closures "$(one_dep apps/web distributed 'MIT AND BUSL-1.1 OR ISC')")"

assert_clean "a nested expression is evaluated, not pattern-matched" \
  "$(closures "$(one_dep apps/web distributed '(MIT OR (ISC AND Apache-2.0))')")"

# --- Fails closed -----------------------------------------------------------
#
# The gate exists for the licence nobody has considered, so anything it cannot
# place has to be the failing branch.

assert_violation "an unknown licence fails closed" \
  "$(closures "$(one_dep apps/web distributed Frobnicate-1.0)")" \
  'probe is Frobnicate-1.0'

assert_violation "a package declaring no licence at all fails closed" \
  "$(closures "$(one_dep apps/web distributed '')")" \
  '<no licence declared>'

assert_violation "a WITH exception is not silently accepted" \
  "$(closures "$(one_dep apps/web distributed 'MIT WITH Classpath-exception-2.0')")" \
  'probe is MIT WITH Classpath-exception-2.0'

assert_violation "an unbalanced expression fails rather than being approved" \
  "$(closures "$(one_dep apps/web distributed '(MIT OR ISC')")" \
  'probe is (MIT OR ISC'

assert_violation "a dangling operator fails rather than being approved" \
  "$(closures "$(one_dep apps/web distributed 'MIT OR')")" \
  'probe is MIT OR'

# --- Checking nothing is not a pass -----------------------------------------
#
# The union over every workspace package is what makes this check complete
# (see the header note on `--filter` not following workspace links), so an
# empty input must be a failure. Otherwise a discovery that silently returned
# nothing would report success over a tree it never looked at.

assert_violation "an empty closures document is a failure, not a clean run" \
  "$(closures '{}')" \
  'verified nothing'

# --- The path is the boundary, and it is read from the directory ------------

assert_violation "a nested package under packages/ is still governed by packages/" \
  "$(closures '{"@onyourleft/probe":{"directory":"packages/sensors/web-bluetooth","distributed":[{"name":"probe","license":"GPL-3.0-only"}],"build":[]}}')" \
  'not permitted in the distributed closure of an Apache-2.0 package'

# --- Reporting --------------------------------------------------------------

assert_violation "every violation is reported, not just the first" \
  "$(closures '{"@onyourleft/a":{"directory":"packages/domain","distributed":[{"name":"one","license":"GPL-3.0-only"},{"name":"two","license":"BUSL-1.1"}],"build":[]}}')" \
  '2 violation(s)'

assert_violation "a violation names the ADR that classifies licences" \
  "$(closures "$(one_dep packages/domain distributed GPL-3.0-only)")" \
  'docs/adr/0015-dependency-licences.md'

printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
[ "${fail}" -eq 0 ]
