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
  # ASSET005 requires the asset manifest to be PRESENT, the way
  # check-env-example.sh requires `.env.example` to be: a record that is not
  # there documents nothing, and ASSET001-ASSET004 would all pass vacuously
  # over an absent file. Every fixture therefore starts with one, carrying no
  # entries because a fixture has no binaries until a case writes one. The
  # case that deletes it again is below, under ASSET005.
  printf '# Committed binary assets. See scripts/check-repo-rules.sh ASSET001.\n' \
    > "${fixture_root}/ASSETS.toml"
  # SPIKE003 requires docs/spikes/ to be there AND to hold a write-up, for the
  # reason ASSET005 requires the asset manifest to be present: SPIKE001 and
  # SPIKE002 walk that directory, and a walk over a path that is not there
  # reports clean for ever. So every fixture starts with one valid spike, and
  # the cases that delete it again are below under SPIKE003.
  #
  # ⚠️ The name matters. The ADR004 case "a spike write-up is not held to the
  # ADR sections" writes docs/spikes/0001-segment-matching.md itself; giving
  # this one any OTHER number would make that case a SPIKE001 collision, and
  # giving it any other slug at 0001 would too. It writes the same path, so it
  # overwrites this file rather than joining it.
  mkdir -p "${fixture_root}/docs/spikes"
  printf '# Spike 0001\n\nA dated measurement.\n' \
    > "${fixture_root}/docs/spikes/0001-segment-matching.md"
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

# assert_violations <name> <rule> <needle> [<rule> <needle>]...
#
# assert_violation with more than one (rule, needle) pair, each of which must be
# satisfied by SOME reported line -- and deliberately NOT by the same one. It is
# the complement of `assert_violation_all`, which requires one line to carry
# every needle; here every pair must find its own.
#
# #229 is what needs it, and needs exactly this shape. The defect was that an
# unclosed `<![CDATA[` switched XML001/XML002 off for the rest of the file, so a
# real violation after it was never reported. A fixture asserting only "the
# unclosed CDATA is reported" would pass against a checker that still went blind
# straight afterwards -- which is the fix that looks like a fix and is not. The
# case that pins it is one file reporting TWO findings, on two lines, under two
# rule ids, and no existing helper could ask for that.
assert_violations() {
  local name="$1" out status rule needle missing=""
  shift
  out="$(bash "${CHECKER}" "${fixture_root}" 2>&1)"
  status=$?
  while [ "$#" -ge 2 ]; do
    rule="$1"
    needle="$2"
    shift 2
    printf '%s\n' "${out}" | grep "^${rule}: " | grep -qF -- "${needle}" \
      || missing="${missing} ${rule}/\"${needle}\""
  done
  if [ "${status}" -ne 0 ] && [ -z "${missing}" ]; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "${name}"
  else
    fail=$((fail + 1))
    printf 'FAIL %s\n     nothing reported for%s; got exit %s\n%s\n' \
      "${name}" "${missing:- (none missing)}" "${status}" "${out}"
  fi
  cleanup_fixture
}

