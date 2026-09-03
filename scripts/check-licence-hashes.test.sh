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

# --- The per-package copies of those texts ------------------------------------
#
# LIC004 requires every leaf package to carry its own LICENSE; these cases
# require it to carry the right one. A drifted copy is the same licensing
# incident as an edited canonical text and is easier to miss, because nobody
# re-reads the fourth copy of the Apache licence.

new_fixture
mkdir -p "${fixture_root}/packages/domain" "${fixture_root}/apps/web"
cp "${fixture_root}/LICENSES/Apache-2.0.txt" "${fixture_root}/packages/domain/LICENSE"
cp "${fixture_root}/LICENSE" "${fixture_root}/apps/web/LICENSE"
assert_clean "byte-identical per-package copies pass"

new_fixture
mkdir -p "${fixture_root}/packages/domain"
cp "${fixture_root}/LICENSES/Apache-2.0.txt" "${fixture_root}/packages/domain/LICENSE"
printf 'with a field-of-use restriction we added ourselves\n' \
  >> "${fixture_root}/packages/domain/LICENSE"
assert_violation "a drifted packages/ LICENSE copy is rejected" \
  "packages/domain/LICENSE: not byte-identical to LICENSES/Apache-2.0.txt"

# The wrong canonical text, not a mangled one: an Apache leaf package carrying
# the AGPL text is well-formed, plausible on a hurried copy-paste, and inverts
# the licence boundary ADR 0001 exists to hold.
new_fixture
mkdir -p "${fixture_root}/packages/domain"
cp "${fixture_root}/LICENSE" "${fixture_root}/packages/domain/LICENSE"
assert_violation "a packages/ leaf carrying the AGPL text is rejected" \
  "packages/domain/LICENSE: not byte-identical to LICENSES/Apache-2.0.txt"

# Both trees, not only the first one walked.
new_fixture
mkdir -p "${fixture_root}/apps/web"
cp "${fixture_root}/LICENSES/Apache-2.0.txt" "${fixture_root}/apps/web/LICENSE"
assert_violation "an apps/ leaf carrying the Apache text is rejected" \
  "apps/web/LICENSE: not byte-identical to LICENSE"

# node_modules holds thousands of third-party LICENSE files, none of which this
# repository's boundary has anything to say about. Walking into it would fail
# every clone that has run an install.
new_fixture
mkdir -p "${fixture_root}/packages/domain/node_modules/left-pad"
cp "${fixture_root}/LICENSES/Apache-2.0.txt" "${fixture_root}/packages/domain/LICENSE"
printf 'MIT License\n' > "${fixture_root}/packages/domain/node_modules/left-pad/LICENSE"
assert_clean "a dependency's own LICENSE under node_modules is not compared"

# --- The sha256sum fallback ---------------------------------------------------
#
# Review of PR #100 found this branch was a surviving mutant: deleting the whole
# `elif command -v sha256sum` arm left the suite green, because every machine the
# suite had run on so far had `shasum`. CI runs on ubuntu-latest, where the
# fallback is the arm that actually executes -- so the untested branch was the
# one carrying the real workload.
#
# Forcing it needs a PATH with sha256sum and WITHOUT shasum. The script uses only
# four external commands, so a curated stub directory is small enough to be
# honest rather than fragile.

new_fixture
stub_bin="$(mktemp -d)"
# PATH is curated to hide shasum from the SCRIPT. The interpreter itself is
# invoked by absolute path, because PATH no longer contains bash either.
bash_abs="$(command -v bash)"
for tool in cut dirname grep sed; do
  tool_path="$(command -v "${tool}")"
  ln -s "${tool_path}" "${stub_bin}/${tool}"
done
# A sha256sum emitting the same "<digest>  <path>" shape coreutils does. It
# delegates to whichever real digest tool this host has, captured as an ABSOLUTE
# path at generation time -- the curated PATH hides those from the stub too, and
# the point is to exercise OUR fallback branch, not to reimplement SHA-256.
if command -v shasum >/dev/null 2>&1; then
  real_digest="$(command -v shasum) -a 256"
elif command -v sha256sum >/dev/null 2>&1; then
  real_digest="$(command -v sha256sum)"
else
  printf 'SKIP no digest tool on this host; cannot build the sha256sum stub\n'
  real_digest=""
fi
# SC2016 is the point here, not a mistake: these printf bodies are the TEXT of a
# script being generated. `${f}` and `${d}` must survive into the stub unexpanded
# and be evaluated when the stub runs, so they are deliberately single-quoted.
# The two values that must expand now -- the interpreter and the real digest tool
# -- are passed as printf arguments instead.
# shellcheck disable=SC2016
{
  printf '#!%s\n' "${bash_abs}"
  printf 'for f in "$@"; do\n'
  printf '  [ "${f}" = "-" ] && continue\n'
  printf '  d="$(%s "${f}" | %s -d" " -f1)"\n' "${real_digest}" "$(command -v cut)"
  printf '  printf "%%s  %%s\\n" "${d}" "${f}"\n'
  printf 'done\n'
} > "${stub_bin}/sha256sum"
chmod +x "${stub_bin}/sha256sum"

out="$(PATH="${stub_bin}" "${bash_abs}" "${CHECKER}" "${fixture_root}" 2>&1)"
status=$?
if [ "${status}" -eq 0 ]; then
  pass=$((pass + 1))
  printf 'ok   the sha256sum fallback verifies digests when shasum is absent\n'
else
  fail=$((fail + 1))
  printf 'FAIL the sha256sum fallback verifies digests when shasum is absent\n     expected exit 0, got %s\n%s\n' \
    "${status}" "${out}"
fi
cleanup_fixture

# And it must still CATCH a bad digest on that path -- a fallback that always
# passes is worse than no fallback, because it reports success on a tampered
# licence file.
new_fixture
printf 'tampered\n' >> "${fixture_root}/LICENSE"
out="$(PATH="${stub_bin}" "${bash_abs}" "${CHECKER}" "${fixture_root}" 2>&1)"
status=$?
if [ "${status}" -ne 0 ] && printf '%s' "${out}" | grep -q "^LIC005: "; then
  pass=$((pass + 1))
  printf 'ok   the sha256sum fallback still rejects an edited LICENSE\n'
else
  fail=$((fail + 1))
  printf 'FAIL the sha256sum fallback still rejects an edited LICENSE\n     expected exit != 0 with a LIC005 line; got exit %s\n%s\n' \
    "${status}" "${out}"
fi
cleanup_fixture
rm -rf "${stub_bin}"

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
