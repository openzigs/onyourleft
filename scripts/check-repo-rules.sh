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
#   ADR003  an ADR's "## Amendments" section is single, last, and dated
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
#
# ADR001 reports BOTH colliding paths and tells the reader neither of them is
# the one to renumber. That is not politeness: this loop walks `find | sort`, so
# the file it reaches second is whichever slug sorts later, which carries no
# information at all about which file is new. The message it used to print --
# "<the second one>: ADR number NNNN is already taken; renumber before merging"
# -- was therefore wrong about half the time, and its wrong half named a MERGED
# ADR. Those are cited by number from other ADRs and from docs/architecture.md,
# so renumbering one is precisely the thing the ownership table exists to
# prevent. Found in #118, from ADR 0009's own mutation test.
#
# The pairs are accumulated in a space-delimited string rather than an
# associative array: this script targets the bash on a bare macOS clone, which
# is 3.2 and has none. Both fields are safe to pack that way because ADR002 runs
# FIRST and `continue`s, so anything reaching here matches NNNN-kebab-case.md
# and can contain neither a space nor a colon.

if [ -d "${ROOT}/docs/adr" ]; then
  seen_pairs=" "
  while IFS= read -r adr; do
    [ -n "${adr}" ] || continue
    base="$(basename "${adr}")"
    if ! printf '%s' "${base}" | grep -qE '^[0-9]{4}-[a-z0-9]+(-[a-z0-9]+)*\.md$'; then
      report ADR002 "docs/adr/${base}: filename must be NNNN-kebab-case.md"
      continue
    fi
    number="${base%%-*}"
    case "${seen_pairs}" in
      *" ${number}:"*)
        rest="${seen_pairs#* "${number}":}"
        first="${rest%% *}"
        report ADR001 "docs/adr/${first} and docs/adr/${base} share ADR number ${number}; the one that is not yet merged must be renumbered -- see the ownership table in docs/architecture.md" ;;
      *)
        seen_pairs="${seen_pairs}${number}:${base} " ;;
    esac
  done < <(find "${ROOT}/docs/adr" -type f -name '*.md' | sort)
fi

# --- ADR003: an amendment is appended, and only appended -----------------------
#
# ADR 0013 (#147) establishes the one lighter-than-supersession mechanism this
# repository has: a dated entry APPENDED to an "## Amendments" section at the
# end of an accepted ADR, recording that a statement of fact in the body has
# become false. The body itself is still never edited.
#
# That convention needs a gate for the reason CLAUDE.md section 8 gives for
# banning pull_request_target with a rule rather than a paragraph: the two
# things it distinguishes -- appending a note, and editing the body while
# calling it an amendment -- produce diffs that look similar in review and are
# opposites in what they do to the record. Three properties are checkable from
# the file alone:
#
#   one section   a second "## Amendments" heading is a pile, not a log
#   last section  anything after it means the note went INTO the body
#   dated entries an undated note cannot be placed against the ADR's own date
#
# Whether the change was literally an append is a property of the diff, not of
# the file, and is deliberately NOT checked here -- a rule that reads git
# history would not run on the bare clone this script is written for.
#
# Matched on '^## Amendments' anchored at a level-2 heading. An ADR that
# DISCUSSES the convention -- 0013 does -- names it as a '### Amendments'
# sub-heading, and shows the shape it prescribes inside a fence. Neither is the
# section, so the fences are blanked before anything is matched: without that,
# the rule would make its own ADR unwritable, because 0013's worked example puts
# '## Amendments' at column one and '## Consequences' after it.

# Replace every fenced line, and the fence markers, with a blank line. Line
# NUMBERING is preserved -- the section's position matters and an editor's line
# numbers are what a reader has -- so this blanks rather than deletes. Only
# backtick fences: this repository writes no tilde-fenced block, and a rule that
# guesses at a syntax nobody uses is a rule nobody can predict.
strip_fences() {
  awk '
    /^[[:space:]]*```/ { infence = !infence; print ""; next }
    { print (infence ? "" : $0) }
  ' "$1"
}

#
# Every message carries the line the reader has to go and look at. An ADR here
# runs to several hundred lines, and "something follows it" without a number
# sends the reader back to scroll for what -- the same complaint #118 made of
# ADR001's old message. The numbers are the FILE's, which is what `strip_fences`
# blanking rather than deleting is for.

check_adr_amendments() {
  local adr base body start after following entries numbered undated
  while IFS= read -r adr; do
    [ -n "${adr}" ] || continue
    base="$(basename "${adr}")"
    body="$(strip_fences "${adr}")"

    # Line numbers of every level-2 Amendments heading, oldest first.
    start="$(printf '%s\n' "${body}" | grep -n '^## Amendments[[:space:]]*$' | cut -d: -f1)"
    [ -n "${start}" ] || continue

    if [ "$(printf '%s\n' "${start}" | wc -l | tr -d '[:space:]')" -gt 1 ]; then
      report ADR003 "docs/adr/${base}: two '## Amendments' sections, at lines $(printf '%s' "${start}" | tr '\n' ' ' | sed 's/ $//' | sed 's/ / and /g'); an amendment is a new dated entry in the one section, not a second section (ADR 0013)"
      continue
    fi

    after="$(printf '%s\n' "${body}" | tail -n +"$((start + 1))")"

    following="$(printf '%s\n' "${after}" | grep -n -m 1 '^## ')"
    if [ -n "${following}" ]; then
      report ADR003 "docs/adr/${base}: '## Amendments' (line ${start}) must be the last section, but '${following#*:}' follows it at line $((start + ${following%%:*})); an amendment is appended to the end of the file, never inserted into the body (ADR 0013)"
      continue
    fi

    entries="$(printf '%s\n' "${after}" | grep -n '^-[[:space:]]')"
    if [ -z "${entries}" ]; then
      report ADR003 "docs/adr/${base}: '## Amendments' (line ${start}) has no entries; a section that records nothing reads as though it records something (ADR 0013)"
      continue
    fi

    # Every top-level bullet is an entry and every entry is dated. A wrapped
    # entry continues on an INDENTED line, which is not matched here, so a
    # paragraph-length amendment is not read as a pile of undated ones.
    #
    # The date's SHAPE is checked, not its validity: "2026-13-99" passes. A
    # calendar in bash 3.2 without GNU date is not worth the lines, and the
    # failure it would catch -- a typo in a date nobody disputes -- is not the
    # one this rule exists for.
    while IFS= read -r numbered; do
      [ -n "${numbered}" ] || continue
      undated="${numbered#*:}"
      report ADR003 "docs/adr/${base}: line $((start + ${numbered%%:*})): amendment entry must open with a bold ISO date, as in \"- **2026-09-05** — ...\"; found \"${undated}\" (ADR 0013)"
    done < <(printf '%s\n' "${entries}" | grep -vE '^[0-9]+:- \*\*[0-9]{4}-[0-9]{2}-[0-9]{2}\*\*[[:space:]]')
  done < <(find "${ROOT}/docs/adr" -type f -name '*.md' | sort)
}

if [ -d "${ROOT}/docs/adr" ]; then
  check_adr_amendments
fi

# --- Result -------------------------------------------------------------------

if [ "${findings}" -gt 0 ]; then
  printf '\n%s repository-rule violation(s). See docs/adr/0005-tech-stack.md and CONTRIBUTING.md.\n' \
    "${findings}" >&2
  exit 1
fi

printf 'check-repo-rules: clean (%s)\n' "${ROOT}"
