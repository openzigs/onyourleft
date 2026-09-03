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
assert_violation() {
  local name="$1" rule="$2" needle="$3" out status
  out="$(bash "${CHECKER}" "${fixture_root}" 2>&1)"
  status=$?
  if [ "${status}" -ne 0 ] \
     && printf '%s' "${out}" | grep "^${rule}: " | grep -qF "${needle}"; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "${name}"
  else
    fail=$((fail + 1))
    printf 'FAIL %s\n     expected exit != 0 and a "%s: " line containing "%s"; got exit %s\n%s\n' \
      "${name}" "${rule}" "${needle}" "${status}" "${out}"
  fi
  cleanup_fixture
}

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
  "docs/adr/0005-tech-stack.md: ADR number 0005 is already taken"

new_fixture
printf '# ADR 0005\n' > "${fixture_root}/docs/adr/0005-tech-stack.md"
printf '# ADR 0006\n' > "${fixture_root}/docs/adr/0006-fit-codec-licensing.md"
assert_clean "distinct ADR numbers pass"

# --- ADR002: ADR filenames follow NNNN-kebab-case.md -------------------------

new_fixture
printf '# ADR\n' > "${fixture_root}/docs/adr/tech-stack.md"
assert_violation "ADR filename without a number is rejected" ADR002 \
  "docs/adr/tech-stack.md"

new_fixture
printf '# ADR\n' > "${fixture_root}/docs/adr/0005-Tech_Stack.md"
assert_violation "ADR filename that is not kebab-case is rejected" ADR002 \
  "docs/adr/0005-Tech_Stack.md"

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