# assert_violation_and_silence <name> <rule> <needle> <silent-rule>
#
# assert_violation, plus the requirement that a SECOND rule reported nothing at
# all.
#
# #339 needs it and no existing helper can ask for it. When `ASSETS.toml` does
# not parse, the entry list this checker built from it is partial -- so walking
# the tree against that list would report every asset whose entry sat after the
# bad line as one the manifest does not name. Each of those lines is a FALSE
# statement, and the one real finding arrives buried under consequences of
# itself. The checker therefore reports the parse error and stops, and
# "ASSET005 fires" on its own passes equally well against a checker that emits
# the avalanche as well. This is what asks for the absence.
assert_violation_and_silence() {
  local name="$1" rule="$2" needle="$3" silent="$4" out status
  out="$(bash "${CHECKER}" "${fixture_root}" 2>&1)"
  status=$?
  if [ "${status}" -ne 0 ] \
     && printf '%s' "${out}" | grep "^${rule}: " | grep -qF -- "${needle}" \
     && ! printf '%s' "${out}" | grep -q "^${silent}: "; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "${name}"
  else
    fail=$((fail + 1))
    printf 'FAIL %s\n     expected exit != 0, a "%s: " line containing "%s", and no "%s: " line at all; got exit %s\n%s\n' \
      "${name}" "${rule}" "${needle}" "${silent}" "${status}" "${out}"
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
# The four sections CLAUDE.md section 7 requires, which ADR004 checks for
# (#416). Fourteen lines, ending in a blank one.
#
# Every fixture below that has to pass carries them, because ADR004 reads every
# file under docs/adr/ and a fixture written for ADR001 or ADR003 is not exempt
# from the rest of the checker -- the same reason `new_fixture` writes an
# ASSETS.toml. One helper rather than a dozen copies, so that a change to the
# required set is one edit here; and the LINE COUNT is fixed, which is what the
# ADR003 cases below quote line numbers against.
adr_sections() {
  printf -- '- **Status**: Accepted\n\n## Context\n\nSomething was true.\n\n'
  printf '## Decision\n\nDo the thing.\n\n## Consequences\n\nThe thing is done.\n\n'
}

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
{
  printf '# ADR 0003: Platform support\n\n'
  adr_sections
  printf 'ANT+ is out of scope permanently; see ADR 0005.\n'
} > "${fixture_root}/docs/adr/0003-platform-support.md"
assert_clean "ANT+ named in docs/ to explain its exclusion is allowed"

# ⚠️ **A dependency, which is the word #15's fifth criterion uses and the one
# the rule did not cover.** `source_files` returns no `.json`, so this passed a
# checker written to forbid exactly it. The other three words in that criterion
# -- code, permission, string -- were already covered; this is the fourth.
new_fixture
mkdir -p "${fixture_root}/apps/mobile"
printf 'AGPL\n' > "${fixture_root}/apps/mobile/LICENSE"
printf '{"license":"AGPL-3.0-or-later","dependencies":{"ant-plus":"^1.0.0"}}\n' \
  > "${fixture_root}/apps/mobile/package.json"
assert_violation "an ANT+ dependency in a package manifest is rejected" SCOPE001 \
  "apps/mobile/package.json"

# The same anchoring the source loop needs: a manifest may legitimately depend
# on something whose name merely ends in those letters.
new_fixture
mkdir -p "${fixture_root}/packages/physics"
printf 'Apache\n' > "${fixture_root}/packages/physics/LICENSE"
printf '{"license":"Apache-2.0","dependencies":{"quadrant-solver":"^2.0.0"}}\n' \
  > "${fixture_root}/packages/physics/package.json"
assert_clean "a dependency whose name merely contains 'ant' is not a violation"

# --- ADR001: ADR numbers are unique ------------------------------------------

new_fixture
printf '# ADR 0005\n' > "${fixture_root}/docs/adr/0005-tech-stack.md"
printf '# ADR 0005\n' > "${fixture_root}/docs/adr/0005-local-first-architecture.md"
assert_violation "two ADRs sharing a number are rejected" ADR001 \
  "share ADR number 0005"

new_fixture
{ printf '# ADR 0005\n\n'; adr_sections; } > "${fixture_root}/docs/adr/0005-tech-stack.md"
{ printf '# ADR 0006\n\n'; adr_sections; } \
  > "${fixture_root}/docs/adr/0006-fit-codec-licensing.md"
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

# `assert_violations` (#229) gets the same pair of guards, because the whole
# reason it exists is to prove a checker reported TWO things -- and a helper
# that passes whatever it is handed would prove neither. One collision only, so
# the second pair names a rule id nothing reported: a helper that answered
# "something failed, near enough" would accept it.
new_fixture
printf '# ADR 0002\n' > "${fixture_root}/docs/adr/0002-alpha.md"
printf '# ADR 0002\n' > "${fixture_root}/docs/adr/0002-beta.md"
assert_helper_fails "assert_violations rejects a pair that nothing reported" \
  assert_violations "(expected to fail) one pair unreported" \
  ADR001 "docs/adr/0002-alpha.md" \
  LIC001 "docs/adr/0002-alpha.md"
cleanup_fixture

new_fixture
printf '# ADR 0002\n' > "${fixture_root}/docs/adr/0002-alpha.md"
printf '# ADR 0002\n' > "${fixture_root}/docs/adr/0002-beta.md"
printf '# ADR 0003\n' > "${fixture_root}/docs/adr/0003-delta.md"
printf '# ADR 0003\n' > "${fixture_root}/docs/adr/0003-gamma.md"
assert_helper_passes "assert_violations accepts two pairs satisfied by two different lines" \
  assert_violations "(expected to pass) two pairs, two lines" \
  ADR001 "docs/adr/0002-beta.md" \
  ADR001 "docs/adr/0003-gamma.md"
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
#
# Lines: the title is 1, `adr_sections` runs 3-16, '## Amendments' is 17 and
# the first entry is 19. The ADR003 cases below quote those numbers.
write_amended_adr() {
  local path="$1"
  {
    printf '# ADR 0011: Stream storage\n\n'
    adr_sections
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
  "docs/adr/0011-stream-storage.md: '## Amendments' (line 17) must be the last section"

# The offending heading is named, for the same reason ADR001 names both
# colliding files: a message that says only "something follows it" sends the
# reader back to scroll a 300-line ADR looking for what.
new_fixture
write_amended_adr "${fixture_root}/docs/adr/0011-stream-storage.md"
printf '\n## Notes\n\nStill here.\n' >> "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_violation "the section that follows ## Amendments is named, with its line" ADR003 \
  "'## Notes' follows it at line 21"

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
  "line 20: amendment entry must open with a bold ISO date" \
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
{ printf '# ADR 0011\n\n'; adr_sections; printf '## Amendments\n'; } \
  > "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_violation "an empty ## Amendments section is rejected" ADR003 \
  "docs/adr/0011-stream-storage.md: '## Amendments' (line 17) has no entries"

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
  printf '# ADR 0013\n\n- **Status**: Accepted\n\n## Context\n\nA convention.\n\n'
  printf '## Decision\n\n### Amendments\n\nHow the section works.\n\n'
  printf '## Consequences\n\nIt is enforced.\n'
} > "${fixture_root}/docs/adr/0013-adr-amendments.md"
assert_clean "a level-3 Amendments heading in a body is not the section"

# Over-strictness guard: a FENCED EXAMPLE of the section is not the section.
# Without this the rule makes its own ADR unwritable -- 0013 has to show the
# shape it prescribes, and a heading at column one inside a fence would be read
# as the real thing, with '## Consequences' then "following" it.
new_fixture
{
  printf '# ADR 0013\n\n- **Status**: Accepted\n\n## Context\n\nA convention.\n\n'
  printf '## Decision\n\nAppend a section shaped like this:\n\n'
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
  printf '# ADR 0011\n\n'
  adr_sections
  printf '## Amendments\n\n'
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
  "'# Appendix' follows it at line 21"

new_fixture
write_amended_adr "${fixture_root}/docs/adr/0011-stream-storage.md"
printf '\n### Postscript\n\nStill here.\n' >> "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_violation "a level-3 heading after ## Amendments is rejected too" ADR003 \
  "'### Postscript' follows it at line 21"

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
  "line 20: amendment entry must open with a bold ISO date"

# D-4 makes the section an append-only log, and an append never puts an older
# date below a newer one. This is the only part of "it was an append" that is
# visible in the file rather than only in the diff, and it catches the natural
# mistake: reading the section as a newest-first changelog and PREPENDING.
new_fixture
write_amended_adr "${fixture_root}/docs/adr/0011-stream-storage.md"
printf -- '- **2026-09-04** — dated before the entry above it.\n' \
  >> "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_violation "an entry dated before the one above it is rejected" ADR003 \
  "line 20: amendment entry dated 2026-09-04 follows one dated 2026-09-05"

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
  printf '# ADR 0011\n\n'
  adr_sections
  printf '%ssh\necho one\n%s\n\n' "${FENCE}" "${FENCE}"
  printf '%sts\nconst x = 1;\n%s\n\n' "${FENCE}" "${FENCE}"
  printf '## Amendments\n\n- **2026-09-05** — fine (#147).\n'
} > "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_clean "balanced fences are not reported, however many"

# --- ADR004: the four sections CLAUDE.md section 7 requires (#416) -----------
#
# The rule exists because that sentence was enforced by nothing: deleting
# `- **Status**: Accepted` from a real ADR left the checker reporting clean at
# exit 0 on 2026-09-20. One fixture per missing section, each going red, is
# #416's second acceptance criterion -- and the two guards after them are the
# other half, because a rule that accepted any line containing the word would
# pass every ADR in the tree without reading one of them.

# The shape every ADR in the tree has, which must pass. `adr_sections` writes
# it, so this case is also what says that helper is not itself the reason the
# eleven fixtures above went green.
new_fixture
{ printf '# ADR 0011: Stream storage\n\n'; adr_sections; } \
  > "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_clean "an ADR carrying all four required sections passes"

# The defect as it was measured: Context, Decision and Consequences all there,
# and no Status at all.
new_fixture
{
  printf '# ADR 0011: Stream storage\n\n## Context\n\nSomething.\n\n'
  printf '## Decision\n\nDo it.\n\n## Consequences\n\nDone.\n'
} > "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_violation_all "an ADR with no Status is rejected" ADR004 \
  "docs/adr/0011-stream-storage.md" "no 'Status' section"

new_fixture
{
  printf '# ADR 0011: Stream storage\n\n- **Status**: Accepted\n\n'
  printf '## Decision\n\nDo it.\n\n## Consequences\n\nDone.\n'
} > "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_violation_all "an ADR with no Context is rejected" ADR004 \
  "docs/adr/0011-stream-storage.md" "no 'Context' section"

new_fixture
{
  printf '# ADR 0011: Stream storage\n\n- **Status**: Accepted\n\n'
  printf '## Context\n\nSomething.\n\n## Consequences\n\nDone.\n'
} > "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_violation_all "an ADR with no Decision is rejected" ADR004 \
  "docs/adr/0011-stream-storage.md" "no 'Decision' section"

new_fixture
{
  printf '# ADR 0011: Stream storage\n\n- **Status**: Accepted\n\n'
  printf '## Context\n\nSomething.\n\n## Decision\n\nDo it.\n'
} > "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_violation_all "an ADR with no Consequences is rejected" ADR004 \
  "docs/adr/0011-stream-storage.md" "no 'Consequences' section"

# ⚠️ The guard that makes the four above mean something. A rule matching any
# line that CONTAINS the word would pass this file, which names all four in
# prose and has none of them as a section. Every ADR in the tree discusses its
# own consequences in a sentence, so this is the shape the rule would otherwise
# be permanently green against.
new_fixture
{
  printf '# ADR 0011: Stream storage\n\n'
  printf 'The status of this is settled. In this context the decision was taken,\n'
  printf 'and the consequences are recorded below.\n'
} > "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_violation_all "the four words in prose are not the four sections" ADR004 \
  "docs/adr/0011-stream-storage.md" "no 'Decision' section"

# Over-strictness guard: Status is METADATA and has a second accepted spelling.
# `## Status` is the form ADR practice outside this repository uses, and a rule
# that rejected it would reject a valid document -- #416's fourth criterion.
new_fixture
{
  printf '# ADR 0011: Stream storage\n\n## Status\n\nAccepted\n\n'
  printf '## Context\n\nSomething.\n\n## Decision\n\nDo it.\n\n## Consequences\n\nDone.\n'
} > "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_clean "Status as a level-2 heading is accepted"

# ...and without the list bullet, which is the other way the label is written.
new_fixture
{
  printf '# ADR 0011: Stream storage\n\n**Status**: Accepted\n\n'
  printf '## Context\n\nSomething.\n\n## Decision\n\nDo it.\n\n## Consequences\n\nDone.\n'
} > "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_clean "a bold Status label with no bullet is accepted"

# Over-strictness guard: a heading may say more than the word. ADR 0007 already
# writes 'Accepted -- on the strength of D4' after its Status label, and a
# heading qualified the same way is a valid document.
new_fixture
{
  printf '# ADR 0011: Stream storage\n\n- **Status**: Accepted\n\n'
  printf '## Context\n\nSomething.\n\n## Decision: what was chosen\n\nDo it.\n\n'
  printf '## Consequences for everything else\n\nDone.\n'
} > "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_clean "a required heading may carry trailing words"

# ...and the matcher is a WHOLE word, which is what stops the line above
# widening into "any heading starting with those letters".
new_fixture
{
  printf '# ADR 0011: Stream storage\n\n- **Status**: Accepted\n\n'
  printf '## Context\n\nSomething.\n\n## Decisions\n\nDo it.\n\n## Consequences\n\nDone.\n'
} > "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_violation_all "'## Decisions' is not the '## Decision' section" ADR004 \
  "docs/adr/0011-stream-storage.md" "no 'Decision' section"

# A FENCED heading is an example, not a section -- ADR003's rule, which this one
# inherits by sharing `strip_fences`. An ADR documenting this convention has to
# be able to show the shape it prescribes.
new_fixture
{
  printf '# ADR 0011: Stream storage\n\n- **Status**: Accepted\n\n'
  printf '## Context\n\nSomething.\n\n## Decision\n\nAn ADR looks like this:\n\n'
  printf '%smarkdown\n## Consequences\n\nWhat follows.\n%s\n' "${FENCE}" "${FENCE}"
} > "${fixture_root}/docs/adr/0011-stream-storage.md"
assert_violation_all "a fenced ## Consequences is an example, not the section" ADR004 \
  "docs/adr/0011-stream-storage.md" "no 'Consequences' section"

# ⚠️ An UNCLOSED fence blanks everything after it, so every section below one
# would read as absent. ADR003 already reports the fence and the build is red;
# a second ADR004 finding would blame the sections instead, and send the author
# to add headings that are already there. This asserts BOTH halves: the build
# goes red, and no ADR004 line is printed.
new_fixture
{
  printf '# ADR 0011: Stream storage\n\n'
  printf '%ssh\necho never closed\n\n' "${FENCE}"
  printf -- '- **Status**: Accepted\n\n## Context\n\nSomething.\n\n'
  printf '## Decision\n\nDo it.\n\n## Consequences\n\nDone.\n'
} > "${fixture_root}/docs/adr/0011-stream-storage.md"
out="$(bash "${CHECKER}" "${fixture_root}" 2>&1)"
status=$?
if [ "${status}" -ne 0 ] \
   && printf '%s' "${out}" | grep -q '^ADR003: ' \
   && ! printf '%s' "${out}" | grep -q '^ADR004: '; then
  pass=$((pass + 1))
  printf 'ok   an unclosed fence is ADR003 alone, not a misleading ADR004\n'
else
  fail=$((fail + 1))
  printf 'FAIL an unclosed fence is ADR003 alone, not a misleading ADR004\n     exit %s\n%s\n' \
    "${status}" "${out}"
fi
cleanup_fixture

# ⚠️ A LONG ADR, which is the case a red CI run produced and this suite could
# not have found on the machine it was written on.
#
# The first version of ADR004 asked `printf '%s\n' "${body}" | grep -q ...`.
# `grep -q` exits at the first match and closes the pipe; a document bigger than
# the pipe buffer then gives the producer EPIPE, and this script runs under
# `set -o pipefail`, so the whole pipeline reports a failure for a document that
# MATCHED. On the Ubuntu runner that printed `printf: write error: Broken pipe`
# and reported six real ADRs as having no Status. On macOS, where `printf` is a
# builtin that does not fail the same way, every case here stayed green --
# including "this repository passes its own rules", over the very ADRs that
# failed in CI.
#
# So this fixture is deliberately larger than a 64 KiB pipe buffer, and it is
# honest about what it can do: on Linux it is what turns that mistake red, and
# on macOS it passes either way. The checker uses a here-string now.
new_fixture
{
  printf '# ADR 0002: A long one\n\n- **Status**: Accepted\n\n## Context\n\n'
  index=0
  while [ "${index}" -lt 3000 ]; do
    printf 'Padding line %s, which exists only to make this document big.\n' "${index}"
    index=$((index + 1))
  done
  printf '\n## Decision\n\nDo the thing.\n\n## Consequences\n\nThe thing is done.\n'
} > "${fixture_root}/docs/adr/0002-a-long-one.md"
assert_clean "an ADR larger than a pipe buffer passes"

# The rule is scoped to docs/adr/. A spike decides nothing and CLAUDE.md
# section 7 says so, so it has no sections to be missing.
new_fixture
mkdir -p "${fixture_root}/docs/spikes"
printf '# Spike 0001\n\nA dated measurement.\n' \
  > "${fixture_root}/docs/spikes/0001-segment-matching.md"
assert_clean "a spike write-up is not held to the ADR sections"

# --- SPIKE001 / SPIKE002 / SPIKE003: spike numbering and naming (#493) --------
#
# ADR001 and ADR002 walk docs/adr/ alone, so two spike write-ups at one number
# merged clean and green. It happened twice, both live on 2026-09-22 (0005 and
# 0006), and both were caught by a person reading two diffs rather than by a
# gate.
#
# The FIRST case below is the one that decides whether this rule is worth
# anything. A uniqueness check written against FILENAMES rather than against the
# NNNN prefix passes it -- the two files are differently named, which is exactly
# why git merged them without a conflict. It is the shape that shipped.

new_fixture
printf '# Spike 0005\n' \
  > "${fixture_root}/docs/spikes/0005-live-racing-patent-read.md"
printf '# Spike 0005\n' \
  > "${fixture_root}/docs/spikes/0005-realism-on-the-device-floor.md"
assert_violation "two differently-named spikes at one number are rejected" SPIKE001 \
  "share spike number 0005"

# Both paths on ONE line, for ADR001's own #118 reason: this loop walks
# `find | sort`, so the file it reaches second is whichever slug sorts later,
# which carries no information at all about which one is new. A message naming
# one file would be wrong about half the time -- and its wrong half would name
# the MERGED spike, which CLAUDE.md section 7 forbids renumbering outright.
# Twice, so that neither sort order is the one that happens to pass.

new_fixture
printf '# Spike 0006\n' \
  > "${fixture_root}/docs/spikes/0006-camera-bike-fit-patent-read.md"
printf '# Spike 0006\n' \
  > "${fixture_root}/docs/spikes/0006-race-room-under-workerd.md"
assert_violation_all "a spike collision names BOTH paths when the new file sorts first" SPIKE001 \
  "docs/spikes/0006-camera-bike-fit-patent-read.md" \
  "docs/spikes/0006-race-room-under-workerd.md"

new_fixture
printf '# Spike 0006\n' \
  > "${fixture_root}/docs/spikes/0006-race-room-under-workerd.md"
printf '# Spike 0006\n' \
  > "${fixture_root}/docs/spikes/0006-camera-bike-fit-patent-read.md"
assert_violation_all "a spike collision names BOTH paths when the new file sorts second" SPIKE001 \
  "docs/spikes/0006-camera-bike-fit-patent-read.md" \
  "docs/spikes/0006-race-room-under-workerd.md"

# The remedy sentence is the whole reason SPIKE001 is a new id rather than a
# widening of ADR001. ADR001 tells the reader to renumber the unmerged file;
# that instruction is WRONG for a spike, which is never renumbered. If this
# assertion ever fails because the message was harmonised with ADR001's, the
# harmonisation is the defect.
new_fixture
printf '# Spike 0007\n' > "${fixture_root}/docs/spikes/0007-alpha.md"
printf '# Spike 0007\n' > "${fixture_root}/docs/spikes/0007-beta.md"
assert_violation "a spike collision says take the next free number, never renumber" SPIKE001 \
  "must take the next free number"

new_fixture
printf '# Spike 0002\n' > "${fixture_root}/docs/spikes/0002-background-recording.md"
printf '# Spike 0003\n' > "${fixture_root}/docs/spikes/0003-segment-prefilter-margin.md"
assert_clean "distinct spike numbers pass"

# The two directories are numbered independently and must not contaminate each
# other. docs/adr/0001-licence.md and docs/spikes/0001-segment-matching.md are
# both real files in this repository, today.
new_fixture
{ printf '# ADR 0002\n\n'; adr_sections; } > "${fixture_root}/docs/adr/0002-local-first.md"
printf '# Spike 0002\n' > "${fixture_root}/docs/spikes/0002-background-recording.md"
assert_clean "an ADR and a spike may share a number"

# --- SPIKE002: spike filenames follow NNNN-kebab-case.md ----------------------

new_fixture
printf '# Spike\n' > "${fixture_root}/docs/spikes/segment-matching.md"
assert_violation "a spike filename without a number is rejected" SPIKE002 \
  "docs/spikes/segment-matching.md"

new_fixture
printf '# Spike\n' > "${fixture_root}/docs/spikes/0005-Live_Racing.md"
assert_violation "a spike filename that is not kebab-case is rejected" SPIKE002 \
  "docs/spikes/0005-Live_Racing.md"

# SPIKE002 runs first and `continue`s, which is what makes the collision test's
# string packing safe -- nothing reaching it can contain a space or a colon. A
# malformed name at a number that is ALSO taken is therefore reported as
# SPIKE002 and does not also become half of a SPIKE001 pair.
new_fixture
printf '# Spike\n' > "${fixture_root}/docs/spikes/0001-Segment Matching.md"
assert_violation "a malformed spike name at a taken number is SPIKE002" SPIKE002 \
  "docs/spikes/0001-Segment Matching.md"

# --- SPIKE003: the two rules above cannot walk nothing and report clean -------
#
# LIC006's reason, applied to a directory instead of to a list. SPIKE001 and
# SPIKE002 name a path; a path that is not there is a rule that can never fire,
# and every run stays green while nothing is checked. That is #142's shape --
# a selector failing closed against deletion and OPEN against renaming -- and
# check-wiring.mjs's WATCHED_PREFIXES takes the same position.
#
# ⚠️ Measured on 2026-09-23 rather than asserted: removing SPIKE003's two
# `report` calls from the checker turns exactly the two cases below red and
# nothing else in the 206-case suite. Without them, `mv docs/spikes
# docs/measurements` would be a silent, permanent switch-off of SPIKE001 and
# SPIKE002 with every run still green.

new_fixture
rm -f "${fixture_root}/docs/spikes/0001-segment-matching.md"
assert_violation "an empty docs/spikes is a violation, not a clean run" SPIKE003 \
  "no write-up found"

new_fixture
rm -rf "${fixture_root}/docs/spikes"
assert_violation "a missing docs/spikes is a violation, not a clean run" SPIKE003 \
  "the directory is not there"

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

# --- LIC001/LIC002 reach Kotlin, Java, Gradle and Android XML (#87) ----------
#
# `apps/mobile` is the first tree in this repository that is not TypeScript, and
# until #87 the header rules could not see a single file in it. Each extension
# gets its own case: a glob is one token and losing one token is silent.

new_fixture
write_good_app mobile
printf 'class Probe\n' > "${fixture_root}/apps/mobile/Probe.kt"
assert_violation "a .kt file without a header is rejected" LIC002 \
  "apps/mobile/Probe.kt: no SPDX-License-Identifier"

new_fixture
write_good_app mobile
printf '// SPDX-License-Identifier: Apache-2.0\nclass Probe\n' \
  > "${fixture_root}/apps/mobile/Probe.kt"
assert_violation "a .kt file carrying the WRONG identifier is rejected" LIC002 \
  "apps/mobile/Probe.kt: SPDX header is Apache-2.0"

new_fixture
write_good_package sensors
printf 'class Probe {}\n' > "${fixture_root}/packages/sensors/Probe.java"
assert_violation "a .java file under packages/ without a header is rejected" LIC001 \
  "packages/sensors/Probe.java: no SPDX-License-Identifier"

new_fixture
write_good_app mobile
printf 'apply plugin: "com.android.application"\n' \
  > "${fixture_root}/apps/mobile/probe.gradle"
assert_violation "a .gradle file without a header is rejected" LIC002 \
  "apps/mobile/probe.gradle: no SPDX-License-Identifier"

new_fixture
write_good_app mobile
mkdir -p "${fixture_root}/apps/mobile/res"
printf '<?xml version="1.0" encoding="utf-8"?>\n<manifest />\n' \
  > "${fixture_root}/apps/mobile/res/probe.xml"
assert_violation "an .xml file without a header is rejected" LIC002 \
  "apps/mobile/res/probe.xml: no SPDX-License-Identifier"

# The shape the Android files actually take: an XML declaration MUST be the
# first thing in the document, so the header can only be on line 2. `spdx_of`
# reads five lines, and this is the case that says so on purpose rather than by
# luck -- a checker narrowed to line 1 would reject every conforming manifest in
# `apps/mobile`.
new_fixture
write_good_app mobile
mkdir -p "${fixture_root}/apps/mobile/res"
printf '<?xml version="1.0" encoding="utf-8"?>\n<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->\n<manifest />\n' \
  > "${fixture_root}/apps/mobile/res/probe.xml"
assert_clean "an .xml header on line 2, after the XML declaration, is accepted"

# --- LIC001/LIC002 reach Python (#430, ADR 0026 D-5) -------------------------
#
# The asset pipeline's Blender scripts are the first Python in the tree, and
# ADR 0026 D-5 says outright that LIC001/LIC002 did not scan `.py`: a script
# under `apps/` with no header, or with a header claiming Blender's GPL, would
# have passed. One case per direction, and the comment form a Python file uses.

new_fixture
write_good_app web
mkdir -p "${fixture_root}/apps/web/tools"
printf 'import bpy\n' > "${fixture_root}/apps/web/tools/process.py"
assert_violation "a .py file without a header is rejected" LIC002 \
  "apps/web/tools/process.py: no SPDX-License-Identifier"

new_fixture
write_good_app web
mkdir -p "${fixture_root}/apps/web/tools"
printf '# SPDX-License-Identifier: GPL-3.0-or-later\nimport bpy\n' \
  > "${fixture_root}/apps/web/tools/process.py"
assert_violation "a .py file under apps/ carrying the WRONG identifier is rejected" LIC002 \
  "apps/web/tools/process.py: SPDX header is GPL-3.0-or-later"

new_fixture
write_good_package fit
printf 'print(1)\n' > "${fixture_root}/packages/fit/probe.py"
assert_violation "a .py file under packages/ without a header is rejected" LIC001 \
  "packages/fit/probe.py: no SPDX-License-Identifier"

# The shape the pipeline's scripts actually take: a shebang, then the header.
new_fixture
write_good_app web
mkdir -p "${fixture_root}/apps/web/tools"
printf '#!/usr/bin/env python3\n# SPDX-License-Identifier: AGPL-3.0-or-later\nimport bpy\n' \
  > "${fixture_root}/apps/web/tools/process.py"
assert_clean "a .py header after a shebang is accepted"

# --- LIC006: .spdx-exempt, and the ways it must not become a blanket ---------

new_fixture
write_good_app mobile
printf '<?xml version="1.0"?>\n<vector />\n' > "${fixture_root}/apps/mobile/icon.xml"
printf 'apps/mobile/icon.xml\n' > "${fixture_root}/.spdx-exempt"
assert_clean "a file named in .spdx-exempt is not required to carry a header"

# The case that says the list is an EXACT path match rather than a prefix or a
# directory. Two generated-looking files side by side, one exempt: the other
# must still fail. Without this, an entry naming a directory's first file would
# quietly cover everything beside it.
new_fixture
write_good_app mobile
printf '<?xml version="1.0"?>\n<vector />\n' > "${fixture_root}/apps/mobile/icon.xml"
printf '<?xml version="1.0"?>\n<vector />\n' > "${fixture_root}/apps/mobile/icon2.xml"
printf 'apps/mobile/icon.xml\n' > "${fixture_root}/.spdx-exempt"
assert_violation "an exemption covers only the path it names" LIC002 \
  "apps/mobile/icon2.xml: no SPDX-License-Identifier"

new_fixture
write_good_app mobile
printf 'apps/mobile/gone.xml\n' > "${fixture_root}/.spdx-exempt"
assert_violation "an exemption naming a file that is not there is rejected" LIC006 \
  "apps/mobile/gone.xml: no such file"

# A glob would defeat the whole mechanism in one line, so it is refused rather
# than merely unsupported -- an unsupported glob matches nothing, which reads in
# CI as a stale entry and in review as a working exemption.
new_fixture
write_good_app mobile
printf '<?xml version="1.0"?>\n<vector />\n' > "${fixture_root}/apps/mobile/icon.xml"
printf 'apps/mobile/*.xml\n' > "${fixture_root}/.spdx-exempt"
assert_violation "a glob in .spdx-exempt is rejected" LIC006 \
  "glob syntax is not accepted"

# A directory entry. `[ -e ]` accepts one, so without this branch an entry
# naming a tree passes LIC006 while exempting nothing under it -- a list that
# reads in review as a blanket and behaves as a no-op is the worst of both.
new_fixture
write_good_app mobile
mkdir -p "${fixture_root}/apps/mobile/res"
printf '<?xml version="1.0"?>\n<vector />\n' > "${fixture_root}/apps/mobile/res/icon.xml"
printf 'apps/mobile/res\n' > "${fixture_root}/.spdx-exempt"
assert_violation "a directory in .spdx-exempt is rejected" LIC006 \
  "names a directory; exempt each file"

# The exact-match case that a DIRECTORY fixture cannot make, because a directory
# entry is refused outright: two real files where one path is a prefix of the
# other. `build.gradle` and `build.gradle.kts` are the pair a Gradle project
# actually produces, so a prefix comparison would exempt the Kotlin build script
# the moment somebody exempted the Groovy one.
new_fixture
write_good_app mobile
printf 'ext {}\n' > "${fixture_root}/apps/mobile/probe.gradle"
printf 'ext {}\n' > "${fixture_root}/apps/mobile/probe.gradle.kts"
printf 'apps/mobile/probe.gradle\n' > "${fixture_root}/.spdx-exempt"
assert_violation "an exemption does not extend to a path it is a prefix of" LIC002 \
  "apps/mobile/probe.gradle.kts: no SPDX-License-Identifier"

new_fixture
write_good_app mobile
printf '/etc/passwd\n' > "${fixture_root}/.spdx-exempt"
assert_violation "an absolute path in .spdx-exempt is rejected" LIC006 \
  "entries are repository-relative paths"

new_fixture
write_good_app mobile
printf '../elsewhere/icon.xml\n' > "${fixture_root}/.spdx-exempt"
assert_violation "a path escaping the repository is rejected" LIC006 \
  "entries are repository-relative paths"

# Comments and blank lines are not paths. Until this case existed, a `#` line
# would have been reported as a missing file -- a checker whose own comment
# syntax fails the build teaches people to delete the comments.
new_fixture
write_good_app mobile
printf '<?xml version="1.0"?>\n<vector />\n' > "${fixture_root}/apps/mobile/icon.xml"
printf '# why this file is exempt\n\n   \napps/mobile/icon.xml   # trailing note\n' \
  > "${fixture_root}/.spdx-exempt"
assert_clean "comments, blank lines and trailing notes in .spdx-exempt are not paths"

# --- The Capacitor trees that `cap sync` regenerates are pruned, not exempted -
#
# All three are gitignored by Capacitor's own template, so they are absent from
# a clean clone and an entry in .spdx-exempt naming one would be a LIC006
# violation. Pruning is what keeps this checker's answer the same in CI and on
# the machine of somebody who has just run a sync -- and the copied web build is
# the one that matters, because it is a bundle full of `.js` and `.css`.

new_fixture
write_good_app mobile
mkdir -p "${fixture_root}/apps/mobile/android/app/src/main/assets/public"
printf 'console.log(1);\n' \
  > "${fixture_root}/apps/mobile/android/app/src/main/assets/public/index-abc123.js"
assert_clean "the copied web build under assets/public is not scanned"

new_fixture
write_good_app mobile
mkdir -p "${fixture_root}/apps/mobile/android/capacitor-cordova-android-plugins/src"
printf 'ext {}\n' \
  > "${fixture_root}/apps/mobile/android/capacitor-cordova-android-plugins/cordova.variables.gradle"
assert_clean "the generated Cordova plugin project is not scanned"

new_fixture
write_good_app mobile
mkdir -p "${fixture_root}/apps/mobile/android/app/src/main/res/xml"
printf '<?xml version="1.0"?>\n<widget />\n' \
  > "${fixture_root}/apps/mobile/android/app/src/main/res/xml/config.xml"
assert_clean "the generated res/xml/config.xml is not scanned"

# --- REL001: signing key material must never be committed (#95) --------------
#
# The one rule here whose violation cannot be undone by fixing it: a pushed
# commit is permanent regardless of what a later commit deletes, and an Android
# upload key is not rotatable — Play identifies the app by the key.

new_fixture
mkdir -p "${fixture_root}/apps/mobile/android/app"
printf 'not really a keystore\n' > "${fixture_root}/apps/mobile/android/app/release.jks"
assert_violation "a committed .jks keystore is rejected" REL001 "release.jks"

new_fixture
mkdir -p "${fixture_root}/apps/mobile/android"
printf 'storePassword=hunter2\n' > "${fixture_root}/apps/mobile/android/keystore.properties"
assert_violation "a committed keystore.properties is rejected" REL001 "keystore.properties"

new_fixture
mkdir -p "${fixture_root}/apps/mobile"
printf 'binary\n' > "${fixture_root}/apps/mobile/upload.keystore"
assert_violation "a committed .keystore is rejected" REL001 "upload.keystore"

new_fixture
mkdir -p "${fixture_root}/apps/mobile"
printf 'binary\n' > "${fixture_root}/apps/mobile/service-account.p12"
assert_violation "a committed .p12 is rejected" REL001 "service-account.p12"

# The case a name rule cannot catch: a private key pasted into a file whose name
# says nothing. This is why REL001 has a content half as well as a name half.
new_fixture
mkdir -p "${fixture_root}/apps/mobile"
printf 'signing:\n  pem: |\n    -----BEGIN RSA PRIVATE KEY-----\n    AAAA\n    -----END RSA PRIVATE KEY-----\n' \
  > "${fixture_root}/apps/mobile/config.yml"
assert_violation "a PRIVATE KEY block in an innocently-named file is rejected" REL001 \
  "config.yml"

# And the false positive that would make the rule unusable: ordinary files whose
# names merely resemble the pattern, and a PUBLIC key, which is not a secret.
new_fixture
mkdir -p "${fixture_root}/packages/domain/src"
printf '// SPDX-License-Identifier: Apache-2.0\nexport const monkey = 1;\n' \
  > "${fixture_root}/packages/domain/src/monkey.ts"
printf '# Apache\n' > "${fixture_root}/packages/domain/LICENSE"
printf '{"license":"Apache-2.0"}\n' > "${fixture_root}/packages/domain/package.json"
printf -- '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n' \
  > "${fixture_root}/packages/domain/device.pub"
assert_clean "a public key and a file named monkey.ts are not key material"

# --- REL001 walks the same trees every other rule walks (#229) ---------------
#
# It used to walk its own: an inline list that excluded `fixtures` and did not
# exclude `coverage`, beside a shared prune array that did the opposite. One of
# the two had to be wrong and nobody could say which, so #229 resolved it in the
# direction the rule's own severity requires -- `fixtures` is a tree this
# repository AUTHORS and commits, and a key committed there is as permanent as a
# key committed anywhere else, while `coverage` is build output that is
# gitignored and cannot carry a committed anything.
#
# Both halves of REL001 are pinned, because the two used to disagree with each
# other as well: the content half never excluded `fixtures`, so a PEM under
# `fixtures/` was already reported while a `.jks` beside it was not.

new_fixture
mkdir -p "${fixture_root}/packages/fit/fixtures"
printf 'binary\n' > "${fixture_root}/packages/fit/fixtures/release.jks"
assert_violation "a keystore under a fixtures directory is rejected" REL001 \
  "packages/fit/fixtures/release.jks"

new_fixture
mkdir -p "${fixture_root}/packages/fit/fixtures"
printf -- '-----BEGIN EC PRIVATE KEY-----\nAAAA\n-----END EC PRIVATE KEY-----\n' \
  > "${fixture_root}/packages/fit/fixtures/sample.txt"
assert_violation "a PRIVATE KEY block under a fixtures directory is rejected" REL001 \
  "packages/fit/fixtures/sample.txt"

# And the other direction: generated output is pruned by both halves, from the
# shared list. `coverage/` is written by `test:coverage` on every contributor's
# machine, so a rule that reported it would be red locally and green in CI --
# the local-only red that `.prettierignore` already carries three entries for.
new_fixture
mkdir -p "${fixture_root}/coverage/tmp"
printf 'binary\n' > "${fixture_root}/coverage/tmp/release.jks"
printf -- '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----\n' \
  > "${fixture_root}/coverage/tmp/report.json"
assert_clean "key material inside generated coverage output is pruned"

# --- REL002: the Android build targets a current API level (#95) -------------
#
# Checked here rather than in Gradle because nobody in this environment can run
# a Gradle build — no Android SDK, and dl.google.com is refused by the egress
# proxy. A rule that only fires inside a build nobody can run never fires.

new_fixture
mkdir -p "${fixture_root}/apps/mobile/android"
printf 'ext {\n    minSdkVersion = 24\n    targetSdkVersion = 34\n}\n' \
  > "${fixture_root}/apps/mobile/android/variables.gradle"
assert_violation "a targetSdkVersion below 36 is rejected" REL002 "targetSdkVersion 34"

new_fixture
mkdir -p "${fixture_root}/apps/mobile/android"
printf 'ext {\n    minSdkVersion = 24\n}\n' \
  > "${fixture_root}/apps/mobile/android/variables.gradle"
assert_violation "a variables.gradle with no targetSdkVersion is rejected" REL002 \
  "declares no targetSdkVersion"

new_fixture
mkdir -p "${fixture_root}/apps/mobile/android"
printf '// SPDX-License-Identifier: AGPL-3.0-or-later\next {\n    minSdkVersion = 24\n    targetSdkVersion = 36\n}\n' \
  > "${fixture_root}/apps/mobile/android/variables.gradle"
assert_clean "targetSdkVersion 36 passes"

new_fixture
mkdir -p "${fixture_root}/apps/mobile/android"
printf '// SPDX-License-Identifier: AGPL-3.0-or-later\next {\n    targetSdkVersion = 37\n}\n' \
  > "${fixture_root}/apps/mobile/android/variables.gradle"
assert_clean "a targetSdkVersion above the floor passes, rather than being pinned"

# A repository with no Android project at all must stay clean: this rule is
# about apps/mobile and must not fail every other clone.
new_fixture
assert_clean "a tree with no android/ directory is not a REL002 violation"

# --- REL002, the three ways it used to pass over a regression (#95) ----------
#
# The rule read ONE file for ONE value and took the FIRST match in it. That
# fails closed against editing that value and open against every other way the
# number reaches the build, which is the #142 shape: a selector asserted to
# exist rather than discovered. All three cases below were GREEN before #95.

# An Android project that declares no target level ANYWHERE. The rule returned
# 0 the moment variables.gradle was missing, so deleting that one file removed
# the floor entirely and the checker said the tree was clean.
new_fixture
mkdir -p "${fixture_root}/apps/mobile/android/app"
printf '// SPDX-License-Identifier: AGPL-3.0-or-later\nandroid {\n    namespace = "dev.openzigs.onyourleft"\n}\n' \
  > "${fixture_root}/apps/mobile/android/app/build.gradle"
assert_violation "an Android project that declares no target level at all is rejected" REL002 \
  "declares no targetSdkVersion"

# The other side of that: the floor follows the VALUE, not the filename. A
# project that inlines a compliant level and has no variables.gradle is
# compliant, and a rule that insisted on the file would be a rule about layout.
new_fixture
mkdir -p "${fixture_root}/apps/mobile/android/app"
printf '// SPDX-License-Identifier: AGPL-3.0-or-later\nandroid {\n    defaultConfig {\n        targetSdkVersion 36\n    }\n}\n' \
  > "${fixture_root}/apps/mobile/android/app/build.gradle"
assert_clean "a compliant level inlined in build.gradle passes without a variables.gradle"

# The override. variables.gradle says 36 and the build does not read it: the
# value the Android Gradle Plugin actually applies is the literal beside
# `targetSdkVersion` in app/build.gradle, and the shipped app targets 33.
new_fixture
mkdir -p "${fixture_root}/apps/mobile/android/app"
printf '// SPDX-License-Identifier: AGPL-3.0-or-later\next {\n    targetSdkVersion = 36\n}\n' \
  > "${fixture_root}/apps/mobile/android/variables.gradle"
printf '// SPDX-License-Identifier: AGPL-3.0-or-later\nandroid {\n    defaultConfig {\n        targetSdkVersion 33\n    }\n}\n' \
  > "${fixture_root}/apps/mobile/android/app/build.gradle"
assert_violation "a build.gradle literal below the floor is rejected, whatever variables.gradle says" \
  REL002 "targetSdkVersion 33"

# The second line. `head -1` read the first match and Gradle applies the last
# assignment, so a lower value appended below a compliant one was invisible.
new_fixture
mkdir -p "${fixture_root}/apps/mobile/android"
printf '// SPDX-License-Identifier: AGPL-3.0-or-later\next {\n    targetSdkVersion = 36\n    targetSdkVersion = 30\n}\n' \
  > "${fixture_root}/apps/mobile/android/variables.gradle"
assert_violation "a second, lower targetSdkVersion below a compliant one is rejected" REL002 \
  "targetSdkVersion 30"

# The AGP DSL spelling. `targetSdk` without the `Version` suffix is the current
# one and sets the same thing; a rule that knows only the old spelling is a rule
# a routine Gradle modernisation switches off.
new_fixture
mkdir -p "${fixture_root}/apps/mobile/android/app"
printf '// SPDX-License-Identifier: AGPL-3.0-or-later\next {\n    targetSdkVersion = 36\n}\n' \
  > "${fixture_root}/apps/mobile/android/variables.gradle"
printf '// SPDX-License-Identifier: AGPL-3.0-or-later\nandroid {\n    defaultConfig {\n        targetSdk = 34\n    }\n}\n' \
  > "${fixture_root}/apps/mobile/android/app/build.gradle"
assert_violation "the targetSdk spelling is checked too" REL002 "targetSdk 34"

# ⚠️ The two cases that keep the sweep from being a rule nobody can live with.
#
# The shipped app/build.gradle reads the ext property rather than a literal, and
# a sweep that flagged it would be reverted within a day. And a Gradle file is
# allowed to talk about API levels in a comment.
new_fixture
mkdir -p "${fixture_root}/apps/mobile/android/app"
printf '// SPDX-License-Identifier: AGPL-3.0-or-later\next {\n    targetSdkVersion = 36\n}\n' \
  > "${fixture_root}/apps/mobile/android/variables.gradle"
printf '// SPDX-License-Identifier: AGPL-3.0-or-later\nandroid {\n    defaultConfig {\n        targetSdkVersion rootProject.ext.targetSdkVersion\n    }\n}\n' \
  > "${fixture_root}/apps/mobile/android/app/build.gradle"
assert_clean "a build.gradle that reads the ext property is not a literal and passes"

new_fixture
mkdir -p "${fixture_root}/apps/mobile/android/app"
printf '// SPDX-License-Identifier: AGPL-3.0-or-later\next {\n    targetSdkVersion = 36\n}\n' \
  > "${fixture_root}/apps/mobile/android/variables.gradle"
printf '// SPDX-License-Identifier: AGPL-3.0-or-later\n// We used to set targetSdkVersion 30 here; see #95.\nandroid {\n}\n' \
  > "${fixture_root}/apps/mobile/android/app/build.gradle"
assert_clean "a line comment naming an old target level is prose, not a declaration"

# --- XML001 / XML002: an XML comment a parser will accept (#225) -------------
#
# The defect these exist for is real and shipped: `AndroidManifest.xml` landed in
# #87 as XML no parser accepts, and the first Gradle build ever run against this
# repository — months later — failed on it. LIC002 already scanned that file, but
# only for an SPDX identifier in the first five lines, so a manifest that could
# not be parsed at all passed every gate in this repository.
#
# ⚠️ The regression fixture below is the shipped comment, near enough verbatim.
# It is the case that motivated the rule, so it is the case that pins it; a
# fixture invented afterwards would be a fixture written against the fix.

# The header every XML file under apps/ needs, so that these cases exercise
# XML001/XML002 rather than LIC002. Written as a function because the second
# line of a manifest is the one place the two rules meet, and getting it wrong
# in one fixture out of eight is how a case starts asserting the wrong rule.
xml_header() {
  printf '<?xml version="1.0" encoding="utf-8"?>\n'
  printf '<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->\n'
}

manifest_path() {
  mkdir -p "${fixture_root}/apps/mobile/android/app/src/main"
  printf '%s' "${fixture_root}/apps/mobile/android/app/src/main/AndroidManifest.xml"
}

new_fixture
target="$(manifest_path)"
{ xml_header
  printf '<manifest>\n'
  printf '  <!-- a hand-written -- note -->\n'
  printf '</manifest>\n'
} > "${target}"
assert_violation "a double hyphen inside an XML comment is rejected" XML001 \
  "apps/mobile/android/app/src/main/AndroidManifest.xml:4"

# THE REGRESSION. The comment as #87 shipped it: prose using "--" as a dash,
# inside a multi-line comment, with the offending line four lines below the one
# the comment opened on. Both numbers are asserted, because "names the file and
# the line" is the acceptance criterion and a rule that reported the opening
# line alone would send a reader to a line that is fine.
new_fixture
target="$(manifest_path)"
{ xml_header
  printf '<manifest>\n'
  printf '  <!--\n'
  printf '    The connectedDevice foreground service (#87). Mandatory since Android\n'
  printf '    14 (API 34) for a service that holds a BLE link. Neither Capacitor nor\n'
  printf '    the BLE plugin ships one -- capacitor-community/bluetooth-le has no\n'
  printf '    service -- so this is hand-written.\n'
  printf '  -->\n'
  printf '  <service android:name=".RecordingService" />\n'
  printf '</manifest>\n'
} > "${target}"
assert_violation_all "the AndroidManifest.xml comment as #87 shipped it is rejected" XML001 \
  "apps/mobile/android/app/src/main/AndroidManifest.xml:7" \
  "opened at line 4"

# The same file with the em dash the rest of this repository's prose uses, which
# is exactly the fix that made the Android shell build. Without this case the
# rule above would be satisfied by a checker that rejects every comment.
new_fixture
target="$(manifest_path)"
{ xml_header
  printf '<manifest>\n'
  printf '  <!--\n'
  printf '    The connectedDevice foreground service (#87). Neither Capacitor nor\n'
  printf '    the BLE plugin ships one — capacitor-community/bluetooth-le has no\n'
  printf '    service — so this is hand-written.\n'
  printf '  -->\n'
  printf '  <service android:name=".RecordingService" />\n'
  printf '</manifest>\n'
} > "${target}"
assert_clean "the same comment with em dashes passes"

# "--->": the content ends on a hyphen abutting the terminator, which the XML
# grammar forbids for the same reason and xmllint rejects with the same message.
new_fixture
target="$(manifest_path)"
{ xml_header
  printf '<manifest>\n'
  printf '  <!-- a note ---></manifest>\n'
} > "${target}"
assert_violation "a comment closed with \"--->\" is rejected" XML001 \
  "apps/mobile/android/app/src/main/AndroidManifest.xml:4"

# --- XML002 ------------------------------------------------------------------
#
# The DOC002 failure mode, in XML. An unclosed comment does not merely hide the
# rest of the file from a reader: it hides it from the PARSER, so every element
# after it is silently absent from the document the merger sees. The rule reports
# the line the comment OPENED on, because that is the line to go and fix.

new_fixture
target="$(manifest_path)"
{ xml_header
  printf '<manifest>\n'
  printf '  <!-- the permissions below are deliberate\n'
  printf '  <uses-permission android:name="android.permission.INTERNET" />\n'
  printf '</manifest>\n'
} > "${target}"
assert_violation "an unclosed XML comment is rejected" XML002 \
  "apps/mobile/android/app/src/main/AndroidManifest.xml:4"

# Two comments on ONE line, and a comment spanning several. Both are the cases a
# naive scanner gets wrong in opposite directions — one by never leaving the
# comment state, the other by leaving it on the wrong line — and both are legal.
new_fixture
target="$(manifest_path)"
{ xml_header
  printf '<manifest>\n'
  printf '  <!-- one --><!-- two -->\n'
  printf '  <!-- a comment\n'
  printf '       that spans\n'
  printf '       three lines -->\n'
  printf '</manifest>\n'
} > "${target}"
assert_clean "several comments, on one line and across many, pass"

# The false positives that would make the rule unusable. A double hyphen is only
# forbidden INSIDE a comment: in element text, in an attribute value, and in a
# `<!--` that is text because it sits inside CDATA, it is ordinary content. The
# CDATA case is the dangerous one — read as a comment it would open one that
# never closes, and the rule would fail a well-formed file with XML002.
new_fixture
target="$(manifest_path)"
{ xml_header
  printf '<manifest>\n'
  printf '  <string name="dash">a -- b</string>\n'
  printf '  <string name="attr" value="x--y" />\n'
  printf '  <string name="raw"><![CDATA[ <!-- not a comment -- at all ]]></string>\n'
  printf '</manifest>\n'
} > "${target}"
assert_clean "a double hyphen outside a comment, and a <!-- inside CDATA, pass"

# A hyphen ending one line and another opening the next is NOT a double hyphen:
# the line break is a character between them, and libxml2 accepts it. Found by
# running this rule against xmllint over four hundred generated documents — the
# first version of the scanner carried a cross-line rule and this was its one
# false positive.
new_fixture
target="$(manifest_path)"
{ xml_header
  printf '<manifest>\n'
  printf '  <!-- a note ending on a hyphen -\n'
  printf '%s\n' '- and continuing -->'
  printf '</manifest>\n'
} > "${target}"
assert_clean "a hyphen at a line end and another at the next line start pass"

# --- XML003: an unclosed CDATA section, and the blinding it used to cause -----
#
# #229. The hole XML001/XML002 were built to close, one construct across. An
# unclosed `<![CDATA[` set the scanner's CDATA state and nothing ever cleared
# it, so every later line took the "still inside CDATA" path and BOTH rules went
# silent for the remainder of the file -- which is `DOC002`'s sticking fence
# state exactly, in the rule written because of it.
#
# ⚠️ The order of these two cases is the point. The first proves the new rule
# fires; on its own it would be satisfied by a checker that reports the unclosed
# CDATA and then stays blind, which is a fix that looks like one. The second is
# the issue's fixture A -- an unclosed CDATA FOLLOWED BY a real XML001 -- and it
# is the case that says the blinding is gone.

new_fixture
target="$(manifest_path)"
{ xml_header
  printf '<manifest>\n'
  printf '  <string name="raw"><![CDATA[ never closed\n'
  printf '</manifest>\n'
} > "${target}"
assert_violation "an unclosed CDATA section is rejected" XML003 \
  "apps/mobile/android/app/src/main/AndroidManifest.xml:4"

# THE BLINDING. Reported by the review of #228 and reproduced before #229 was
# filed: `xmllint` says "CData section not finished" and this checker said
# "clean". The `--` on the line after the opener is a violation by XML001's own
# definition, and every XML001 and XML002 defect further down that file went
# with it.
new_fixture
target="$(manifest_path)"
{ xml_header
  printf '<manifest><![CDATA[ oops\n'
  printf '  <!-- a -- b -->\n'
  printf '</manifest>\n'
} > "${target}"
assert_violations "an unclosed CDATA reports itself AND no longer hides the violation after it" \
  XML003 "apps/mobile/android/app/src/main/AndroidManifest.xml:3" \
  XML001 "apps/mobile/android/app/src/main/AndroidManifest.xml:4"

# The false positive the recovery must not introduce, and the reason it is
# conditional on the section never closing at all. A CDATA section that spans
# lines is legal and common, and everything inside it is text: a `--`, a `<!--`
# and a `-->` in there are all ordinary characters. A scanner that simply gave
# up on CDATA at the end of each line would report three violations here, in a
# file `xmllint` accepts.
new_fixture
target="$(manifest_path)"
{ xml_header
  printf '<manifest>\n'
  printf '  <string name="raw"><![CDATA[\n'
  printf '    a -- b\n'
  printf '    <!-- not a comment -- at all\n'
  printf '    still text -->\n'
  printf '  ]]></string>\n'
  printf '</manifest>\n'
} > "${target}"
assert_clean "a CDATA section spanning lines, full of comment syntax, passes"

# Two sections, the first closed and the second not. The line reported has to be
# the opener with no terminator after it, not the first opener in the file: a
# counting scanner -- two `<![CDATA[`, one `]]>`, therefore unbalanced -- would
# report line 4 and send the reader to the section that is fine.
new_fixture
target="$(manifest_path)"
{ xml_header
  printf '<manifest>\n'
  printf '  <string name="a"><![CDATA[ fine ]]></string>\n'
  printf '  <string name="b"><![CDATA[ not fine\n'
  printf '  <!-- a -- b -->\n'
  printf '</manifest>\n'
} > "${target}"
assert_violations "the second of two CDATA sections is the unclosed one" \
  XML003 "apps/mobile/android/app/src/main/AndroidManifest.xml:5" \
  XML001 "apps/mobile/android/app/src/main/AndroidManifest.xml:6"

# --- XML004: an unclosed processing instruction ------------------------------
#
# The same construct class, and the reason the processing instruction had to be
# tracked at all: #228 reported XML001 for `<?php <!-- a -- b --> ?>`, which
# `xmllint` accepts -- `Comment` is not a production inside `PIContent`, so
# those characters are PI data and not a comment. Tracking a PI fixes that false
# positive; reporting an unclosed one is what stops the fix becoming a second
# way to switch the scanner off.

new_fixture
target="$(manifest_path)"
{ xml_header
  printf '<manifest>\n'
  printf '  <?target data and no terminator\n'
  printf '</manifest>\n'
} > "${target}"
assert_violation "an unclosed processing instruction is rejected" XML004 \
  "apps/mobile/android/app/src/main/AndroidManifest.xml:4"

new_fixture
target="$(manifest_path)"
{ xml_header
  printf '<manifest>\n'
  printf '  <?php <!-- a -- b --> ?>\n'
  printf '</manifest>\n'
} > "${target}"
assert_clean "comment syntax inside a processing instruction is not a comment"

# ...and the complement, without which the case above would be satisfied by a
# checker that stopped looking at the first `<?`: a real violation AFTER a
# well-formed processing instruction is still reported.
new_fixture
target="$(manifest_path)"
{ xml_header
  printf '<manifest>\n'
  printf '  <?php <!-- a -- b --> ?>\n'
  printf '  <!-- and this one -- is ours -->\n'
  printf '</manifest>\n'
} > "${target}"
assert_violation "a violation after a processing instruction is still reported" XML001 \
  "apps/mobile/android/app/src/main/AndroidManifest.xml:5"

# The scanner marks each delimiter with a U+0001 before splitting on it, so a
# U+0001 arriving IN the input would be read as a marker and cut the line where
# no delimiter is. XML 1.0 forbids that character in a document at all, so a
# file carrying one is already broken -- but broken input is exactly what this
# rule set is pointed at, and the two cases below are the two directions it can
# go wrong in.
#
# A hyphen, a control character and a hyphen are NOT a double hyphen, for the
# same reason a hyphen either side of a line break is not: something sits
# between them. Without the input being neutralised first, the marker splits the
# content there and the two hyphens read as adjacent -- a violation reported
# against a comment that does not contain one.
new_fixture
target="$(manifest_path)"
{ xml_header
  printf '<manifest>\n'
  printf '  <!-- a -\001- b -->\n'
  printf '</manifest>\n'
} > "${target}"
assert_clean "a hyphen, a control character and a hyphen are not a double hyphen"

# And the other direction: a stray control character must not cost the scan its
# place, leaving the real violation beside it unreported.
new_fixture
target="$(manifest_path)"
{ xml_header
  printf '<manifest>\n'
  printf '  <string>\001</string><!-- a -- b -->\n'
  printf '</manifest>\n'
} > "${target}"
assert_violation "a stray control character does not derail the scan" XML001 \
  "apps/mobile/android/app/src/main/AndroidManifest.xml:4"

# A minified document: one line, three thousand comments, one of them bad. It is
# a correctness case rather than a timing one -- a suite that fails on a slow
# machine is a suite people stop running -- but it is also what the tokenised
# scan was written for. The character-position scan it replaced re-copied the
# remainder of the line at every delimiter, which is quadratic in the number of
# them; the measurements are in `check-repo-rules.sh` beside the loop.
new_fixture
target="$(manifest_path)"
{ xml_header
  awk 'BEGIN {
    printf "<manifest>"
    for (i = 0; i < 1500; i++) printf "<!-- ok --><a/>"
    printf "<!-- bad -- here -->"
    for (i = 0; i < 1500; i++) printf "<!-- ok --><a/>"
    printf "</manifest>\n"
  }'
} > "${target}"
assert_violation "one bad comment among three thousand on a single line is found" XML001 \
  "apps/mobile/android/app/src/main/AndroidManifest.xml:3"

# --- The generated trees are pruned, from the SAME list every other rule uses --
#
# `cap sync` and Gradle both write XML this repository does not author. It is
# pruned rather than exempted because it is absent from a clean clone, so an
# entry in `.spdx-exempt` naming it would itself be a LIC006 violation — the
# reasoning `source_files` already carries, which is why XML001 shares its list
# rather than retyping it.

new_fixture
mkdir -p "${fixture_root}/apps/mobile/android/app/src/main/res/xml"
printf '<config><!-- generated -- by cap sync --></config>\n' \
  > "${fixture_root}/apps/mobile/android/app/src/main/res/xml/config.xml"
mkdir -p "${fixture_root}/apps/mobile/android/capacitor-cordova-android-plugins/src/main"
printf '<manifest><!-- generated -- and unclosed\n' \
  > "${fixture_root}/apps/mobile/android/capacitor-cordova-android-plugins/src/main/AndroidManifest.xml"
mkdir -p "${fixture_root}/apps/mobile/android/app/build/intermediates"
printf '<manifest><!-- merged -- output --></manifest>\n' \
  > "${fixture_root}/apps/mobile/android/app/build/intermediates/AndroidManifest.xml"
mkdir -p "${fixture_root}/node_modules/somedep"
printf '<x><!-- vendored -- xml --></x>\n' > "${fixture_root}/node_modules/somedep/pom.xml"
assert_clean "malformed XML in a generated or vendored tree is pruned"

# And the complement, without which the case above would also pass against a
# checker that pruned everything: the same content one directory up, where this
# repository DOES author it, still fails.
new_fixture
mkdir -p "${fixture_root}/apps/mobile/android/app/src/main/res/xml"
printf '<?xml version="1.0" encoding="utf-8"?>\n<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->\n<paths><!-- ours -- and wrong --></paths>\n' \
  > "${fixture_root}/apps/mobile/android/app/src/main/res/xml/file_paths.xml"
assert_violation "the same defect one file across from the pruned one still fails" XML001 \
  "apps/mobile/android/app/src/main/res/xml/file_paths.xml:3"

# --- ASSET001..ASSET005: provenance for every committed binary ----------------
#
# #339. The gate has to exist before the first `.glb` does, because the moment
# one lands this repository is carrying an artefact nothing it owns can check.
#
# ⚠️ Every case below that asserts a violation has a GREEN complement, and the
# reason is the failure mode the rule itself exists for: "no findings" and "the
# walk found nothing to have findings about" are indistinguishable from an exit
# code. The clean case immediately after each red one is what says the binary
# was seen at all.

# A file the NUL sniff classifies as binary: a real glTF binary header, which is
# also the format #302 is about. Deliberately NOT written with an extension the
# checker could be keying on -- that is what the "unheard-of extension" case
# below turns into an assertion.
write_binary_asset() {
  local rel="$1"
  mkdir -p "$(dirname "${fixture_root}/${rel}")"
  printf 'glTF\002\000\000\000\100\000\000\000payload' > "${fixture_root}/${rel}"
}

fixture_digest() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${fixture_root}/$1" | cut -d' ' -f1
  else
    sha256sum "${fixture_root}/$1" | cut -d' ' -f1
  fi
}

