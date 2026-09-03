#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# check-repo-rules.sh — enforce the repository rules that are checkable by path.
#
# ADR 0005 makes the licence boundary structural: everything under packages/ is
# Apache-2.0 and everything under apps/ is AGPL-3.0-or-later, decided by the
# directory a file sits in rather than by what a manifest claims. A path rule is
# worth having precisely because it cannot be mis-declared, so it has to be
# checked by a machine. This is that machine.
#
# It deliberately has no dependencies — no Node, no install, no lockfile — so it
# runs on a bare clone and in CI before any toolchain exists. #23 may reimplement
# these rules inside the workspace linter; #24 wires this into CI. Neither is a
# reason to leave the rule unenforced in the meantime.
#
# Rules:
#   LIC001  every source file under packages/ declares SPDX Apache-2.0
#   LIC002  every source file under apps/ declares SPDX AGPL-3.0-or-later
#   LIC003  every package manifest declares the licence its path requires
#   LIC004  every leaf package under packages/ or apps/ carries its own LICENSE
#   SCOPE001 no ANT+ reference in any source tree (owner decision D2)
#   WF001   no pull_request_target trigger in .github/workflows/
#   ADR001  no two ADRs share a number
#   ADR002  every ADR filename is NNNN-kebab-case.md
#
# Usage: scripts/check-repo-rules.sh [ROOT]   (ROOT defaults to the repo root)
# Exit:  0 clean, 1 if any rule is violated.

set -uo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
findings=0

report() {
  printf '%s: %s\n' "$1" "$2" >&2
  findings=$((findings + 1))
}

# Source files we expect to carry an SPDX header. Data and generated formats are
# excluded because a header cannot be added to them without corrupting them.
source_files() {
  local dir="$1"
  [ -d "${dir}" ] || return 0
  find "${dir}" \
    \( -name node_modules -o -name dist -o -name build -o -name coverage -o -name .git \) -prune -o \
    -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \
               -o -name '*.mjs' -o -name '*.cjs' -o -name '*.css' -o -name '*.sh' \) -print
}

# The SPDX identifier must appear in the file's opening comment block. We allow
# the first five lines rather than only the first, because a shebang and a
# generated-file banner both legitimately precede it.
spdx_of() {
  head -n 5 "$1" | sed -n 's/.*SPDX-License-Identifier:[[:space:]]*\([A-Za-z0-9.+-]*\).*/\1/p' | head -n 1
}

# --- LIC001 / LIC002: SPDX header matches the directory ----------------------

check_headers() {
  local dir="$1" want="$2" rule="$3" file got
  while IFS= read -r file; do
    [ -n "${file}" ] || continue
    got="$(spdx_of "${file}")"
    if [ -z "${got}" ]; then
      report "${rule}" "${file#"${ROOT}"/}: no SPDX-License-Identifier in the first 5 lines (expected ${want})"
    elif [ "${got}" != "${want}" ]; then
      report "${rule}" "${file#"${ROOT}"/}: SPDX header is ${got}, but its path requires ${want}"
    fi
  done < <(source_files "${dir}")
}

check_headers "${ROOT}/packages" "Apache-2.0" LIC001
check_headers "${ROOT}/apps" "AGPL-3.0-or-later" LIC002

# --- LIC003: manifest licence field matches the directory --------------------

check_manifests() {
  local dir="$1" want="$2" manifest declared
  [ -d "${dir}" ] || return 0
  while IFS= read -r manifest; do
    [ -n "${manifest}" ] || continue
    declared="$(sed -n 's/.*"license"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${manifest}" | head -n 1)"
    if [ -z "${declared}" ]; then
      report LIC003 "${manifest#"${ROOT}"/}: no \"license\" field (expected \"${want}\")"
    elif [ "${declared}" != "${want}" ]; then
      report LIC003 "${manifest#"${ROOT}"/}: declares \"${declared}\", but its path requires \"${want}\""
    fi
  done < <(find "${dir}" -name node_modules -prune -o -type f -name package.json -print)
}

check_manifests "${ROOT}/packages" "Apache-2.0"
check_manifests "${ROOT}/apps" "AGPL-3.0-or-later"

# --- LIC004: each leaf package carries its own LICENSE ------------------------
# ADR 0001: "A package that does not do both is AGPL by default." The path rule
# does not replace the per-package file, it backs it up.
#
# Both trees, not only packages/. CLAUDE.md section 3 says "each package still
# carries its own LICENSE file AND a matching license manifest field -- belt and
# braces", and it says it of apps/ as well. Checking only one tree meant deleting
# apps/web/LICENSE failed nothing.

