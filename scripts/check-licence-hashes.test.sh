#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for scripts/check-licence-hashes.sh.
#
# Same shape as check-repo-rules.test.sh: each case builds a throwaway fixture
# tree, runs the checker against it, and asserts on the exit code and on the
# text of the finding. Asserting the text matters here for a specific reason --
# the interesting failure mode of a digest checker is not "reports the wrong
# file", it is "reports nothing at all". A checker that finds no digests to
# verify and exits 0 is indistinguishable from a clean run, and the cases below
# exist mostly to pin that difference down.
#
# Run: bash scripts/check-licence-hashes.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKER="${SCRIPT_DIR}/check-licence-hashes.sh"

pass=0
fail=0

digest_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    sha256sum "$1" | cut -d' ' -f1
  fi
}

fixture_root=""

# A fixture standing in for the real repository: two licence texts, and an
# ADR 0001 whose integrity block records the digest of each.
new_fixture() {
  fixture_root="$(mktemp -d)"
  mkdir -p "${fixture_root}/docs/adr" "${fixture_root}/LICENSES"
  printf 'GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007\n' \
    > "${fixture_root}/LICENSE"
  printf 'Apache License\nVersion 2.0, January 2004\n' \
    > "${fixture_root}/LICENSES/Apache-2.0.txt"
  write_adr "$(digest_of "${fixture_root}/LICENSE")  LICENSE
$(digest_of "${fixture_root}/LICENSES/Apache-2.0.txt")  LICENSES/Apache-2.0.txt"
}

# The integrity block sits inside prose in the real ADR, so the fixture wraps it
# in prose too -- a checker that only works on a bare file would pass its tests
# and fail on the document it exists to read.
write_adr() {
  # A markdown code fence, built from printf's octal escape for the backtick.
  # Writing three backticks literally is awkward in either quoting style: single
  # quotes trip shellcheck SC2016, double quotes open a command substitution.
  local fence
  fence="$(printf '\140\140\140')"
  {
    printf '# 1. Licensing\n\n## Decision\n\nAGPL-3.0 app, Apache-2.0 leaf packages.\n\n'
    printf 'Integrity of the committed texts, verifiable with shasum -a 256:\n\n'
    printf '%s\n%s\n%s\n\n' "${fence}" "$1" "${fence}"
    printf '### Data\n\nDeferred to ADR 0007.\n'
  } > "${fixture_root}/docs/adr/0001-licence.md"
}

cleanup_fixture() {
  [ -n "${fixture_root}" ] && rm -rf "${fixture_root}"
  fixture_root=""
}

# assert_clean <name>
assert_clean() {
  local name="$1" out status
  out="$(bash "${CHECKER}" "${fixture_root}" 2>&1)"
  status=$?
  if [ "${status}" -eq 0 ]; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "${name}"
  else
    fail=$((fail + 1))
    printf 'FAIL %s\n     expected exit 0, got %s\n%s\n' "${name}" "${status}" "${out}"
  fi
  cleanup_fixture
}

# assert_violation <name> <expected-substring>
assert_violation() {
  local name="$1" needle="$2" out status
  out="$(bash "${CHECKER}" "${fixture_root}" 2>&1)"
  status=$?
  if [ "${status}" -ne 0 ] \
     && printf '%s' "${out}" | grep "^LIC005: " | grep -qF "${needle}"; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "${name}"
  else
    fail=$((fail + 1))
    printf 'FAIL %s\n     expected exit != 0 and a "LIC005: " line containing "%s"; got exit %s\n%s\n' \
      "${name}" "${needle}" "${status}" "${out}"
  fi
  cleanup_fixture
}

# --- The digests reproduce ----------------------------------------------------

new_fixture
assert_clean "recorded digests that reproduce pass"

# --- An edited licence text is caught -----------------------------------------
#
# This is the whole point of the check. A one-line edit to a licence file is a
# licensing incident rather than a typo, and it is exactly the shape of change a
# human diff reviewer scrolls past.

new_fixture
printf 'and a helpful clarification we added ourselves\n' >> "${fixture_root}/LICENSE"
assert_violation "an edited LICENSE is rejected" \
  "LICENSE: recorded"

# Both files must be verified, not just the first one read. Checking only the
# head of the list leaves every other case in this file green.
new_fixture
printf 'plus a granted patent exception\n' >> "${fixture_root}/LICENSES/Apache-2.0.txt"
assert_violation "an edited LICENSES/Apache-2.0.txt is rejected, not only LICENSE" \
  "LICENSES/Apache-2.0.txt: recorded"

# --- Nothing to verify must fail, not pass ------------------------------------
#
# The vacuous-pass trap. If the integrity block is deleted or reworded so the
# digests no longer parse, a checker that simply iterates over what it found
# verifies zero files and exits 0 -- reporting success for having checked
# nothing. Every case below asserts the checker notices what is *absent*.

new_fixture
write_adr "no digests here any more"
assert_violation "an ADR with no integrity block is rejected" \
  "no SHA-256 digest recorded for LICENSE"

new_fixture
write_adr "$(digest_of "${fixture_root}/LICENSE")  LICENSE"
assert_violation "an ADR recording only one of the two licences is rejected" \
  "no SHA-256 digest recorded for LICENSES/Apache-2.0.txt"

# Substitution rather than deletion: the block still has two well-formed
# records, so a count-based guard would pass it.
new_fixture
printf 'The On Your Left contributors\n' > "${fixture_root}/COPYRIGHT"
write_adr "$(digest_of "${fixture_root}/COPYRIGHT")  COPYRIGHT
$(digest_of "${fixture_root}/LICENSES/Apache-2.0.txt")  LICENSES/Apache-2.0.txt"
assert_violation "an ADR recording some other file in place of LICENSE is rejected" \
  "no SHA-256 digest recorded for LICENSE"

new_fixture
rm "${fixture_root}/LICENSES/Apache-2.0.txt"
assert_violation "a recorded licence file that is missing is rejected" \
  "LICENSES/Apache-2.0.txt: recorded in"

new_fixture
rm "${fixture_root}/docs/adr/0001-licence.md"
assert_violation "a missing ADR 0001 is rejected" \
  "docs/adr/0001-licence.md: not found"

# --- The real repository must pass --------------------------------------------

REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
out="$(bash "${CHECKER}" "${REPO_ROOT}" 2>&1)"
status=$?
if [ "${status}" -eq 0 ]; then
  pass=$((pass + 1))
  printf 'ok   this repository'\''s recorded licence digests reproduce\n'
else
  fail=$((fail + 1))
  printf 'FAIL this repository'\''s recorded licence digests reproduce\n     exit %s\n%s\n' \
    "${status}" "${out}"
fi

printf '\n%s passed, %s failed\n' "${pass}" "${fail}"
[ "${fail}" -eq 0 ]