# append_asset_entry <path> <licence> <sha256>
append_asset_entry() {
  printf '\n[[asset]]\npath = "%s"\nsource = "Some Pack, https://example.invalid/pack"\nlicence = "%s"\nread = "2026-09-16"\nsha256 = "%s"\n' \
    "$1" "$2" "$3" >> "${fixture_root}/ASSETS.toml"
}

new_fixture
write_good_app web
write_binary_asset apps/web/public/models/rider.glb
append_asset_entry apps/web/public/models/rider.glb CC0-1.0 \
  "$(fixture_digest apps/web/public/models/rider.glb)"
assert_clean "a named binary asset with a matching digest and a permitted licence passes"

new_fixture
write_good_app web
write_binary_asset apps/web/public/models/rider.glb
assert_violation "a binary asset the manifest does not name is rejected" ASSET001 \
  "apps/web/public/models/rider.glb: a committed binary that ASSETS.toml does not name"

# ⚠️ The case the whole design turns on, and #142's lesson stated as a test.
# An extension allowlist fails closed against DELETING a format and OPEN against
# adding one: a gate that knows about `.glb` is blind to the `.gltf-binary`
# beside it, and blind to a file with no extension at all. Discovery reads the
# file instead, so a format nobody has thought of is covered on the day it
# arrives rather than on the day somebody remembers to add it to a list.
new_fixture
write_good_app web
write_binary_asset apps/web/public/models/tree.gltf-binary
assert_violation "a binary with an extension no rule has ever heard of is still found" ASSET001 \
  "apps/web/public/models/tree.gltf-binary: a committed binary"

