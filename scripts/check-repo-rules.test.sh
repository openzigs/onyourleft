#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for scripts/check-repo-rules.sh.
#
# Each case builds a throwaway fixture tree, runs the checker against it, and
# asserts on the exit code and on the rule id the checker reported. Asserting
# the rule id matters: a checker that fails for the wrong reason is a checker
# that will pass for the wrong reason later.
#
# Run: bash scripts/check-repo-rules.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKER="${SCRIPT_DIR}/check-repo-rules.sh"

pass=0
fail=0

fixture_root=""
new_fixture() {
  fixture_root="$(mktemp -d)"
  mkdir -p "${fixture_root}/docs/adr"
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

# assert_violation <name> <expected-rule-id> <expected-substring>
#
# The substring is not decoration. Asserting only "some line mentions LIC001"
# passes whenever *any* file in the fixture violates the rule, so a checker that
# flags the wrong file still looks correct. Mutation testing caught exactly that:
# inverting the header comparison kept these cases green because the fixture's
# well-formed file was then the one being reported. The assertion must name the
# file the rule is supposed to catch.
#
# `grep -qF -- "${needle}"`, with the `--`, because a needle beginning with a
# hyphen is otherwise read as a bundle of options. ADR003 quotes the offending
# Markdown bullet back at the reader, so "- Decision C drifted too." is a needle
# a caller will reasonably pass; without the `--` that case reports a checker
# failure that is really a harness failure, which is the most expensive red
# there is.
assert_violation() {
  local name="$1" rule="$2" needle="$3" out status
  out="$(bash "${CHECKER}" "${fixture_root}" 2>&1)"
  status=$?
  if [ "${status}" -ne 0 ] \
     && printf '%s' "${out}" | grep "^${rule}: " | grep -qF -- "${needle}"; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "${name}"
  else
    fail=$((fail + 1))
    printf 'FAIL %s\n     expected exit != 0 and a "%s: " line containing "%s"; got exit %s\n%s\n' \
      "${name}" "${rule}" "${needle}" "${status}" "${out}"
  fi
  cleanup_fixture
}

# assert_violation_all <name> <expected-rule-id> <expected-substring>...
#
# assert_violation with more than one needle, all of which must appear on the
# SAME reported line. ADR001 needs it: the rule's whole point after #118 is that
# one finding names both colliding files, and two separate single-needle
# assertions would also pass against a checker that emitted two findings naming
# one file each -- which is the behaviour being replaced.
#
# It asks whether ANY ONE reported line carries every needle, not whether the
# FIRST one does. #147: it used to take `head -1`, which made it silently
# order-dependent -- a fixture in which the checker legitimately reports two
# findings for the rule failed whenever the line being asserted was the second,
# and the failure read as a checker bug. That is the same shape as the defect
# #118 fixed in ADR001 itself: a helper deciding from `sort` order, which
# carries no information about what is being looked for. `needle` is `local`
# for the same reason every other variable here is; it was the one that was not,
# and a loop variable left in the global scope is a cross-test coupling waiting
# to be depended on.
assert_violation_all() {
  local name="$1" rule="$2" out status line needle missing="" matched=""
  shift 2
  out="$(bash "${CHECKER}" "${fixture_root}" 2>&1)"
  status=$?
  while IFS= read -r line; do
    [ -n "${line}" ] || continue
    missing=""
    for needle in "$@"; do
      printf '%s' "${line}" | grep -qF -- "${needle}" || missing="${missing} \"${needle}\""
    done
    if [ -z "${missing}" ]; then
      matched="${line}"
      break
    fi
  done < <(printf '%s\n' "${out}" | grep "^${rule}: ")
  if [ "${status}" -ne 0 ] && [ -n "${matched}" ]; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "${name}"
  else
    fail=$((fail + 1))
    printf 'FAIL %s\n     no single "%s: " line carried every needle; got exit %s\n%s\n' \
      "${name}" "${rule}" "${status}" "${out}"
  fi
  cleanup_fixture
}

# assert_helper_fails <name> <helper> <helper-arg>...
#
# Runs an assertion helper that is EXPECTED to report a failure, and turns that
# report into a pass. Every "the helper must still be able to say no" case goes
# through here, so there is exactly ONE place that has to remember to increment
# `fail` -- and that place is exercised by `assert_helper_passes` below.
#
# #150's review found the hand-written version of this: its `else` branch
# printed `FAIL` and never touched the counter, so the guard proving the helper
# could still fail was itself unable to fail the build. The suite printed a FAIL
# line, tallied "0 failed", and exited 0; CI judges the step by exit code alone.
#
# The helper runs inside a command substitution, which is a SUBSHELL, so its own
# pass=/fail= increments cannot reach this script's tally and no counter has to
# be unwound by hand afterwards. `cleanup_fixture` still removes the fixture,
# because `rm -rf` in a subshell is a real `rm -rf`.
assert_helper_fails() {
  local name="$1" out
  shift
  out="$("$@" 2>&1)"
  if printf '%s\n' "${out}" | grep -q '^FAIL '; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "${name}"
  else
    fail=$((fail + 1))
    printf 'FAIL %s\n     %s accepted it; expected the helper to report a failure\n%s\n' \
      "${name}" "$1" "${out}"
  fi
}

# assert_helper_passes <name> <helper> <helper-arg>...
#
# The complement, and the reason `assert_helper_fails` is not itself a guard
# that cannot fire: without this, `assert_helper_fails` would pass for a helper
# that reported FAIL unconditionally -- which is exactly as useless as the
# helper that can never report one. Same subshell, same reasoning.
assert_helper_passes() {
  local name="$1" out
  shift
  out="$("$@" 2>&1)"
  if printf '%s\n' "${out}" | grep -q '^FAIL '; then
    fail=$((fail + 1))
    printf 'FAIL %s\n     %s rejected it; expected the helper to pass\n%s\n' \
      "${name}" "$1" "${out}"
  else
    pass=$((pass + 1))
    printf 'ok   %s\n' "${name}"
  fi
}

# A Markdown code fence and a bare dollar, as variables rather than literals:
# three backticks, and a `$(`, inside single quotes both read as an unexpanded
# expression to shellcheck (SC2016), and CI treats an info-level finding as a
# failure. Both are wanted verbatim in a fixture -- one is Markdown, the other
# is the hostile input the ADR003 probe feeds the checker.
FENCE='```'
DOLLAR='$'

# A minimal well-formed Apache-2.0 leaf package.
write_good_package() {
  local name="$1"
  mkdir -p "${fixture_root}/packages/${name}/src"
  printf '// SPDX-License-Identifier: Apache-2.0\nexport const x = 1;\n' \
    > "${fixture_root}/packages/${name}/src/index.ts"
  printf '{ "name": "@onyourleft/%s", "license": "Apache-2.0" }\n' "${name}" \
    > "${fixture_root}/packages/${name}/package.json"
  printf 'Apache License 2.0\n' > "${fixture_root}/packages/${name}/LICENSE"
}

# A minimal well-formed AGPL application.
write_good_app() {
  local name="$1"
  mkdir -p "${fixture_root}/apps/${name}/src"
  printf '// SPDX-License-Identifier: AGPL-3.0-or-later\nexport const y = 2;\n' \
    > "${fixture_root}/apps/${name}/src/main.ts"
  printf '{ "name": "@onyourleft/%s", "license": "AGPL-3.0-or-later" }\n' "${name}" \
    > "${fixture_root}/apps/${name}/package.json"
  printf 'GNU Affero General Public License v3\n' > "${fixture_root}/apps/${name}/LICENSE"
}

# --- LIC001: source under packages/ must be Apache-2.0 -----------------------

new_fixture
write_good_package domain
write_good_app web
assert_clean "clean tree passes"

new_fixture
write_good_package domain
printf '// SPDX-License-Identifier: AGPL-3.0-or-later\nexport const z = 3;\n' \
  > "${fixture_root}/packages/domain/src/leaked.ts"
assert_violation "AGPL header inside packages/ is rejected" LIC001 \
  "packages/domain/src/leaked.ts: SPDX header is AGPL-3.0-or-later"

new_fixture
write_good_package domain
printf 'export const z = 3;\n' > "${fixture_root}/packages/domain/src/nohdr.ts"
assert_violation "missing SPDX header inside packages/ is rejected" LIC001 \
  "packages/domain/src/nohdr.ts: no SPDX-License-Identifier"

# --- LIC002: source under apps/ must be AGPL-3.0-or-later --------------------

new_fixture
write_good_app web
printf '// SPDX-License-Identifier: Apache-2.0\nexport const z = 3;\n' \
  > "${fixture_root}/apps/web/src/wrong.ts"
assert_violation "Apache-2.0 header inside apps/ is rejected" LIC002 \
  "apps/web/src/wrong.ts: SPDX header is Apache-2.0"

# --- LIC003: manifest licence field must match the path ----------------------

new_fixture
write_good_package domain
printf '{ "name": "@onyourleft/domain", "license": "MIT" }\n' \
  > "${fixture_root}/packages/domain/package.json"
assert_violation "packages/ manifest declaring a non-Apache licence is rejected" LIC003 \
  "packages/domain/package.json: declares \"MIT\""

new_fixture
write_good_app web
printf '{ "name": "@onyourleft/web", "license": "Apache-2.0" }\n' \
  > "${fixture_root}/apps/web/package.json"
assert_violation "apps/ manifest declaring a non-AGPL licence is rejected" LIC003 \
  "apps/web/package.json: declares \"Apache-2.0\""

new_fixture
write_good_package domain
printf '{ "name": "@onyourleft/domain" }\n' \
  > "${fixture_root}/packages/domain/package.json"
assert_violation "packages/ manifest with no licence field is rejected" LIC003 \
  "packages/domain/package.json: no \"license\" field"

# --- LIC004: every leaf package carries its own LICENSE file -----------------

new_fixture
write_good_package domain
rm "${fixture_root}/packages/domain/LICENSE"
assert_violation "leaf package without its own LICENSE is rejected" LIC004 \
  "packages/domain: no LICENSE file"

# Both trees. CLAUDE.md section 3 says "each package" carries its own LICENSE and
# means apps/ too; until this case existed, deleting apps/web/LICENSE outright
# failed nothing at all.
new_fixture
write_good_app web
rm "${fixture_root}/apps/web/LICENSE"
assert_violation "app without its own LICENSE is rejected" LIC004 \
  "apps/web: no LICENSE file"

# --- SCOPE001: no ANT+ anywhere in the source trees --------------------------

new_fixture
write_good_package sensors
printf '// SPDX-License-Identifier: Apache-2.0\n// ANT+ FE-C transport\n' \
  > "${fixture_root}/packages/sensors/src/antplus.ts"
assert_violation "ANT+ reference in a source tree is rejected" SCOPE001 \
  "packages/sensors/src/antplus.ts"

new_fixture
write_good_package sensors
printf 'ANT+ is out of scope permanently; see ADR 0005.\n' \
  > "${fixture_root}/docs/adr/0003-platform-support.md"
assert_clean "ANT+ named in docs/ to explain its exclusion is allowed"

# --- ADR001: ADR numbers are unique ------------------------------------------

new_fixture
printf '# ADR 0005\n' > "${fixture_root}/docs/adr/0005-tech-stack.md"
printf '# ADR 0005\n' > "${fixture_root}/docs/adr/0005-local-first-architecture.md"
assert_violation "two ADRs sharing a number are rejected" ADR001 \
  "share ADR number 0005"

new_fixture
printf '# ADR 0005\n' > "${fixture_root}/docs/adr/0005-tech-stack.md"
printf '# ADR 0006\n' > "${fixture_root}/docs/adr/0006-fit-codec-licensing.md"
assert_clean "distinct ADR numbers pass"

# --- ADR001 regressions found in #118 ----------------------------------------
#
# The checker iterated `find | sort` and reported whichever of two colliding
# files sorted SECOND, with a message telling the reader to renumber it. Sort
# order carries no information about which file is new, so about half the time
# that named the MERGED ADR -- and told the contributor to renumber the one file
# that must never be renumbered, since ADRs are cited by number from other ADRs
# and from docs/architecture.md. The build failed correctly and advised wrongly.
#
# Both orderings are asserted, because the old behaviour was right by accident
# in one of them and a single case cannot tell the two apart.

# The new file's slug sorts BEFORE the merged one -- the case that produced the
# wrong advice. `find | sort` reports 0002-local-first-architecture.md, which is
# the merged ADR cited by ADR 0001, ADR 0004 and ADR 0005.
new_fixture
printf '# ADR 0002\n' > "${fixture_root}/docs/adr/0002-clean-room-posture.md"
printf '# ADR 0002\n' > "${fixture_root}/docs/adr/0002-local-first-architecture.md"
assert_violation_all "a collision names BOTH paths when the new file sorts first" ADR001 \
  "docs/adr/0002-clean-room-posture.md" \
  "docs/adr/0002-local-first-architecture.md" \
  "share ADR number 0002"

# The same collision the other way round, where the old message happened to be
# correct. It must keep naming both, or the fix is only half applied.
new_fixture
printf '# ADR 0002\n' > "${fixture_root}/docs/adr/0002-local-first-architecture.md"
printf '# ADR 0002\n' > "${fixture_root}/docs/adr/0002-zzz-probe.md"
assert_violation_all "a collision names BOTH paths when the new file sorts second" ADR001 \
  "docs/adr/0002-local-first-architecture.md" \
  "docs/adr/0002-zzz-probe.md" \
  "share ADR number 0002"

# The checker cannot know which file is new, so it must not imply that it does.
# Asserted as the ABSENCE of the old instruction plus the presence of the
# pointer that replaces it: the ownership table is where the answer actually is.
new_fixture
printf '# ADR 0002\n' > "${fixture_root}/docs/adr/0002-clean-room-posture.md"
printf '# ADR 0002\n' > "${fixture_root}/docs/adr/0002-local-first-architecture.md"
out="$(bash "${CHECKER}" "${fixture_root}" 2>&1)"
status=$?
if [ "${status}" -ne 0 ] \
   && printf '%s' "${out}" | grep -q '^ADR001: ' \
   && ! printf '%s' "${out}" | grep -qF 'is already taken' \
   && printf '%s' "${out}" | grep -qF 'docs/architecture.md'; then
  pass=$((pass + 1))
  printf 'ok   ADR001 points at the ownership table instead of naming a file to renumber\n'
else
  fail=$((fail + 1))
  printf 'FAIL ADR001 points at the ownership table instead of naming a file to renumber\n     got exit %s\n%s\n' \
    "${status}" "${out}"
fi
cleanup_fixture

# Three files on one number: every collision is reported, not just the first.
new_fixture
printf '# ADR 0002\n' > "${fixture_root}/docs/adr/0002-alpha.md"
printf '# ADR 0002\n' > "${fixture_root}/docs/adr/0002-beta.md"
printf '# ADR 0002\n' > "${fixture_root}/docs/adr/0002-gamma.md"
out="$(bash "${CHECKER}" "${fixture_root}" 2>&1)"
status=$?
count="$(printf '%s\n' "${out}" | grep -c '^ADR001: ')"
if [ "${status}" -ne 0 ] && [ "${count}" -eq 2 ]; then
  pass=$((pass + 1))
  printf 'ok   three ADRs on one number report two collisions\n'
else
  fail=$((fail + 1))
  printf 'FAIL three ADRs on one number report two collisions\n     expected 2 ADR001 lines, got %s at exit %s\n%s\n' \
    "${count}" "${status}" "${out}"
fi
cleanup_fixture

# --- assert_violation_all's own regressions, found in the #144 review (#147) --
#
# Two collisions on two different numbers, so the checker reports two ADR001
# lines and the one being asserted is the SECOND. `find | sort` puts
# 0002-alpha, 0002-beta, 0003-delta, 0003-gamma in that order, so the 0002
# finding is printed first. The helper used to read `head -1` and compare the
# needles against that line alone, so this case failed -- reporting a checker
# defect that did not exist. A helper that is right only when the checker
# reports exactly one finding is a helper whose name overstates it, which is
# what #147 raised.
new_fixture
printf '# ADR 0002\n' > "${fixture_root}/docs/adr/0002-alpha.md"
printf '# ADR 0002\n' > "${fixture_root}/docs/adr/0002-beta.md"
printf '# ADR 0003\n' > "${fixture_root}/docs/adr/0003-delta.md"
printf '# ADR 0003\n' > "${fixture_root}/docs/adr/0003-gamma.md"
assert_violation_all "a collision is found on a line that is not the first reported" ADR001 \
  "docs/adr/0003-delta.md" \
  "docs/adr/0003-gamma.md" \
  "share ADR number 0003"

# ...and it must still be able to FAIL. Needles that no single line carries --
# one file from each collision -- must not pass merely because both appear
# somewhere in the output.
new_fixture
printf '# ADR 0002\n' > "${fixture_root}/docs/adr/0002-alpha.md"
printf '# ADR 0002\n' > "${fixture_root}/docs/adr/0002-beta.md"
printf '# ADR 0003\n' > "${fixture_root}/docs/adr/0003-delta.md"
printf '# ADR 0003\n' > "${fixture_root}/docs/adr/0003-gamma.md"
assert_helper_fails "assert_violation_all rejects needles spread across two reported lines" \
  assert_violation_all "(expected to fail) needles spread across two lines" ADR001 \
  "docs/adr/0002-alpha.md" "docs/adr/0003-gamma.md"
cleanup_fixture

# And `assert_helper_fails` must not be a guard that cannot fire either. It
# reads its verdict off the helper's OUTPUT, so a helper that passes has to be
# distinguishable from one that fails -- same fixture, needles that DO share a
# line, expected to pass.
new_fixture
printf '# ADR 0002\n' > "${fixture_root}/docs/adr/0002-alpha.md"
printf '# ADR 0002\n' > "${fixture_root}/docs/adr/0002-beta.md"
printf '# ADR 0003\n' > "${fixture_root}/docs/adr/0003-delta.md"
printf '# ADR 0003\n' > "${fixture_root}/docs/adr/0003-gamma.md"
assert_helper_passes "assert_helper_fails can tell a passing helper from a failing one" \
  assert_violation_all "(expected to pass) needles on one line" ADR001 \
  "docs/adr/0002-alpha.md" "docs/adr/0002-beta.md"
cleanup_fixture

# `needle` is declared local. A loop variable surviving into the global scope is
# a coupling a later case can come to depend on without anyone deciding to.
#
# This one CANNOT go through assert_helper_passes: that runs the helper in a
# subshell, where no variable could leak into this scope whatever the helper
# did, so the probe would pass vacuously. So the call is made here, in this
# shell, and its own tally is unwound explicitly -- both counters restored to
# what they were, rather than `pass` decremented on the assumption that the call
# went that way (#150's review). Its output goes to a log rather than to
# /dev/null, so a probe call that itself failed is reported instead of swallowed
# -- a leak check run against a call that never reached the loop proves nothing.
new_fixture
printf '# ADR 0002\n' > "${fixture_root}/docs/adr/0002-alpha.md"
printf '# ADR 0002\n' > "${fixture_root}/docs/adr/0002-beta.md"
unset needle
before_pass="${pass}"
before_fail="${fail}"
probe_log="$(mktemp)"
assert_violation_all "a collision names both paths (scope probe)" ADR001 \
  "docs/adr/0002-alpha.md" "docs/adr/0002-beta.md" > "${probe_log}" 2>&1
pass="${before_pass}"
fail="${before_fail}"
if grep -q '^FAIL ' "${probe_log}"; then
  fail=$((fail + 1))
  printf 'FAIL assert_violation_all scope probe: the probe call itself failed\n%s\n' \
    "$(cat "${probe_log}")"
elif [ -n "${needle+set}" ]; then
  fail=$((fail + 1))
  printf 'FAIL assert_violation_all does not leak needle into the global scope\n     needle survived the call as "%s"\n' "${needle}"
else
  pass=$((pass + 1))
  printf 'ok   assert_violation_all does not leak needle into the global scope\n'
fi
rm -f "${probe_log}"

# --- ADR002: ADR filenames follow NNNN-kebab-case.md -------------------------

new_fixture
printf '# ADR\n' > "${fixture_root}/docs/adr/tech-stack.md"
assert_violation "ADR filename without a number is rejected" ADR002 \
  "docs/adr/tech-stack.md"

new_fixture
printf '# ADR\n' > "${fixture_root}/docs/adr/0005-Tech_Stack.md"
assert_violation "ADR filename that is not kebab-case is rejected" ADR002 \
  "docs/adr/0005-Tech_Stack.md"

# --- ADR003: an amendment is appended, and only appended (#147) --------------
#
# ADR 0013 establishes the section. The rule exists because the convention is
# otherwise the honour system applied to a protected path: "append a dated note"
# and "edit the body and call it an amendment" produce diffs that look alike in
# review and are opposites in what they do to the record. The three things the
# rule can check from the file alone are that there is ONE section, that NOTHING
# follows it, and that every entry carries a date. Whether a change was actually
# an append is a property of the diff, not of the file, and is not checked here.

# The shape ADR 0013 prescribes, which must pass.
write_amended_adr() {
  local path="$1"
  {
    printf '# ADR 0011: Stream storage\n\n- **Status**: Accepted\n\n'
    printf '## Context\n\nSomething was true.\n\n'
    printf '## Amendments\n\n'
    printf -- '- **2026-09-05** — Decision H: the sentence is no longer true (#147).\n'
  } > "${path}"
}

new_fixture
write_amended_adr "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_clean "an ADR whose last section is a dated ## Amendments passes"

# The failure the rule exists for: a section AFTER Amendments means the note was
# inserted into the body rather than appended to the end of the file.
new_fixture
write_amended_adr "${fixture_root}/docs/adr/0011-stream-storage.md"
printf '\n## Notes\n\nStill here.\n' >> "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_violation "a section after ## Amendments is rejected" ADR003 \
  "docs/adr/0011-stream-storage.md: '## Amendments' (line 9) must be the last section"

# The offending heading is named, for the same reason ADR001 names both
# colliding files: a message that says only "something follows it" sends the
# reader back to scroll a 300-line ADR looking for what.
new_fixture
write_amended_adr "${fixture_root}/docs/adr/0011-stream-storage.md"
printf '\n## Notes\n\nStill here.\n' >> "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_violation "the section that follows ## Amendments is named, with its line" ADR003 \
  "'## Notes' follows it at line 13"

# Two sections rather than two entries. Appending a second heading each time is
# the shape that turns an append-only log into a pile.
new_fixture
write_amended_adr "${fixture_root}/docs/adr/0011-stream-storage.md"
{
  printf '\n## Amendments\n\n'
  printf -- '- **2026-09-06** — And another thing.\n'
} >> "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_violation "two ## Amendments sections are rejected" ADR003 \
  "docs/adr/0011-stream-storage.md: two '## Amendments' sections"

# An undated entry. The date is the whole point: it is what tells a reader
# whether the amendment predates the thing they are holding.
new_fixture
write_amended_adr "${fixture_root}/docs/adr/0011-stream-storage.md"
printf -- '- Decision C drifted too.\n' >> "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_violation_all "an amendment entry without a date is rejected, and its line named" ADR003 \
  "line 12: amendment entry must open with a bold ISO date" \
  "- Decision C drifted too."

# The same fixture through `assert_violation`, with the hyphen-leading needle
# ALONE. That is what covers the `--` in that helper's `grep -qF`: pass a needle
# beginning with a hyphen as the third argument and, without the `--`, grep
# exits 2 complaining about an invalid option and the case goes red.
#
# It is a separate case rather than a fourth argument to the one above, because
# `assert_violation` binds exactly three (`name rule needle`) -- #150's review
# found a fourth needle passed here and silently dropped, so both the "and its
# line named" promise and this `--` were asserting nothing while the suite read
# green.
new_fixture
write_amended_adr "${fixture_root}/docs/adr/0011-stream-storage.md"
printf -- '- Decision C drifted too.\n' >> "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_violation "the undated entry is quoted back, hyphen and all" ADR003 \
  "- Decision C drifted too."

# An empty section records nothing while looking like it records something.
new_fixture
printf '# ADR 0011\n\n## Context\n\nA thing.\n\n## Amendments\n' \
  > "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_violation "an empty ## Amendments section is rejected" ADR003 \
  "docs/adr/0011-stream-storage.md: '## Amendments' (line 7) has no entries"

# Over-strictness guard: an entry is a paragraph, not a line. A continuation
# line is indented and carries no date of its own, and must not be read as a
# second, undated entry. The INDENTED BULLET is the case that matters: a rule
# that matched a bullet anywhere in the line rather than at column one would
# reject a nested list inside an entry, which is how an amendment naming two
# drifted lines would reasonably be written.
new_fixture
write_amended_adr "${fixture_root}/docs/adr/0011-stream-storage.md"
{
  printf '  It named a value it no longer names, since #104.\n'
  printf '  - Decision H, second paragraph.\n'
  printf '  - Decision H, the sentence about the codec.\n'
} >> "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_clean "an indented continuation line or sub-bullet is not a second entry"

# Over-strictness guard: the section is a level-2 heading. A '### Amendments'
# inside a body -- an ADR discussing this very convention, for instance -- is
# not the section and must not be checked as one.
new_fixture
{
  printf '# ADR 0013\n\n## Decision\n\n### Amendments\n\nHow the section works.\n\n'
  printf '## Consequences\n\nIt is enforced.\n'
} > "${fixture_root}/docs/adr/0013-adr-amendments.md"
assert_clean "a level-3 Amendments heading in a body is not the section"

# Over-strictness guard: a FENCED EXAMPLE of the section is not the section.
# Without this the rule makes its own ADR unwritable -- 0013 has to show the
# shape it prescribes, and a heading at column one inside a fence would be read
# as the real thing, with '## Consequences' then "following" it.
new_fixture
{
  printf '# ADR 0013\n\n## Decision\n\nAppend a section shaped like this:\n\n'
  printf '%smarkdown\n## Amendments\n\n- **2026-09-05** — What became false (#147).\n%s\n\n' "${FENCE}" "${FENCE}"
  printf '## Consequences\n\nIt is enforced.\n'
} > "${fixture_root}/docs/adr/0013-adr-amendments.md"
assert_clean "a fenced example of ## Amendments is not the section"

# ...and the fence must not blind the checker to the real section further down.
# A rule that skipped everything after the first fence would pass this file,
# which carries a genuinely undated entry.
new_fixture
{
  printf '# ADR 0013\n\n## Decision\n\n'
  printf '%smarkdown\n## Amendments\n%s\n\n' "${FENCE}" "${FENCE}"
  printf '## Amendments\n\n- No date on this one.\n'
} > "${fixture_root}/docs/adr/0013-adr-amendments.md"
assert_violation_all "an undated entry is still caught after a fenced example" ADR003 \
  "line 11: amendment entry must open with a bold ISO date" \
  "- No date on this one."

# This checker runs on a bare clone of a FORK's tree in CI, so ADR content is
# untrusted input. The rule quotes the offending line back into a message and
# derives line numbers from it; both would be an execution vector if the text
# ever reached `eval`, a printf FORMAT, or bash arithmetic -- `$(( ))` evaluates
# a command substitution inside an array subscript. It reaches none of them:
# `report` uses `%s`, and the line numbers come from `grep -n`, which always
# prefixes digits. Asserted rather than reasoned about, because the reasoning is
# what goes stale when someone reformats a message.
new_fixture
canary="${fixture_root}/CANARY"
{
  printf '# ADR 0011\n\n## Amendments\n\n'
  printf -- '- %s(touch %s) not a date\n' "${DOLLAR}" "${canary}"
  printf -- '- x[0%s(touch %s)] also not a date\n' "${DOLLAR}" "${canary}"
} > "${fixture_root}/docs/adr/0011-stream-storage.md"
out="$(bash "${CHECKER}" "${fixture_root}" 2>&1)"
status=$?
if [ "${status}" -ne 0 ] \
   && [ ! -e "${canary}" ] \
   && printf '%s' "${out}" | grep -q '^ADR003: '; then
  pass=$((pass + 1))
  printf 'ok   a command substitution in an amendment entry is reported, not executed\n'
else
  fail=$((fail + 1))
  printf 'FAIL a command substitution in an amendment entry is reported, not executed\n     canary present: %s; exit %s\n%s\n' \
    "$(if [ -e "${canary}" ]; then printf yes; else printf no; fi)" "${status}" "${out}"
fi
cleanup_fixture

# The date's SHAPE is what is checked, not its validity. Recorded as a test so
# that "ADR003 validates dates" is never claimed on this rule's behalf.
new_fixture
{
  printf '# ADR 0011\n\n## Amendments\n\n'
  printf -- '- **2026-13-99** — a date that does not exist, and is accepted.\n'
} > "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_clean "an impossible-but-well-shaped date is accepted; the rule checks shape"

# --- ADR003 findings from the review of PR #150 ------------------------------
#
# All four were probed against the checker before they were fixed, and all four
# passed a rule that was supposed to reject them (or rejected one it was
# supposed to accept).

# "Nothing follows the section" means no heading at all, not no level-2 heading.
# A '# Appendix' after the amendments is the same defect as a '## Notes' and the
# rule matched only '^## '.
new_fixture
write_amended_adr "${fixture_root}/docs/adr/0011-stream-storage.md"
printf '\n# Appendix\n\nStill here.\n' >> "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_violation "a LEVEL-1 heading after ## Amendments is rejected too" ADR003 \
  "'# Appendix' follows it at line 13"

new_fixture
write_amended_adr "${fixture_root}/docs/adr/0011-stream-storage.md"
printf '\n### Postscript\n\nStill here.\n' >> "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_violation "a level-3 heading after ## Amendments is rejected too" ADR003 \
  "'### Postscript' follows it at line 13"

# Over-strictness guard for the same change: a SETEXT heading is deliberately
# not matched, because a row of hyphens at column one is also a horizontal rule
# and a table separator, and this repository writes no setext heading. Recorded
# so the limit is a decision rather than an oversight.
new_fixture
write_amended_adr "${fixture_root}/docs/adr/0011-stream-storage.md"
printf '\nNotes\n-----\n\nStill here.\n' >> "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_clean "a setext heading after ## Amendments is not matched, by decision"

# A tab after the bullet hyphen is a list item everywhere, and the entry match
# admitted it while the date filter required a literal space -- so a correctly
# dated entry was reported as undated. The two patterns are now one constant.
new_fixture
write_amended_adr "${fixture_root}/docs/adr/0011-stream-storage.md"
printf -- '-\t**2026-09-06** — tab after the hyphen, and dated.\n' \
  >> "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_clean "a tab after the bullet hyphen is not read as an undated entry"

# ...and the same whitespace must not become a way to smuggle an undated entry
# past the rule: the complement of the pattern above has to catch it.
new_fixture
write_amended_adr "${fixture_root}/docs/adr/0011-stream-storage.md"
printf -- '-\tno date, tab after the hyphen.\n' \
  >> "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_violation "a tab-bulleted entry with no date is still rejected" ADR003 \
  "line 12: amendment entry must open with a bold ISO date"

# D-4 makes the section an append-only log, and an append never puts an older
# date below a newer one. This is the only part of "it was an append" that is
# visible in the file rather than only in the diff, and it catches the natural
# mistake: reading the section as a newest-first changelog and PREPENDING.
new_fixture
write_amended_adr "${fixture_root}/docs/adr/0011-stream-storage.md"
printf -- '- **2026-09-04** — dated before the entry above it.\n' \
  >> "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_violation "an entry dated before the one above it is rejected" ADR003 \
  "line 12: amendment entry dated 2026-09-04 follows one dated 2026-09-05"

# Two entries on the SAME day are an append, not a reordering.
new_fixture
write_amended_adr "${fixture_root}/docs/adr/0011-stream-storage.md"
printf -- '- **2026-09-05** — the same day, appended after it.\n' \
  >> "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_clean "two entries dated the same day are accepted"

# An UNCLOSED fence blanks the rest of the file, which does not weaken ADR003 --
# it switches it off for that ADR. This fixture carries three separate
# violations below the fence (an undated entry, a second section, a section
# after it) and reported none of them before the fence count was checked.
new_fixture
{
  printf '# ADR 0011\n\n## Context\n\n'
  printf '%ssh\necho never closed\n\n' "${FENCE}"
  printf '## Amendments\n\n- no date at all\n\n## Notes\n\nand a section after it\n'
} > "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_violation "an unclosed code fence is reported, not silently obeyed" ADR003 \
  "unclosed code fence (1 fence lines, an odd number)"

# The date-order loop is a SECOND path through the entries, so the untrusted
# input case above does not cover it: that fixture's entries are undated and
# never reach here. This one is dated -- so it passes the date check, enters the
# ordering loop, and carries a command substitution in the text after the date.
new_fixture
canary="${fixture_root}/CANARY"
{
  printf '# ADR 0011\n\n## Amendments\n\n'
  printf -- '- **2026-09-09** — newest first %s(touch %s)\n' "${DOLLAR}" "${canary}"
  printf -- '- **2026-09-05** — x[0%s(touch %s)] older, so out of order\n' "${DOLLAR}" "${canary}"
} > "${fixture_root}/docs/adr/0011-stream-storage.md"
out="$(bash "${CHECKER}" "${fixture_root}" 2>&1)"
status=$?
if [ "${status}" -ne 0 ] \
   && [ ! -e "${canary}" ] \
   && printf '%s' "${out}" | grep -q 'dated 2026-09-05 follows one dated 2026-09-09'; then
  pass=$((pass + 1))
  printf 'ok   a command substitution in a DATED entry is reported, not executed\n'
else
  fail=$((fail + 1))
  printf 'FAIL a command substitution in a DATED entry is reported, not executed\n     canary present: %s; exit %s\n%s\n' \
    "$(if [ -e "${canary}" ]; then printf yes; else printf no; fi)" "${status}" "${out}"
fi
cleanup_fixture

# Over-strictness guard: a file with BALANCED fences is unaffected, including
# one with several of them.
new_fixture
{
  printf '# ADR 0011\n\n## Context\n\n'
  printf '%ssh\necho one\n%s\n\n' "${FENCE}" "${FENCE}"
  printf '%sts\nconst x = 1;\n%s\n\n' "${FENCE}" "${FENCE}"
  printf '## Amendments\n\n- **2026-09-05** — fine (#147).\n'
} > "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_clean "balanced fences are not reported, however many"

# --- SCOPE001 regressions found in review of PR #98 --------------------------
#
# All four cases below existed as surviving mutants or reproduced false
# positives before this block was written. Each names the specific way the
# checker was wrong, because a test whose name does not say what broke is a
# test nobody trusts when it goes red.

# Reproduced in review: `ant[+]` had no word boundary, so ordinary arithmetic
# matched -- in packages/physics, the one package guaranteed to contain it.
new_fixture
mkdir -p "${fixture_root}/packages/physics"
printf '# Apache\n' > "${fixture_root}/packages/physics/LICENSE"
printf '{"license":"Apache-2.0"}\n' > "${fixture_root}/packages/physics/package.json"
printf '// SPDX-License-Identifier: Apache-2.0\nconst q = quadrant+1;\nconst r = CONSTANT+2;\n' \
  > "${fixture_root}/packages/physics/gradient.ts"
assert_clean "arithmetic containing 'quadrant+1' is not an ANT+ violation"

# Reproduced in review: SCOPE001 scanned the whole tree, so documentation
# explaining the ANT+ exclusion failed the build -- contradicting the rule the
# checker exists to enforce.
new_fixture
mkdir -p "${fixture_root}/packages/sensors"
printf '# Apache\n' > "${fixture_root}/packages/sensors/LICENSE"
printf '{"license":"Apache-2.0"}\n' > "${fixture_root}/packages/sensors/package.json"
printf 'This package is Bluetooth only. ANT+ is excluded permanently; see ADR 0005.\n' \
  > "${fixture_root}/packages/sensors/README.md"
assert_clean "documentation may name ANT+ to explain the exclusion"

# The rule must still fire on real source.
new_fixture
mkdir -p "${fixture_root}/packages/sensors"
printf '# Apache\n' > "${fixture_root}/packages/sensors/LICENSE"
printf '{"license":"Apache-2.0"}\n' > "${fixture_root}/packages/sensors/package.json"
printf '// SPDX-License-Identifier: Apache-2.0\nimport { openAntPlus } from "ant-plus";\n' \
  > "${fixture_root}/packages/sensors/radio.ts"
assert_violation "ANT+ in package source is rejected" SCOPE001 \
  "packages/sensors/radio.ts"

# Surviving mutant: dropping `apps/` from the SCOPE001 loop left 15/15 green,
# so half the rule could be deleted without a test noticing.
new_fixture
mkdir -p "${fixture_root}/apps/web"
printf '// SPDX-License-Identifier: AGPL-3.0-or-later\nconst s = "thisisant.com";\n' \
  > "${fixture_root}/apps/web/pair.ts"
assert_violation "ANT+ under apps/ is rejected, not only under packages/" SCOPE001 \
  "apps/web/pair.ts"

# --- source_files() regressions found in review of PR #98 --------------------

# Surviving mutant: narrowing the extension list to '*.ts' alone left 15/15
# green, so nothing proved .tsx was scanned at all -- and .tsx is the dominant
# extension in a React apps/web, which is where the AGPL header rule matters most.
new_fixture
mkdir -p "${fixture_root}/apps/web"
printf 'export const App = () => null;\n' > "${fixture_root}/apps/web/App.tsx"
assert_violation ".tsx files are scanned for SPDX headers" LIC002 \
  "apps/web/App.tsx"

# Surviving mutant: `head -n 5` -> `head -n 1` left 15/15 green. The five-line
# window is deliberate -- a shebang and a generated-file banner both legitimately
# precede the identifier.
new_fixture
mkdir -p "${fixture_root}/apps/web"
printf '#!/usr/bin/env node\n// generated -- do not edit\n//\n// SPDX-License-Identifier: AGPL-3.0-or-later\n' \
  > "${fixture_root}/apps/web/tool.js"
assert_clean "an SPDX header on line 4 is accepted, not only line 1"

# Surviving mutant: deleting the node_modules/dist/build/coverage prune left
# 15/15 green, so vendored code could fail the build for lacking our header.
new_fixture
mkdir -p "${fixture_root}/packages/domain/node_modules/dep" "${fixture_root}/packages/domain/dist"
printf '# Apache\n' > "${fixture_root}/packages/domain/LICENSE"
printf '{"license":"Apache-2.0"}\n' > "${fixture_root}/packages/domain/package.json"
printf 'module.exports = {};\n' > "${fixture_root}/packages/domain/node_modules/dep/index.js"
printf 'export const x = 1;\n' > "${fixture_root}/packages/domain/dist/index.js"
assert_clean "node_modules and dist are pruned, not scanned for headers"

# --- WF001: pull_request_target is banned in .github/workflows/ --------------
#
# CLAUDE.md section 8: "pull_request_target is banned. It receives secrets and is
# not subject to the first-time contributor approval gate." A ban stated in prose
# is not a gate -- this repository is public and anyone may propose a workflow
# change -- so the ban is checked by a machine.

write_workflow() {
  local name="$1" body="$2"
  mkdir -p "${fixture_root}/.github/workflows"
  printf '%s' "${body}" > "${fixture_root}/.github/workflows/${name}"
}

new_fixture
write_workflow rules.yml 'on:
  pull_request_target:
jobs:
  x:
    runs-on: ubuntu-latest
'
assert_violation "pull_request_target in a workflow is rejected" WF001 \
  ".github/workflows/rules.yml"

# A workflow triggered by the safe `pull_request` event must not match. Without
# this case a checker grepping for the shorter prefix would ban every workflow
# in the repository and look correct doing it.
new_fixture
write_workflow rules.yml 'on:
  pull_request:
  push:
    branches: [main]
jobs:
  x:
    runs-on: ubuntu-latest
'
assert_clean "a workflow using only pull_request passes"

# Surviving-mutant guard, the same shape as the `.tsx` case above: narrowing the
# scan to '*.yml' leaves every other case green, and GitHub honours '*.yaml'
# identically -- so half the rule could be deleted unnoticed.
new_fixture
write_workflow rules.yaml 'on: [pull_request_target]
'
assert_violation ".yaml workflows are scanned too, not only .yml" WF001 \
  ".github/workflows/rules.yaml"

# The mirror of the SCOPE001 documentation case, and the reason the rule is
# scoped to .github/workflows/ rather than to the whole tree: CLAUDE.md and
# CONTRIBUTING.md both name pull_request_target in order to ban it. A checker
# that fails on the file stating the rule contradicts the rule it enforces.
new_fixture
mkdir -p "${fixture_root}/docs"
printf 'pull_request_target is banned; see CLAUDE.md section 8.\n' \
  > "${fixture_root}/docs/ci.md"
write_workflow rules.yml 'on:
  pull_request:
'
assert_clean "documentation may name pull_request_target to ban it"

# The directory scope needs its own case. The one above is killed by widening
# the scan to the whole tree, but not by widening it to every .yml in .github/ --
# and issue-form templates and dependabot.yml both live there and are not
# workflows. Without this case the scope could be loosened to `.github/` and
# every test would stay green.
new_fixture
mkdir -p "${fixture_root}/.github/ISSUE_TEMPLATE"
printf 'name: Bug\nbody:\n  - type: input\n    id: pull_request_target\n' \
  > "${fixture_root}/.github/ISSUE_TEMPLATE/bug.yml"
write_workflow rules.yml 'on:
  pull_request:
'
assert_clean "a .yml under .github/ that is not a workflow is not scanned"

# --- The real repository must pass -------------------------------------------

REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
out="$(bash "${CHECKER}" "${REPO_ROOT}" 2>&1)"
status=$?
if [ "${status}" -eq 0 ]; then
  pass=$((pass + 1))
  printf 'ok   this repository passes its own rules\n'
else
  fail=$((fail + 1))
  printf 'FAIL this repository passes its own rules\n     exit %s\n%s\n' "${status}" "${out}"
fi

printf '\n%s passed, %s failed\n' "${pass}" "${fail}"
[ "${fail}" -eq 0 ]
