#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# check-env-example.sh — every environment variable the code reads is documented
# in .env.example.
#
# .gitignore ignores `.env` and `.env.*` and un-ignores `.env.example`, so the
# intended convention is a committed template with placeholder values and real
# values kept out of history. A template only works if it is complete, and the
# way it stops being complete is entirely ordinary: someone adds a read of a new
# variable, it works on their machine because their own `.env.local` has it, and
# the next contributor gets an undefined value instead of an error.
#
# Like the other checkers here this has no dependencies -- no Node, no install,
# no lockfile -- so it runs on a bare clone and in CI regardless of the state of
# the toolchain.
#
# Rule:
#   ENV001  a source file reads an environment variable that .env.example does
#           not list, or .env.example is missing
#
# Usage: scripts/check-env-example.sh [ROOT]   (ROOT defaults to the repo root)
# Exit:  0 clean, 1 if any rule is violated.

set -uo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_EXAMPLE="${ROOT}/.env.example"
findings=0

# Names supplied by the runtime or the bundler rather than by a `.env` file, so
# a template entry for them would document nothing. Vite defines MODE, BASE_URL,
# PROD, DEV and SSR on `import.meta.env` itself; NODE_ENV and CI come from the
# process that invoked the build.
BUILTIN_NAMES="NODE_ENV CI MODE BASE_URL PROD DEV SSR"

report() {
  printf 'ENV001: %s\n' "$1" >&2
  findings=$((findings + 1))
}

# The same source-file definition the other checkers use: code, not data or
# generated output.
source_files() {
  local dir="$1"
  [ -d "${dir}" ] || return 0
  find "${dir}" \
    \( -name node_modules -o -name dist -o -name build -o -name coverage -o -name .git \) -prune -o \
    -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \
               -o -name '*.mjs' -o -name '*.cjs' \) -print
}

# The three spellings that reach a real variable: `process.env.NAME` on the Node
# side and `import.meta.env.NAME` on the Vite side in dot and bracket form, and
# the destructured `const { NAME } = process.env` form of either. The leading
# token is anchored on `process` or `meta` so that an unrelated object with an
# `env` property is not mistaken for one of them.
#
# Known limit, stated rather than left to be discovered: the destructuring
# pattern is single-line. A `const {` whose closing brace is on a later line is
# not matched, because these greps are line-oriented and a multi-line matcher in
# portable grep is not worth the false positives. Prettier's default printWidth
# keeps the short forms on one line; a long one splits. If that becomes a real
# gap, the fix is a matcher over the whole file, not another grep.
used_names_in() {
  local file="$1"
  {
    grep -oE '(process|meta)[[:space:]]*\.[[:space:]]*env[[:space:]]*\.[[:space:]]*[A-Za-z_][A-Za-z0-9_]*' \
      "${file}" 2>/dev/null | sed -E 's/.*[.[:space:]]//'
    grep -oE "(process|meta)[[:space:]]*\.[[:space:]]*env[[:space:]]*\[[[:space:]]*['\"][A-Za-z_][A-Za-z0-9_]*" \
      "${file}" 2>/dev/null | sed -E "s/.*['\"]//"
    # `const { A, B: local, C = 'fallback' } = import.meta.env`. The binding is
    # what the template must document, so a rename keeps the left-hand name and
    # a default is dropped -- a documented variable with a fallback in the code
    # is still a documented variable.
    grep -oE '\{[^{}]*\}[[:space:]]*=[[:space:]]*(process|(import[[:space:]]*\.[[:space:]]*)?meta)[[:space:]]*\.[[:space:]]*env' \
      "${file}" 2>/dev/null |
      sed -E 's/\}.*//; s/^\{//' |
      tr ',' '\n' |
      sed -E 's/[:=].*//; s/[[:space:]]//g' |
      grep -E '^[A-Za-z_][A-Za-z0-9_]*$'
  } | sort -u
}

if [ ! -f "${ENV_EXAMPLE}" ]; then
  report ".env.example: not found; it is the template that documents every variable the code reads"
  printf '\n1 environment-template violation(s). See CONTRIBUTING.md and CLAUDE.md section 4a.\n' >&2
  exit 1
fi

# A declaration is `NAME=` at the start of a line. Comment lines begin with `#`
# and so cannot match, which is what lets the template carry prose.
declared="$(sed -n -E 's/^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=.*/\1/p' "${ENV_EXAMPLE}")"

is_documented() {
  local name="$1" candidate
  for candidate in ${BUILTIN_NAMES}; do
    [ "${name}" = "${candidate}" ] && return 0
  done
  printf '%s\n' "${declared}" | grep -qxF "${name}"
}

# The root's own toolchain files are scanned as well as the two package trees:
# vitest.config.ts and eslint.config.js sit at the top level, outside apps/ and
# packages/, and a read of an undocumented variable there is exactly as
# undocumented as one inside a package. `-maxdepth 1` keeps this to the root's
# own files; everything below it is either walked by source_files or is not
# source.
root_source_files() {
  find "${ROOT}" -maxdepth 1 -type f \
    \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \
       -o -name '*.mjs' -o -name '*.cjs' \) -print
}

while IFS= read -r file; do
  [ -n "${file}" ] || continue
  while IFS= read -r name; do
    [ -n "${name}" ] || continue
    if ! is_documented "${name}"; then
      report "${file#"${ROOT}"/}: reads ${name}, which .env.example does not list"
    fi
  done < <(used_names_in "${file}")
done < <(
  root_source_files
  source_files "${ROOT}/apps"
  source_files "${ROOT}/packages"
)

if [ "${findings}" -gt 0 ]; then
  printf '\n%s environment-template violation(s). Add each variable to .env.example with a placeholder value — never a real one.\n' \
    "${findings}" >&2
  exit 1
fi

printf 'check-env-example: clean (%s)\n' "${ROOT}"