new_fixture
write_good_app web
write_binary_asset apps/web/public/models/rider
assert_violation "a binary with no extension at all is still found" ASSET001 \
  "apps/web/public/models/rider: a committed binary"

# The complement of the three above: a TEXT file nobody named is not an asset.
# Without this, "the walk reports every unnamed binary" would also be satisfied
# by a walk that reported every unnamed file, which would make the rule
# unusable and would have been caught in review rather than by a gate.
new_fixture
write_good_app web
mkdir -p "${fixture_root}/apps/web/public"
printf '{ "scene": 0 }\n' > "${fixture_root}/apps/web/public/model.gltf"
assert_clean "a text file the manifest does not name is not an asset"

# --- ASSET002: the manifest names a file that is not there --------------------

new_fixture
write_good_app web
append_asset_entry apps/web/public/models/absent.glb CC0-1.0 \
  0000000000000000000000000000000000000000000000000000000000000000
assert_violation "an entry naming a file that is not there is rejected" ASSET002 \
  "apps/web/public/models/absent.glb: no such file"

new_fixture
write_good_app web
mkdir -p "${fixture_root}/apps/web/public/models"
append_asset_entry apps/web/public/models CC0-1.0 \
  0000000000000000000000000000000000000000000000000000000000000000
assert_violation "an entry naming a directory is rejected" ASSET002 \
  "apps/web/public/models: no such file"

