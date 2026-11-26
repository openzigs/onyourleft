#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for scripts/check-commit-identity.mjs (#3205).
#
# Same shape as the other suites: each case builds a throwaway git repository,
# makes commits whose identity carries -- or does not carry -- an invented
# term, runs the checker inside it, and asserts on the exit code and the text.
#
# The terms here are INVENTED (`acme-corp`, `zq`). The real list is a
# repository secret and appears nowhere in this repository; the checker's
# header says why.
#
# Two failures matter more than the rest:
#
# - the vacuous pass: a format string or a range that silently reads no
#   commits reports nothing and exits 0. Every clean case therefore also
#   asserts how many commits the success line says it scanned;
# - the leak: a report that names what matched publishes it in a public log.
#   Every red case therefore also asserts that the output does not contain the
#   term in any spelling.
#
# Needs Node and git, so -- like the other Node checkers -- it is NOT part of
# `pnpm run check:repo`.
#
# Run: bash scripts/check-commit-identity.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="${SCRIPT_DIR}/check-commit-identity.mjs"

pass=0
fail=0
repo=""

cleanup() { [ -n "${repo}" ] && rm -rf "${repo}"; }
trap cleanup EXIT

# The invented list. One long term (collapsed match) and one short term (token
# match), a comment and a blank line.
TERMS=$'# invented terms for the suite\nacme-corp\n\nzq'

# A git that reads no developer config (no signing, no hooks, no identity).
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_NOSYSTEM=1
unset PRIVATE_TERMS PRIVATE_TERMS_FILE REQUIRE_PRIVATE_TERMS GITHUB_ACTIONS

new_repo() {
  cleanup
  repo="$(mktemp -d)"
  git -C "${repo}" init -q -b main
}

# commit <message> [VAR=value]... -- an empty commit with a clean identity
# unless the caller overrides one of the GIT_* identity variables.
commit() {
  local message="$1"
  shift
  env GIT_AUTHOR_NAME="Ada Rider" GIT_AUTHOR_EMAIL="ada@example.com" \
    GIT_COMMITTER_NAME="Ada Rider" GIT_COMMITTER_EMAIL="ada@example.com" \
    "$@" git -C "${repo}" commit -q --allow-empty -m "${message}"
}

sha() { git -C "${repo}" rev-parse "${1:-HEAD}"; }

# run_check [arg]... -- runs inside the fixture repository with the invented
# list unless the caller has already set PRIVATE_TERMS for this call.
run_check() {
  (cd "${repo}" && PRIVATE_TERMS="${PRIVATE_TERMS-${TERMS}}" node "${CHECK}" "$@" 2>&1)
}