check_package_licences() {
  local dir="$1" licence="$2" manifest pkgdir
  [ -d "${dir}" ] || return 0
  while IFS= read -r manifest; do
    [ -n "${manifest}" ] || continue
    pkgdir="$(dirname "${manifest}")"
    if [ ! -f "${pkgdir}/LICENSE" ] && [ ! -f "${pkgdir}/LICENSE.txt" ]; then
      report LIC004 "${pkgdir#"${ROOT}"/}: no LICENSE file; every ${licence} leaf package carries its own"
    fi
  done < <(find "${dir}" -name node_modules -prune -o -type f -name package.json -print)
}

check_package_licences "${ROOT}/packages" "Apache-2.0"
check_package_licences "${ROOT}/apps" "AGPL-3.0-or-later"

# --- SCOPE001: no ANT+ anywhere in a source tree ------------------------------
# Owner decision D2. Documentation may name ANT+ to explain why it is excluded;
# a source tree may not, because naming it there means someone started building it.

# The pattern is anchored on a non-word character rather than bare `ant[+]`.
# Without that anchor `quadrant+1` and `CONSTANT+2` both match -- and the package
# where that arithmetic lives, packages/physics, is the one place it is certain
# to appear. `[[:<:]]`/`\b` are not portable between GNU and BSD grep, so the
# boundary is spelled out as "start of line, or a character that is not part of
# an identifier".
ANTPLUS_RE='(^|[^[:alnum:]_])(ant[+]|ant-plus|antplus|thisisant)'

# Scoped to SOURCE files, not to the whole tree. CLAUDE.md and ADR 0005 both say
# documentation may name ANT+ to explain why it is excluded; scanning every file
# under packages/ made `packages/sensors/README.md` doing exactly that fail the
# build, so the checker contradicted the rule it exists to enforce.
for dir in "${ROOT}/packages" "${ROOT}/apps"; do
  [ -d "${dir}" ] || continue
  while IFS= read -r file; do
    [ -n "${file}" ] || continue
    if grep -qiE "${ANTPLUS_RE}" "${file}" 2>/dev/null; then
      report SCOPE001 "${file#"${ROOT}"/}: ANT+ is out of scope permanently (owner decision D2, ADR 0005 \"Scope exclusions\")"
    fi
  done < <(source_files "${dir}")
done

# --- WF001: pull_request_target is banned in workflows ------------------------
# CLAUDE.md section 8. That trigger runs against the base repository with access
# to secrets, and unlike `pull_request` it is not covered by the fork approval
# gate at all -- so a fork's workflow change executes before anyone reviews it.
# This repository is public, which is exactly the population that vector needs.
#
# Scoped to .github/workflows/ rather than the whole tree, for the same reason
# SCOPE001 is scoped to source: CLAUDE.md and CONTRIBUTING.md have to be able to
# name the trigger in order to ban it. A checker that fails on the file stating
# the rule contradicts the rule.
#
# Matched as a fixed string with no word boundary. Unlike ANT+ there is no
# benign substring to collide with, and a bare occurrence anywhere in a workflow
# -- including inside a comment, ready to be uncommented -- is what we want to
# catch.

if [ -d "${ROOT}/.github/workflows" ]; then
  while IFS= read -r workflow; do
    [ -n "${workflow}" ] || continue
    if grep -qF 'pull_request_target' "${workflow}" 2>/dev/null; then
      report WF001 "${workflow#"${ROOT}"/}: pull_request_target is banned (CLAUDE.md section 8); use pull_request, which cannot read secrets from a fork"
    fi
  done < <(find "${ROOT}/.github/workflows" -type f \( -name '*.yml' -o -name '*.yaml' \) -print)
fi

# --- ADR001 / ADR002: ADR numbering and naming --------------------------------

if [ -d "${ROOT}/docs/adr" ]; then
  seen_numbers=""
  while IFS= read -r adr; do
    [ -n "${adr}" ] || continue
    base="$(basename "${adr}")"
    if ! printf '%s' "${base}" | grep -qE '^[0-9]{4}-[a-z0-9]+(-[a-z0-9]+)*\.md$'; then
      report ADR002 "docs/adr/${base}: filename must be NNNN-kebab-case.md"
      continue
    fi
    number="${base%%-*}"
    case " ${seen_numbers} " in
      *" ${number} "*)
        report ADR001 "docs/adr/${base}: ADR number ${number} is already taken; renumber before merging" ;;
      *)
        seen_numbers="${seen_numbers} ${number}" ;;
    esac
  done < <(find "${ROOT}/docs/adr" -type f -name '*.md' | sort)
fi

# --- Result -------------------------------------------------------------------

if [ "${findings}" -gt 0 ]; then
  printf '\n%s repository-rule violation(s). See docs/adr/0005-tech-stack.md and CONTRIBUTING.md.\n' \
    "${findings}" >&2
  exit 1
fi

printf 'check-repo-rules: clean (%s)\n' "${ROOT}"