# A glob is reported as ASSET002 rather than as a syntax error, deliberately and
# unlike `.spdx-exempt`'s LIC006: the lookup is string equality, so a pattern
# names no file and "no such file" is the true statement about it. The case is
# here so that the difference between the two lists is asserted rather than
# assumed.
new_fixture
write_good_app web
write_binary_asset apps/web/public/models/rider.glb
append_asset_entry 'apps/web/public/models/*.glb' CC0-1.0 \
  0000000000000000000000000000000000000000000000000000000000000000
assert_violations "a glob in an entry names no file" \
  ASSET002 "apps/web/public/models/*.glb: no such file" \
  ASSET001 "apps/web/public/models/rider.glb: a committed binary"

# --- ASSET003: the bytes are not the bytes that were recorded -----------------

new_fixture
write_good_app web
write_binary_asset apps/web/public/models/rider.glb
append_asset_entry apps/web/public/models/rider.glb CC0-1.0 \
  0000000000000000000000000000000000000000000000000000000000000000
assert_violation "a digest that does not reproduce is rejected" ASSET003 \
  "apps/web/public/models/rider.glb: SHA-256 is"

# The substitution this rule is actually for: the entry stays, the file is
# swapped. Nothing else in this repository would notice.
new_fixture
write_good_app web
write_binary_asset apps/web/public/models/rider.glb
append_asset_entry apps/web/public/models/rider.glb CC0-1.0 \
  "$(fixture_digest apps/web/public/models/rider.glb)"