ok() { pass=$((pass + 1)); printf 'ok   %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf 'FAIL %s\n     %s\n%s\n' "$1" "$2" "$3"; }

# no_leak <output> -- the invented terms in any spelling the matcher accepts.
no_leak() { ! grep -qiE 'acme|corp|(^|[^a-z0-9])zq([^a-z0-9]|$)' <<< "$1"; }

# expect_hit <name> <expected-line-substring> <arg>...
expect_hit() {
  local name="$1" needle="$2" out status
  shift 2
  out="$(run_check "$@")"
  status=$?
  if [ "${status}" -ne 1 ]; then
    bad "${name}" "expected exit 1, got ${status}" "${out}"
  elif ! grep -qF -- "${needle}" <<< "${out}"; then
    bad "${name}" "expected the report to contain: ${needle}" "${out}"
  elif ! no_leak "${out}"; then
    bad "${name}" "the report printed the term" "${out}"
  else
    ok "${name}"
  fi
}

# expect_clean <name> <expected-commit-count> <arg>...
expect_clean() {
  local name="$1" count="$2" out status
  shift 2
  out="$(run_check "$@")"
  status=$?
  if [ "${status}" -ne 0 ]; then
    bad "${name}" "expected exit 0, got ${status}" "${out}"
  elif ! grep -qF "check-commit-identity: ${count} commit(s) in" <<< "${out}"; then
    bad "${name}" "expected the success line to count ${count} commit(s)" "${out}"
  else
    ok "${name}"
  fi
}

# --- A clean range, and the vacuous pass ---------------------------------------

new_repo
commit "root"
base="$(sha)"
commit "feat: a clean change"
commit "fix: another" GIT_AUTHOR_NAME="Bea Climber"
expect_clean "a clean range passes and counts its commits" 2 --base "${base}" --head HEAD
expect_clean "an empty range passes and says it read nothing" 0 --base "$(sha)" --head HEAD

# --- Every field, one case each ------------------------------------------------

field_case() {
  local name="$1" needle="$2" message="$3"
  shift 3
  new_repo
  commit "root"
  base="$(sha)"
  commit "${message}" "$@"
  expect_hit "${name}" "$(sha)  ${needle}" --base "${base}" --head HEAD
}

field_case "author name" "author name" "feat: x" GIT_AUTHOR_NAME="Acme Corp Builder"
field_case "author email" "author email" "feat: x" GIT_AUTHOR_EMAIL="ada@laptop.acme-corp.example"
field_case "committer name" "committer name" "feat: x" GIT_COMMITTER_NAME="ACME_CORP"
field_case "committer email" "committer email" "feat: x" GIT_COMMITTER_EMAIL="ci@AcmeCorp.example"
field_case "a Co-authored-by trailer" "Co-authored-by trailer" \
  $'feat: x\n\nCo-authored-by: Ada <ada@build-host.acme-corp.lan>'
field_case "a Signed-off-by trailer" "Signed-off-by trailer" \
  $'feat: x\n\nSigned-off-by: Ada <ada@acme-corp.example>'
field_case "the message body" "commit message" \
  $'feat: x\n\nTraced on the acme.corp staging box.'

# An unlisted trailer key is text from the commit: reported by position only.
new_repo
commit "root"
base="$(sha)"
commit $'feat: x\n\nAcme-Corp-Reviewer: Ada <ada@example.com>'
expect_hit "an unlisted trailer key is not printed" "$(sha)  trailer 1 (key not shown)" \
  --base "${base}" --head HEAD

# --- How a term matches ----------------------------------------------------------

new_repo
commit "root"
base="$(sha)"
commit "fix: the zqHost probe"
expect_hit "a short term matches a camelCase token" "$(sha)  commit message" \
  --base "${base}" --head HEAD

new_repo
commit "root"
base="$(sha)"
commit "fix: build-zq-01 timeout" GIT_AUTHOR_EMAIL="ada@zq.example"
expect_hit "a short term matches a whole token in an email" "$(sha)  author email" \
  --base "${base}" --head HEAD

new_repo
commit "root"
base="$(sha)"
commit "fix: the pizqa bazq and zqx words" GIT_AUTHOR_NAME="Lizqa Ride"
expect_clean "a short term does not match inside a word" 1 --base "${base}" --head HEAD

new_repo
commit "root"
base="$(sha)"
commit "fix: x" GIT_COMMITTER_EMAIL="ci@buildacmecorp01.example"
expect_hit "a long term matches inside a fused hostname" "$(sha)  committer email" \
  --base "${base}" --head HEAD

new_repo
commit "root"
base="$(sha)"
commit "fix: acme and corp, apart"
expect_clean "a long term does not match its words apart" 1 --base "${base}" --head HEAD

# --- Only the range is read ------------------------------------------------------

new_repo
commit "root" GIT_AUTHOR_NAME="Acme Corp"
base="$(sha)"
commit "feat: clean"
expect_clean "a hit before the base is outside the range" 1 --base "${base}" --head HEAD

# --- The fallback range ----------------------------------------------------------

# 52 commits: the oldest two carry the term, so the last 50 are clean, and a
# hit at the 50th from the tip is inside the fallback.
fallback_repo() {
  new_repo
  commit "oldest" GIT_AUTHOR_NAME="Acme Corp"
  commit "second oldest" GIT_AUTHOR_NAME="Acme Corp"
  local i
  for i in $(seq 1 50); do commit "commit ${i}"; done
}

fallback_repo
expect_clean "an all-zero base reads the last 50 commits" 50 \
  --base 0000000000000000000000000000000000000000 --head HEAD
expect_clean "no base reads the last 50 commits" 50 --head HEAD
expect_clean "an unknown base reads the last 50 commits" 50 \
  --base 1234567890abcdef1234567890abcdef12345678 --head HEAD
expect_clean "a forced push reads the last 50 commits" 50 \
  --base "$(sha HEAD~1)" --head HEAD --forced true

# expect_reason <reason> <arg>... -- the success line says WHY it fell back.
expect_reason() {
  local reason="$1" out
  shift
  out="$(run_check "$@")"
  if grep -qF "the last 50 commits, because ${reason}" <<< "${out}"; then
    ok "the fallback says: ${reason}"
  else
    bad "the fallback says: ${reason}" "reason missing" "${out}"
  fi
}
expect_reason "no base was given" --head HEAD
expect_reason "the base is all zeros (a branch's first push)" \
  --base 0000000000000000000000000000000000000000 --head HEAD
expect_reason "the push was forced" --base "$(sha HEAD~1)" --head HEAD --forced true
expect_reason "the base is not a commit this clone holds" \
  --base 1234567890abcdef1234567890abcdef12345678 --head HEAD

new_repo
commit "oldest" GIT_AUTHOR_NAME="Acme Corp"
for i in $(seq 1 49); do commit "commit ${i}"; done
expect_hit "the 50th commit back is inside the fallback" "$(sha HEAD~49)  author name" \
  --base 0000000000000000000000000000000000000000 --head HEAD
expect_hit "a forced push is not read as before..after" "$(sha HEAD~49)  author name" \
  --base "$(sha HEAD~1)" --head HEAD --forced true
expect_clean "an unforced push reads before..after" 1 \
  --base "$(sha HEAD~1)" --head HEAD --forced false

# --- No list, an empty list, a list from a file ----------------------------------

new_repo
commit "root"
out="$(cd "${repo}" && PRIVATE_TERMS="" node "${CHECK}" --head HEAD 2>&1)"
status=$?
if [ "${status}" -eq 0 ] \
   && grep -qxF "private-terms secret not available: identity check skipped" <<< "${out}"; then
  ok "no list and not required: skips loudly"
else
  bad "no list and not required: skips loudly" "status ${status}" "${out}"
fi

out="$(cd "${repo}" && PRIVATE_TERMS="" GITHUB_ACTIONS=true node "${CHECK}" --head HEAD 2>&1)"
if grep -qxF "::warning::private-terms secret not available: identity check skipped" <<< "${out}"; then
  ok "no list in Actions: the skip is a warning annotation"
else
  bad "no list in Actions: the skip is a warning annotation" "no annotation" "${out}"
fi

for required in true 1; do
  out="$(cd "${repo}" && PRIVATE_TERMS="" REQUIRE_PRIVATE_TERMS="${required}" \
    node "${CHECK}" --head HEAD 2>&1)"
  status=$?
  if [ "${status}" -eq 1 ] && grep -qF "NOTHING WAS CHECKED" <<< "${out}"; then
    ok "no list and REQUIRE_PRIVATE_TERMS=${required}: fails"
  else
    bad "no list and REQUIRE_PRIVATE_TERMS=${required}: fails" "status ${status}" "${out}"
  fi
done

out="$(cd "${repo}" && PRIVATE_TERMS="" REQUIRE_PRIVATE_TERMS=false node "${CHECK}" --head HEAD 2>&1)"
status=$?
if [ "${status}" -eq 0 ]; then
  ok "REQUIRE_PRIVATE_TERMS=false (a fork's pull request) still skips"
else
  bad "REQUIRE_PRIVATE_TERMS=false (a fork's pull request) still skips" "status ${status}" "${out}"
fi

PRIVATE_TERMS=$'# only a comment\n\n   \n' expect_hit "a list of only comments fails" \
  "has no terms" --head HEAD

new_repo
commit "root"
base="$(sha)"
commit "feat: x" GIT_AUTHOR_EMAIL="ada@acme-corp.example"
printf '%s\n' "${TERMS}" > "${repo}/.git/terms.txt"
PRIVATE_TERMS="" PRIVATE_TERMS_FILE="${repo}/.git/terms.txt" \
  expect_hit "the list can come from PRIVATE_TERMS_FILE" "$(sha)  author email" \
  --base "${base}" --head HEAD

expect_hit "an unknown head fails" "--head is not a commit" \
  --base "${base}" --head 1234567890abcdef1234567890abcdef12345678

out="$(cd "${repo}" && GITHUB_ACTIONS=true PRIVATE_TERMS="${TERMS}" \
  node "${CHECK}" --base "${base}" --head HEAD 2>&1)"
if grep -qxF "::error::commit $(sha): private term in its author email" <<< "${out}" \
   && no_leak "${out}"; then
  ok "in Actions a hit is an error annotation that names the field only"
else
  bad "in Actions a hit is an error annotation that names the field only" "no annotation" "${out}"
fi

printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
[ "${fail}" -eq 0 ]
