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

# Both spellings that reach a real variable: `process.env.NAME` on the Node side
# and `import.meta.env.NAME` on the Vite side, in dot and bracket form. The
# leading token is anchored on `process` or `meta` so that an unrelated object
# with an `env` property is not mistaken for one of them.
used_names_in() {
  local file="$1"
  {
    grep -oE '(process|meta)[[:space:]]*\.[[:space:]]*env[[:space:]]*\.[[:space:]]*[A-Za-z_][A-Za-z0-9_]*' \
      "${file}" 2>/dev/null | sed -E 's/.*[.[:space:]]//'
    grep -oE "(process|meta)[[:space:]]*\.[[:space:]]*env[[:space:]]*\[[[:space:]]*['\"][A-Za-z_][A-Za-z0-9_]*" \
      "${file}" 2>/dev/null | sed -E "s/.*['\"]//"
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
  printf '%s\n' "${declared}" | grep -qx "${name}"
}

for dir in "${ROOT}/apps" "${ROOT}/packages"; do
  while IFS= read -r file; do
    [ -n "${file}" ] || continue
    while IFS= read -r name; do
      [ -n "${name}" ] || continue
      if ! is_documented "${name}"; then
        report "${file#"${ROOT}"/}: reads ${name}, which .env.example does not list"
      fi
    done < <(used_names_in "${file}")
  done < <(source_files "${dir}")
done

if [ "${findings}" -gt 0 ]; then
  printf '\n%s environment-template violation(s). Add each variable to .env.example with a placeholder value — never a real one.\n' \
    "${findings}" >&2
  exit 1
fi

printf 'check-env-example: clean (%s)\n' "${ROOT}"