printf 'glTF\002\000\000\000\100\000\000\000SOMETHING ELSE' \
  > "${fixture_root}/apps/web/public/models/rider.glb"
assert_violation "an asset replaced under an unchanged entry is rejected" ASSET003 \
  "apps/web/public/models/rider.glb: SHA-256 is"

new_fixture
write_good_app web
write_binary_asset apps/web/public/models/rider.glb
printf '\n[[asset]]\npath = "apps/web/public/models/rider.glb"\nsource = "Some Pack, https://example.invalid/pack"\nlicence = "CC0-1.0"\nread = "2026-09-16"\n' \
  >> "${fixture_root}/ASSETS.toml"
assert_violation "an entry with no sha256 at all is rejected" ASSET003 \
  "apps/web/public/models/rider.glb: no SHA-256 recorded"

# A named file need not be binary, and ASSET003 still verifies it. That is what
# lets `packages/fit/fixtures/corpus/zero-length.fit` -- zero bytes, therefore
# text by the NUL rule and therefore invisible to ASSET001 -- be covered at all.
new_fixture
write_good_app web
printf 'not a binary\n' > "${fixture_root}/apps/web/public-note.txt"
append_asset_entry apps/web/public-note.txt MIT \
  0000000000000000000000000000000000000000000000000000000000000000
