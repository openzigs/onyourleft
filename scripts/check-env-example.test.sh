#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for scripts/check-env-example.sh.
#
# Same shape as the other two suites: each case builds a throwaway fixture tree,
# runs the checker against it, and asserts on the exit code and on the text of
# the finding.
#
# The failure mode worth spending cases on is the vacuous pass. A checker whose
# extraction pattern silently stops matching reports nothing and exits 0, which
# is indistinguishable from a repository where every variable is documented --
# and .env.example is exactly the kind of file nobody re-reads. So the cases
# below pin down each spelling that must be caught, and each near-miss that must
# not be reported.
#
# Run: bash scripts/check-env-example.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKER="${SCRIPT_DIR}/check-env-example.sh"

pass=0
fail=0
fixture_root=""

# A fixture standing in for the real repository: the two source trees the
# checker scans, and a template.
new_fixture() {
  fixture_root="$(mktemp -d)"
  mkdir -p "${fixture_root}/apps/web/src" "${fixture_root}/packages/domain/src"
  printf '# Template.\n' > "${fixture_root}/.env.example"
}

# write_env <line>...
write_env() {
  {
    printf '# On Your Left environment template.\n#\n'
    printf '%s\n' "$@"
  } > "${fixture_root}/.env.example"
}

# write_source <relative-path> <line>...
write_source() {
  local rel="$1"
  shift
  mkdir -p "$(dirname "${fixture_root}/${rel}")"
  printf '%s\n' "$@" > "${fixture_root}/${rel}"
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
     && printf '%s' "${out}" | grep "^ENV001: " | grep -qF "${needle}"; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "${name}"
  else
    fail=$((fail + 1))
    printf 'FAIL %s\n     expected exit != 0 and an "ENV001: " line containing "%s"; got exit %s\n%s\n' \
      "${name}" "${needle}" "${status}" "${out}"
  fi
  cleanup_fixture
}

# --- A documented variable passes ---------------------------------------------

new_fixture
write_env 'VITE_INSTANCE_URL=https://example.invalid'
write_source 'apps/web/src/config.ts' \
  'export const url = import.meta.env.VITE_INSTANCE_URL;'
assert_clean "a variable listed in .env.example passes"

new_fixture
write_env 'VITE_INSTANCE_URL='
write_source 'apps/web/src/config.ts' \
  'export const url = import.meta.env.VITE_INSTANCE_URL;'
assert_clean "an entry with an empty placeholder still counts as documented"

new_fixture
assert_clean "a repository whose code reads no variables passes"

# --- An undocumented variable is caught, in each spelling that reaches one -----

new_fixture
write_source 'apps/web/src/config.ts' \
  'export const url = import.meta.env.VITE_INSTANCE_URL;'
assert_violation "an undocumented import.meta.env read is rejected" \
  "reads VITE_INSTANCE_URL"

new_fixture
write_source 'apps/web/src/config.ts' \
  'export const level = process.env.LOG_LEVEL;'
assert_violation "an undocumented process.env read is rejected" \
  "reads LOG_LEVEL"

new_fixture
write_source 'apps/web/src/config.ts' \
  "export const key = process.env['SIGNING_KEY'];"
assert_violation "the bracket-and-quote spelling is rejected too" \
  "reads SIGNING_KEY"

new_fixture
write_source 'apps/web/src/config.ts' \
  'export const key = import.meta.env["VITE_MAP_KEY"];'
assert_violation "the double-quoted bracket spelling is rejected too" \
  "reads VITE_MAP_KEY"

# packages/ is scanned as well as apps/. Checking only the first tree would
# leave every leaf package free to read whatever it liked -- and packages/domain
# reading an environment variable at all is a separate violation of its own.
new_fixture
write_source 'packages/domain/src/units.ts' \
  'export const p = process.env.DOMAIN_PRECISION;'
assert_violation "a read under packages/ is rejected, not only one under apps/" \
  "packages/domain/src/units.ts"

# --- The ways a template silently stops documenting anything ------------------

new_fixture
write_env '# VITE_INSTANCE_URL=https://example.invalid'
write_source 'apps/web/src/config.ts' \
  'export const url = import.meta.env.VITE_INSTANCE_URL;'
assert_violation "a commented-out entry does not count as documentation" \
  "reads VITE_INSTANCE_URL"

# Substring rather than absence: a template that documents VITE_INSTANCE_URL_V2
# does not document VITE_INSTANCE_URL, and a grep without an exact-match anchor
# would pass this.
new_fixture
write_env 'VITE_INSTANCE_URL_V2=https://example.invalid'
write_source 'apps/web/src/config.ts' \
  'export const url = import.meta.env.VITE_INSTANCE_URL;'
assert_violation "a longer name in the template does not document a shorter read" \
  "reads VITE_INSTANCE_URL,"

new_fixture
rm "${fixture_root}/.env.example"
write_source 'apps/web/src/config.ts' \
  'export const url = import.meta.env.VITE_INSTANCE_URL;'
assert_violation "a missing .env.example is rejected" \
  ".env.example: not found"

# A missing template is a violation even when nothing reads a variable yet:
# otherwise the check disarms itself exactly when the file is easiest to delete.
new_fixture
rm "${fixture_root}/.env.example"
assert_violation "a missing .env.example is rejected even with no reads" \
  ".env.example: not found"

# --- Near misses that must NOT be reported ------------------------------------

new_fixture
write_source 'apps/web/src/config.ts' \
  'export const mode = import.meta.env.MODE;' \
  'export const dev = import.meta.env.DEV;' \
  'export const ci = process.env.CI;'
assert_clean "runtime- and bundler-supplied names need no template entry"

# `config.env.SECRET` is an ordinary property access on an application object.
# Reporting it would train contributors to add fictional entries to the template.
new_fixture
write_source 'apps/web/src/config.ts' \
  'export const secret = config.env.SECRET;'
assert_clean "an unrelated object with an env property is not an environment read"

# Build output and dependencies are not source. A bundle inlines every variable
# it read, so scanning dist/ would report names that are already documented at
# their real call site -- and node_modules would report the whole ecosystem's.
new_fixture
write_source 'apps/web/dist/assets/index-abc123.js' \
  'const url=import.meta.env.VITE_BUNDLED_URL;'
write_source 'apps/web/node_modules/some-dep/index.js' \
  'const k=process.env.SOME_DEP_KEY;'
assert_clean "build output and node_modules are not scanned"

# --- Result -------------------------------------------------------------------

printf '\n%s passed, %s failed\n' "${pass}" "${fail}"
[ "${fail}" -eq 0 ]