assert_violation "a manifest may name a text file, and its digest is still checked" ASSET003 \
  "apps/web/public-note.txt: SHA-256 is"

# --- ASSET004: the licence, judged against where the file lands ---------------

new_fixture
write_good_app web
write_binary_asset apps/web/public/models/rider.glb
append_asset_entry apps/web/public/models/rider.glb GPL-3.0-only \
  "$(fixture_digest apps/web/public/models/rider.glb)"
assert_violation "a licence on neither list is rejected, because the gate fails closed" ASSET004 \
  "apps/web/public/models/rider.glb: licence GPL-3.0-only is not permitted"

# ⚠️ This case named `CC-BY-4.0` until #357, and a reviewer who remembers that is
# reading the old file: ADR 0023 ruled on that identifier, so it is no longer an
# example of a licence nobody has ruled on. `CC-BY-SA-4.0` is — one that is two
# letters from an admitted one and carries a share-alike obligation nobody here
# has read, which is exactly the shape the fail-closed branch exists for.
new_fixture
write_good_app web
write_binary_asset apps/web/public/models/rider.glb
append_asset_entry apps/web/public/models/rider.glb CC-BY-SA-4.0 \
  "$(fixture_digest apps/web/public/models/rider.glb)"
assert_violation "a licence nobody has ruled on is rejected rather than assumed benign" ASSET004 \
  "licence CC-BY-SA-4.0 is not permitted"

# ⚠️ The path half of the rule. ADR 0015 D-2 admits CC0-1.0 in a DISTRIBUTED
# closure under `apps/` only, because an Apache-2.0 leaf package exists to be
# droppable into someone else's project. #339 says as much: "where the asset
# lands is already constrained, and the manifest is what makes that checkable".
# The pair of cases is what makes it a rule about the path rather than a rule
# about the licence -- one of them alone passes against a checker that ignores
# the path entirely.
new_fixture
write_good_package domain
write_binary_asset packages/domain/fixtures/rider.glb
append_asset_entry packages/domain/fixtures/rider.glb CC0-1.0 \
  "$(fixture_digest packages/domain/fixtures/rider.glb)"
assert_violation "a weak-copyleft licence under packages/ is rejected" ASSET004 \
  "packages/domain/fixtures/rider.glb: licence CC0-1.0 is not permitted at this path"

new_fixture
write_good_package domain
write_binary_asset packages/domain/fixtures/rider.glb
append_asset_entry packages/domain/fixtures/rider.glb Apache-2.0 \
  "$(fixture_digest packages/domain/fixtures/rider.glb)"
assert_clean "a permissive licence under packages/ passes"

new_fixture
write_good_app web
write_binary_asset apps/web/public/models/rider.glb
printf '\n[[asset]]\npath = "apps/web/public/models/rider.glb"\nsource = "Some Pack, https://example.invalid/pack"\nread = "2026-09-16"\nsha256 = "%s"\n' \
  "$(fixture_digest apps/web/public/models/rider.glb)" >> "${fixture_root}/ASSETS.toml"
assert_violation "an entry with no licence at all is rejected" ASSET004 \
  "apps/web/public/models/rider.glb: no licence recorded"

# --- ASSET006: a licence that requires attribution, and the entry that owes it -
#
# #357 and [ADR 0023](../docs/adr/0023-cc-by-assets-and-attribution.md). CC-BY is
# free and is admitted under `apps/` — and unlike every other identifier on
# either list it carries a CONTINUING obligation: CC BY 4.0 §3(a)(1) wants the
# creator's name, a link to the material and, under §3(a)(1)(B), an indication
# of whether it was modified. So the manifest carries those three, and #358
# generates the credits screen from them rather than from somebody's memory.
#
# ⚠️ The pairing below is what makes this a rule rather than a widened list. A
# CC-BY entry with the attribution passes; the same entry with any one of the
# three keys removed does not. Without the red half, adding `CC-BY-4.0` to a
# variable would satisfy "a CC-BY asset now passes" and leave the obligation
# entirely unchecked — which is the trade #357 says must not be made silently.

# append_attributed_entry <path> <licence> <sha256> [omit]
#
# The five keys every entry needs, plus the three ADR 0023 D-3 requires of an
# attribution licence. <omit> names one of the three to leave out.
append_attributed_entry() {
  local path="$1" licence="$2" sha="$3" omit="${4:-}"
  {
    printf '\n[[asset]]\npath = "%s"\n' "${path}"
    printf 'source = "Some Pack, https://example.invalid/pack"\n'
    printf 'licence = "%s"\nread = "2026-09-18"\nsha256 = "%s"\n' "${licence}" "${sha}"
    [ "${omit}" = "creator" ] || printf 'creator = "A Person"\n'
    [ "${omit}" = "url" ] || printf 'url = "https://example.invalid/pack/rider"\n'
    [ "${omit}" = "modified" ] || printf 'modified = "no"\n'
  } >> "${fixture_root}/ASSETS.toml"
}

new_fixture
write_good_app web
write_binary_asset apps/web/public/models/rider.glb
append_attributed_entry apps/web/public/models/rider.glb CC-BY-4.0 \
  "$(fixture_digest apps/web/public/models/rider.glb)"
assert_clean "a CC-BY asset under apps/ passes when it records the attribution it owes"

for omitted in creator url modified; do
  new_fixture
  write_good_app web
  write_binary_asset apps/web/public/models/rider.glb
  append_attributed_entry apps/web/public/models/rider.glb CC-BY-4.0 \
    "$(fixture_digest apps/web/public/models/rider.glb)" "${omitted}"
  assert_violation "a CC-BY asset recording no ${omitted} is rejected" ASSET006 \
    "records no ${omitted}"
done

# ⚠️ Two letters, and a world of obligation. `CC-BY-NC-4.0` is non-OSI — CLAUDE.md
# §3 names it beside BUSL and SSPL as failing everywhere — and it is the one
# identifier most likely to be confused for the one this ADR admits. The
# attribution keys are present here, so this case also says that recording the
# attribution does not rescue a licence the gate does not admit at all.
new_fixture
write_good_app web
write_binary_asset apps/web/public/models/rider.glb
append_attributed_entry apps/web/public/models/rider.glb CC-BY-NC-4.0 \
  "$(fixture_digest apps/web/public/models/rider.glb)"
assert_violation "CC-BY-NC is still rejected, attribution recorded or not" ASSET004 \
  "licence CC-BY-NC-4.0 is not permitted"

# The path half, exactly as for the weak set: an Apache-2.0 leaf package exists
# to be dropped into somebody else's project, and an attribution obligation is
# the last thing that should travel inside one silently.
new_fixture
write_good_package domain
write_binary_asset packages/domain/fixtures/rider.glb
append_attributed_entry packages/domain/fixtures/rider.glb CC-BY-4.0 \
  "$(fixture_digest packages/domain/fixtures/rider.glb)"
assert_violation "a CC-BY asset under packages/ is rejected however complete its attribution" ASSET004 \
  "packages/domain/fixtures/rider.glb: licence CC-BY-4.0 is not permitted at this path"

# The three keys are ACCEPTED on any entry, not only on one that owes them.
# Without this case, "creator is a known key" would be satisfied by a parser
# that only tolerated it beside a CC-BY licence, and a contributor recording
# more than the licence demands would be met with an ASSET005 for their trouble.
new_fixture
write_good_app web
write_binary_asset apps/web/public/models/rider.glb
append_attributed_entry apps/web/public/models/rider.glb CC0-1.0 \
  "$(fixture_digest apps/web/public/models/rider.glb)"
assert_clean "the attribution keys are accepted on an entry whose licence does not require them"

# ...and the complement, which is the one that stops ASSET006 becoming a rule
# about every asset in the tree. A CC0 entry owes no attribution and records
# none, and that is a clean run rather than three findings.
new_fixture
write_good_app web
write_binary_asset apps/web/public/models/rider.glb
append_asset_entry apps/web/public/models/rider.glb CC0-1.0 \
  "$(fixture_digest apps/web/public/models/rider.glb)"
assert_clean "an asset under a licence that requires no attribution owes none"

# --- ASSET007: a derived asset records how to make it again (#430) ---------
#
# ADR 0026 D-5: a derived file is reproducible from a recorded input by a
# committed script, so its entry carries four keys ADR 0022's upstream-bytes
# entries never needed -- input, inputsha256, script and tool -- plus modified,
# because a derived file is a modified one whatever its licence. The pairing is
# the point again: a complete record passes, and removing any one key fails
# naming it. Without the red half, "the parser accepts the new keys" would be
# satisfied by a parser that accepted them and checked nothing.

# append_derived_entry <path> <sha256> <script> [omit]
append_derived_entry() {
  local path="$1" sha="$2" script="$3" omit="${4:-}"
  {
    printf '\n[[asset]]\npath = "%s"\n' "${path}"
    printf 'source = "Some Scan, processed by this repository"\n'
    printf 'licence = "CC0-1.0"\nread = "2026-09-22"\nsha256 = "%s"\n' "${sha}"
    [ "${omit}" = "modified" ] || printf 'modified = "decimated"\n'
    [ "${omit}" = "input" ] || printf 'input = "https://example.invalid/a/scan"\n'
    [ "${omit}" = "inputsha256" ] || \
      printf 'inputsha256 = "%s"\n' 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    [ "${omit}" = "script" ] || printf 'script = "%s"\n' "${script}"
    [ "${omit}" = "tool" ] || printf 'tool = "Blender 4.4.3"\n'
  } >> "${fixture_root}/ASSETS.toml"
}

write_pipeline_script() {
  mkdir -p "${fixture_root}/apps/web/tools"
  printf '# SPDX-License-Identifier: AGPL-3.0-or-later\nimport bpy\n' \
    > "${fixture_root}/apps/web/tools/process.py"
}

new_fixture
write_good_app web
write_pipeline_script
write_binary_asset apps/web/public/realistic/tree.glb
append_derived_entry apps/web/public/realistic/tree.glb \
  "$(fixture_digest apps/web/public/realistic/tree.glb)" apps/web/tools/process.py
assert_clean "a derived asset passes when it records its input, digest, script, tool and change"

for omitted in input inputsha256 script tool modified; do
  new_fixture
  write_good_app web
  write_pipeline_script
  write_binary_asset apps/web/public/realistic/tree.glb
  append_derived_entry apps/web/public/realistic/tree.glb \
    "$(fixture_digest apps/web/public/realistic/tree.glb)" apps/web/tools/process.py "${omitted}"
  assert_violation "a derived asset recording no ${omitted} is rejected" ASSET007 \
    "a derived asset records no ${omitted}"
done

# A script named but not committed: the recipe exists only on somebody's machine.
new_fixture
write_good_app web
write_binary_asset apps/web/public/realistic/tree.glb
append_derived_entry apps/web/public/realistic/tree.glb \
  "$(fixture_digest apps/web/public/realistic/tree.glb)" apps/web/tools/process.py
assert_violation "a derived asset whose script is not in the repository is rejected" ASSET007 \
  "script apps/web/tools/process.py is not in the repository"

# The digest has a shape, and a typo in it is a record nobody can check.
new_fixture
write_good_app web
write_pipeline_script
write_binary_asset apps/web/public/realistic/tree.glb
append_derived_entry apps/web/public/realistic/tree.glb \
  "$(fixture_digest apps/web/public/realistic/tree.glb)" apps/web/tools/process.py
sed -i.bak 's/^inputsha256 = .*/inputsha256 = "not-a-digest"/' "${fixture_root}/ASSETS.toml"
rm -f "${fixture_root}/ASSETS.toml.bak"
assert_violation "a derived asset whose input digest is not 64 hex digits is rejected" ASSET007 \
  "inputsha256 as 64 lowercase hex digits"

# ...and the complement: an upstream-bytes entry names none of the four, and
# owes none of them. ASSET007 is a rule about derived files, not every file.
new_fixture
write_good_app web
write_binary_asset apps/web/public/realistic/sky.hdr
append_asset_entry apps/web/public/realistic/sky.hdr CC0-1.0 \
  "$(fixture_digest apps/web/public/realistic/sky.hdr)"
assert_clean "an asset committed as its upstream bytes owes no derivation record"

# --- ASSET005: the manifest itself ------------------------------------------
#
# ⚠️ This is the rule without which the four above are the vacuous pass they
# exist to prevent. `check-env-example.sh` states the precedent in as many
# words: "a missing .env.example also fails -- a template that is not there
# documents nothing".

new_fixture
write_good_app web
write_binary_asset apps/web/public/models/rider.glb
rm -f "${fixture_root}/ASSETS.toml"
assert_violation "a manifest that is not there is a failure, not a pass" ASSET005 \
  "ASSETS.toml: not found"

# And with no assets at all, so that the failure is about the record rather than
# about anything it would have recorded. Deleting the gate is the failure.
new_fixture
write_good_app web
rm -f "${fixture_root}/ASSETS.toml"
assert_violation "deleting the manifest fails even in a tree with no binaries" ASSET005 \
  "ASSETS.toml: not found"

new_fixture
write_good_app web
printf 'this line is not TOML at all\n' >> "${fixture_root}/ASSETS.toml"
assert_violation "a line that is neither a comment, a header nor a key is rejected" ASSET005 \
  "not a comment, an [[asset]] header or a key"

new_fixture
write_good_app web
printf '\n[asset]\npath = "x"\n' >> "${fixture_root}/ASSETS.toml"
assert_violation "a table header that is not [[asset]] is rejected" ASSET005 \
  "expected an [[asset]] header"

# ⚠️ An unrecognised key is REFUSED rather than ignored -- ADR 0017 D-4's choice
# for the workout file, for the same reason: a key nobody reads is a claim about
# an asset that silently has no effect, and this file exists so that a claim
# about an asset is checked.
new_fixture
write_good_app web
write_binary_asset apps/web/public/models/rider.glb
append_asset_entry apps/web/public/models/rider.glb CC0-1.0 \
  "$(fixture_digest apps/web/public/models/rider.glb)"
printf 'attribution = "not a key this file has"\n' >> "${fixture_root}/ASSETS.toml"
assert_violation "an unrecognised key is refused rather than ignored" ASSET005 \
  "unknown key \"attribution\""

new_fixture
write_good_app web
printf 'path = "apps/web/stray.glb"\n' >> "${fixture_root}/ASSETS.toml"
assert_violation "a key before any [[asset]] header is rejected" ASSET005 \
  "appears before any [[asset]] header"

new_fixture
write_good_app web
printf '\n[[asset]]\nsource = "Some Pack"\nlicence = "CC0-1.0"\nread = "2026-09-16"\nsha256 = "00"\n' \
  >> "${fixture_root}/ASSETS.toml"
assert_violation "an entry with no path is rejected" ASSET005 \
  "the [[asset]] opened here names no path"

new_fixture
write_good_app web
printf '\n[[asset]]\npath = "apps/web/x.glb"\nlicence = "CC0-1.0"\nread = "2026-09-16"\nsha256 = "00"\n' \
  >> "${fixture_root}/ASSETS.toml"
assert_violation "an entry with no source is rejected" ASSET005 \
  "records no source"

new_fixture
write_good_app web
printf '\n[[asset]]\npath = "apps/web/x.glb"\nsource = "Some Pack"\nlicence = "CC0-1.0"\nsha256 = "00"\n' \
  >> "${fixture_root}/ASSETS.toml"
assert_violation "an entry with no read date is rejected" ASSET005 \
  "records no read date"

new_fixture
write_good_app web
printf '\n[[asset]]\npath = "apps/web/x.glb"\nsource = "Some Pack"\nlicence = "CC0-1.0"\nread = "16th September"\nsha256 = "00"\n' \
  >> "${fixture_root}/ASSETS.toml"
assert_violation "a read date that is not an ISO date is rejected" ASSET005 \
  "records no read date"

new_fixture
write_good_app web
printf '\n[[asset]]\npath = "apps/web/x.glb"\npath = "apps/web/y.glb"\nsource = "Some Pack"\nlicence = "CC0-1.0"\nread = "2026-09-16"\nsha256 = "00"\n' \
  >> "${fixture_root}/ASSETS.toml"
assert_violation "a duplicated key in one entry is rejected" ASSET005 \
  "duplicate key \"path\""

new_fixture
write_good_app web
printf '\n[[asset]]\npath = ""\nsource = "Some Pack"\nlicence = "CC0-1.0"\nread = "2026-09-16"\nsha256 = "00"\n' \
  >> "${fixture_root}/ASSETS.toml"
assert_violation "a key with an empty value is rejected" ASSET005 \
  "has an empty value"

# ⚠️ A manifest that does not parse stops the walk, and the walk's SILENCE is
# the assertion. A partially read entry list would report every asset named
# after the bad line as unnamed -- false statements, each of them, burying the
# one finding that is true.
# ⚠️ The entry has to be one the parse error DESTROYS, or the case is vacuous.
# A bad line beside an otherwise well-formed entry still leaves that entry in
# the list, so the asset is named either way and ASSET001 is silent for a reason
# that has nothing to do with the rule under test -- measured: that fixture is
# green against a checker with the early return deleted. A malformed entry FOR
# THE ASSET ITSELF is the one that goes missing.
new_fixture
write_good_app web
write_binary_asset apps/web/public/models/rider.glb
printf '\n[[asset]]\npath = "apps/web/public/models/rider.glb"\nsource = "Some Pack"\nlicence = "CC0-1.0"\nread = "16th September"\nsha256 = "%s"\n' \
  "$(fixture_digest apps/web/public/models/rider.glb)" >> "${fixture_root}/ASSETS.toml"
assert_violation_and_silence "a manifest that does not parse stops the walk rather than burying the finding" \
  ASSET005 "records no read date" ASSET001

# ...and that helper must still be able to say no, or the case above proves
# nothing.
#
# ⚠️ The guard deliberately does NOT reuse the ASSET005/ASSET001 pair. Under
# this checker those two can never co-occur -- any ASSET005 stops the walk, which
# is the property the case above asserts -- so a fixture built from them could
# only ever be silent, and a helper that ignored its fourth argument entirely
# would look correct. The pair here is one that genuinely can fire together: a
# single entry with both a licence nobody has ruled on and a digest that does
# not reproduce.
new_fixture
write_good_app web
write_binary_asset apps/web/public/models/rider.glb
append_asset_entry apps/web/public/models/rider.glb GPL-3.0-only \
  0000000000000000000000000000000000000000000000000000000000000000
assert_helper_fails "assert_violation_and_silence rejects a run in which the silent rule did fire" \
  assert_violation_and_silence "(expected to fail) ASSET003 was not silent" \
  ASSET004 "licence GPL-3.0-only is not permitted" ASSET003
cleanup_fixture

new_fixture
write_good_app web
write_binary_asset apps/web/public/models/rider.glb
append_asset_entry apps/web/public/models/rider.glb GPL-3.0-only \
  "$(fixture_digest apps/web/public/models/rider.glb)"
assert_helper_passes "assert_violation_and_silence accepts a rule that fired with a genuinely silent second" \
  assert_violation_and_silence "(expected to pass) ASSET003 was silent" \
  ASSET004 "licence GPL-3.0-only is not permitted" ASSET003
cleanup_fixture

# ⚠️ The record separator, which #357 moved from an exemption list to a
# positive one. `path`, `licence` and `sha256` become fields of a "|"-separated
# record, so a "|" in one would shift every field after it left -- the exact
# defect the separator comment in the checker records having already been caused
# once by a tab. That restriction is asserted here because nothing asserted it
# before, and it is the invariant the key change had to preserve.
new_fixture
write_good_app web
printf '\n[[asset]]\npath = "apps/web/a|b.glb"\nsource = "Some Pack"\nlicence = "MIT"\nread = "2026-09-18"\nsha256 = "00"\n' \
  >> "${fixture_root}/ASSETS.toml"
assert_violation "a separator character in a field-bearing value is rejected" ASSET005 \
  'key "path" has a "|" or a tab in its value'

# ...and the complement, which is what the positive list buys: a key whose value
# never becomes a field may contain anything. Without this case, "the three
# emitted keys are restricted" would be equally satisfied by restricting all of
# them, and a creator whose name carries a pipe would be an unfixable red.
new_fixture
write_good_app web
write_binary_asset apps/web/public/models/rider.glb
{
  printf '\n[[asset]]\npath = "apps/web/public/models/rider.glb"\n'
  printf 'source = "Some Pack | second edition"\nlicence = "CC-BY-4.0"\nread = "2026-09-18"\n'
  printf 'sha256 = "%s"\n' "$(fixture_digest apps/web/public/models/rider.glb)"
  printf 'creator = "A Person | A Studio"\nurl = "https://example.invalid/a?b=1|2"\n'
  printf 'modified = "merged to one geometry | rescaled"\n'
} >> "${fixture_root}/ASSETS.toml"
assert_clean "a value that never becomes a field may contain the separator"

# The traversal case. An entry has to name one file inside this repository, and
# an absolute or `..` path names something outside it -- which would also hand
# the digest step a file the repository does not contain. LIC006 refuses both in
# `.spdx-exempt` for the first reason; this rule has the second as well.
new_fixture
write_good_app web
append_asset_entry /etc/hosts MIT \
  0000000000000000000000000000000000000000000000000000000000000000
assert_violation "an absolute path is rejected" ASSET005 \
  "/etc/hosts: entries are repository-relative paths"

new_fixture
write_good_app web
append_asset_entry ../outside/rider.glb CC0-1.0 \
  0000000000000000000000000000000000000000000000000000000000000000
assert_violation "a path escaping the repository is rejected" ASSET005 \
  "../outside/rider.glb: entries are repository-relative paths"

# --- The generated trees are pruned, from the SAME list every other rule uses --
#
# A binary under a tree this repository does not author is not its asset. The
# complement below is what stops that case also passing against a checker that
# pruned everything.
#
# ⚠️ `.claude/` is on that list since #339 and is the reason this case exists in
# this shape: it holds git worktrees of OTHER branches, so without the prune a
# machine with worktrees reports another branch's forty binaries as unnamed --
# a local-only red with no fix a contributor can apply, which is the shape
# `.prettierignore` already carries the same directory for.
new_fixture
write_good_app web
write_binary_asset node_modules/somedep/blob.bin
write_binary_asset apps/web/dist/bundle.wasm
write_binary_asset .claude/worktrees/other-branch/apps/web/public/models/rider.glb
write_binary_asset apps/mobile/android/.gradle/8.14.3/fileHashes/fileHashes.bin
assert_clean "a binary in a generated, ignored or vendored tree is pruned"

new_fixture
write_good_app web
write_binary_asset apps/web/src/models/rider.glb
assert_violation "the same binary one directory across from a pruned one is found" ASSET001 \
  "apps/web/src/models/rider.glb: a committed binary"

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
