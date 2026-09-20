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
#   LIC006  every path in .spdx-exempt exists, and none of them is a glob
#   LIC003  every package manifest declares the licence its path requires
#   LIC004  every leaf package under packages/ or apps/ carries its own LICENSE
#   SCOPE001 no ANT+ reference in any source tree OR package manifest
#           (owner decision D2, and #15's fifth criterion)
#   WF001   no pull_request_target trigger in .github/workflows/
#   ADR001  no two ADRs share a number
#   ADR002  every ADR filename is NNNN-kebab-case.md
#   ADR003  an ADR's "## Amendments" section is single, last, dated, and in
#           date order -- and no unclosed fence hides it
#   ADR004  an ADR declares Status, Context, Decision and Consequences --
#           CLAUDE.md section 7's sentence, which nothing enforced (#416)
#   REL001  no signing key material is committed anywhere (#95)
#   REL002  the Android build targets at least API 36 (#95)
#   XML001  no "--" inside an XML comment (#225)
#   XML002  no XML comment left unclosed (#225)
#   XML003  no CDATA section left unclosed -- the construct that used to switch
#           XML001 and XML002 off for the rest of the file (#229)
#   XML004  no processing instruction left unclosed (#229)
#   ASSET001 every committed binary is named in ASSETS.toml (#339)
#   ASSET002 every path ASSETS.toml names is really there (#339)
#   ASSET003 every named file reproduces its recorded SHA-256 (#339)
#   ASSET004 every entry's licence is permitted where the file lands (#339)
#   ASSET005 ASSETS.toml itself is present and parses (#339)
#   ASSET006 an entry under a licence that REQUIRES attribution records it
#           -- creator, url and whether it was modified (#357, ADR 0023)
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

# --- The trees this repository does not author --------------------------------
#
# `find` arguments, in ONE place, because more than one rule needs them and a
# second copy is a fourth list to keep in step. `.prettierignore` and
# `eslint.config.js` already carry their own for reasons of their own -- Prettier
# reads only the ROOT `.gitignore` and not Capacitor's nested one, and ESLint
# needs Gradle's build output out of its project service -- and #225 asked for
# XML001/XML002 to prune "the same list check-repo-rules.sh already applies
# rather than retyping it". Retyping it here would have made a FOURTH copy that
# could disagree with the other three; an array makes it one copy inside this
# file, used by every walk in it.
#
# `dist`, `build` and `coverage` are build output. `node_modules` and `.git` are
# not ours at all. The last three are the Capacitor trees that `cap sync`
# regenerates and that Capacitor's own nested `.gitignore` therefore keeps out
# of the repository: they are pruned rather than exempted because they do not
# exist in a clean clone, and an entry in `.spdx-exempt` naming an absent file is
# itself a LIC006 violation. The copied web build -- full of bundled `.js` and
# `.css` -- would otherwise make this checker green in CI and red for anyone who
# has run a sync.
#
# ⚠️ An indexed array rather than an associative one, and expanded with
# `"${GENERATED[@]}"` rather than interpolated into a string: this script targets
# the bash on a bare macOS clone, which is 3.2, and a `find` expression that went
# through word splitting would break on the first path containing a space.
#
# ⚠️ `fixtures` is deliberately NOT here, and #229 is where that was settled.
# REL001 used to walk its own inline list which excluded it, beside this one
# which does not; the two disagreed and nobody could say which was right. A
# fixture tree is code this repository AUTHORS and commits, so a key committed
# there is exactly as permanent as a key committed anywhere else -- and the
# content half of REL001 never excluded it in the first place, so the rule
# already disagreed with itself. The resolution is one list: generated output is
# pruned, authored trees are not.
#
# ⚠️ `.claude`, `.gradle` and `.DS_Store` were added by #339, and the reason is
# worth stating because the first two were invisible until a rule walked for
# CONTENT rather than for an extension. All three are ignored -- `.gitignore`
# names `.claude/` and `.DS_Store`, and Capacitor's `apps/mobile/android/
# .gitignore` names `.gradle/` -- so nothing under any of them can be committed
# from this repository, which is the property every rule here is really asking
# about. They are pruned rather than exempted for the same reason the Capacitor
# trees are: they are absent from a clean clone.
#
# What made them worth finding: `.claude/worktrees/` holds git worktrees of
# OTHER branches, which is whole checkouts of this repository. Before #339 this
# walk descended into all of them, so `check-repo-rules.sh` on a machine with
# six worktrees read 3194 files instead of 893 and took 18 s instead of 2 s --
# and REL001's `PRIVATE KEY` grep ran over every one of them. Nothing went red,
# because another branch of this repository passes this repository's rules, so
# there was no symptom until #339's ASSET001 reported another branch's binaries
# as unnamed. `.prettierignore` already carries `.claude/` for the same reason
# and says so at length; this is the same local-only red, one gate across.
#
# ⚠️ REL001 is the rule this costs something, and the cost is named rather than
# glossed: it is the rule whose violation cannot be undone, and #229 resolved an
# earlier disagreement about its reach "towards scanning MORE". Pruning here
# scans less. It is still right, because all three are ignored wholesale -- a key
# under any of them cannot reach a commit from this checkout at all, and a key
# committed on the branch a worktree holds is REL001's business on that branch,
# where this same script runs.
GENERATED=(
  -name node_modules -o -name dist -o -name build -o -name coverage -o -name .git
  -o -name .claude -o -name .gradle -o -name .DS_Store
  -o -name capacitor-cordova-android-plugins
  -o -path '*/main/assets/public'
  -o -path '*/main/res/xml/config.xml'
)

# Every file this repository authors: the walk above, with nothing else added.
# REL001 uses it for both of its halves and the XML rules use the same prune, so
# a tree that is invisible to one rule is invisible to all of them rather than
# to whichever list was edited last.
repo_files() {
  find "${ROOT}" \( "${GENERATED[@]}" \) -prune -o -type f -print
}

# The same walk, NUL-separated, for the one consumer that hands its output to
# another program rather than reading it line by line. A newline is a legal
# character in a filename, and `tr '\n' '\0'` over the list above would turn one
# such name into two arguments that match nothing -- a file silently skipped by
# the rule whose violation cannot be undone.
repo_files_z() {
  find "${ROOT}" \( "${GENERATED[@]}" \) -prune -o -type f -print0
}

# Source files we expect to carry an SPDX header. Data and generated formats are
# excluded because a header cannot be added to them without corrupting them.
#
# ⚠️ The Kotlin, Java, Gradle and Android XML extensions are here for #87's
# Android shell. XML is the one that needed a decision rather than a line: an
# `AndroidManifest.xml` we hand-edit is ours and carries the header, and a
# launcher icon that `cap add android` wrote from `@capacitor/cli`'s MIT
# template is not ours and must not claim to be. Those are named, one exact path
# at a time, in `.spdx-exempt` -- see LIC006, which is what stops that list
# growing into a blanket.
source_files() {
  local dir="$1"
  [ -d "${dir}" ] || return 0
  find "${dir}" \
    \( "${GENERATED[@]}" \) -prune -o \
    -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \
               -o -name '*.mjs' -o -name '*.cjs' -o -name '*.css' -o -name '*.sh' \
               -o -name '*.kt' -o -name '*.kts' -o -name '*.java' \
               -o -name '*.gradle' -o -name '*.xml' \) -print
}

# --- .spdx-exempt: generated scaffolding, named one exact path at a time ------
#
# `cap add android` writes about twenty files from `@capacitor/cli`'s MIT
# template. Stamping `AGPL-3.0-or-later` on them would be wrong twice over: they
# are not our authorship, and MIT requires its notice to travel with a
# substantial portion of the work, which an AGPL header replacing it does not do.
# So they are exempt -- and the exemption is a list of exact paths, with no glob
# syntax accepted, because a glob is how an exemption for twenty files silently
# becomes an exemption for the twenty-first that somebody should have read.
EXEMPT_FILE="${ROOT}/.spdx-exempt"

exempt_paths() {
  [ -f "${EXEMPT_FILE}" ] || return 0
  sed -e 's/#.*//' -e 's/[[:space:]]*$//' "${EXEMPT_FILE}" | grep -v '^$'
}

is_exempt() {
  local relative="$1" entry
  while IFS= read -r entry; do
    [ "${entry}" = "${relative}" ] && return 0
  done < <(exempt_paths)
  return 1
}

# The SPDX identifier must appear in the file's opening comment block. We allow
# the first five lines rather than only the first, because a shebang and a
# generated-file banner both legitimately precede it.
spdx_of() {
  head -n 5 "$1" | sed -n 's/.*SPDX-License-Identifier:[[:space:]]*\([A-Za-z0-9.+-]*\).*/\1/p' | head -n 1
}

# --- LIC001 / LIC002: SPDX header matches the directory ----------------------

check_headers() {
  local dir="$1" want="$2" rule="$3" file got relative
  while IFS= read -r file; do
    [ -n "${file}" ] || continue
    relative="${file#"${ROOT}"/}"
    is_exempt "${relative}" && continue
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

# --- LIC006: every exemption names a file that is really there ---------------
#
# An exemption list is the classic vacuous pass: it costs nothing to add a line
# and nothing ever tells you the line stopped meaning something. So a stale
# entry is a violation. Two things follow, and both are the point. A file
# regenerated under a new name lands OUTSIDE the list and fails LIC001/LIC002
# until somebody rules on it, which is the fail-closed direction. And a
# speculative entry -- exempting a path before the file exists -- cannot be
# added at all.
#
# A directory is refused for the same reason a glob is, and separately, because
# `[ -e ]` would happily accept one: an entry naming `apps/mobile/android` reads
# in review as a blanket over the tree, and whether it behaves as one is then a
# property of how `is_exempt` happens to compare strings. Refusing it makes the
# list mean one thing.
check_exemptions() {
  local entry
  while IFS= read -r entry; do
    case "${entry}" in
      *'*'* | *'?'* | *'['*)
        report LIC006 ".spdx-exempt: ${entry}: glob syntax is not accepted; name each file"
        continue
        ;;
      /* | *'..'*)
        report LIC006 ".spdx-exempt: ${entry}: entries are repository-relative paths"
        continue
        ;;
    esac
    if [ -d "${ROOT}/${entry}" ]; then
      report LIC006 ".spdx-exempt: ${entry}: names a directory; exempt each file"
      continue
    fi
    [ -e "${ROOT}/${entry}" ] || \
      report LIC006 ".spdx-exempt: ${entry}: no such file; a stale exemption is not an exemption"
  done < <(exempt_paths)
}

check_exemptions

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

# ⚠️ **And the manifests, which `source_files` does not return.** #15's fifth
# acceptance criterion is that "no ANT+ code, dependency, permission or string
# appears anywhere in the client, asserted by grep in CI", and it calls that the
# thing "that stops the scope quietly returning". Three of those four were
# covered: code by the extension list, permission by `*.xml` reaching an
# `AndroidManifest.xml` since #87, string by both. **A dependency was not** --
# `source_files` returns no `.json` at all, so `"ant-plus": "^1.0.0"` in a
# `package.json` passed a rule written to forbid exactly that.
#
# It is a separate loop rather than a `.json` entry in `source_files`, because
# that function's other caller is the SPDX header check and a `package.json`
# carries no header. Scoped to manifests rather than to every `.json` for the
# same reason the loop above is scoped to source: a fixture or a lockfile may
# legitimately mention a name it is not adopting.
for dir in "${ROOT}/packages" "${ROOT}/apps"; do
  [ -d "${dir}" ] || continue
  while IFS= read -r file; do
    [ -n "${file}" ] || continue
    if grep -qiE "${ANTPLUS_RE}" "${file}" 2>/dev/null; then
      report SCOPE001 "${file#"${ROOT}"/}: an ANT+ dependency is out of scope permanently (owner decision D2)"
    fi
  done < <(find "${dir}" -name node_modules -prune -o -type f -name package.json -print)
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

# A numbered (`grep -n`) amendment entry that opens with a bold ISO date. ONE
# definition, used with `grep -E` to select the dated entries and with `grep -vE`
# to select the undated ones, because two spellings of "dated" drift and the
# pair are each other's complement by construction.
DATED_ENTRY='^[0-9]+:-[[:space:]]+\*\*[0-9]{4}-[0-9]{2}-[0-9]{2}\*\*[[:space:]]'

check_adr_amendments() {
  local adr base body start after following entries numbered undated
  local fences date previous
  while IFS= read -r adr; do
    [ -n "${adr}" ] || continue
    base="$(basename "${adr}")"

    # An UNCLOSED fence would blank the whole rest of the file, which does not
    # weaken this rule -- it switches it off, silently, for that ADR. The
    # heading disappears, so `start` is empty and the file is skipped whole:
    # a section that is not last, an entry with no date and a second section
    # all pass. Reported before anything else is read, because everything
    # after it is read through `strip_fences`. #150's review found the same
    # shape in the test harness (a guard that printed a failure and could not
    # fail the build); a rule a typo can disable is worse than one that misses
    # a case, because nothing tells you it happened.
    fences="$(grep -c '^[[:space:]]*```' "${adr}")"
    if [ $((fences % 2)) -ne 0 ]; then
      report ADR003 "docs/adr/${base}: unclosed code fence (${fences} fence lines, an odd number); everything after the last one is read as code, which would hide an '## Amendments' section and anything wrong inside it (ADR 0013)"
      continue
    fi

    body="$(strip_fences "${adr}")"

    # Line numbers of every level-2 Amendments heading, oldest first.
    start="$(printf '%s\n' "${body}" | grep -n '^## Amendments[[:space:]]*$' | cut -d: -f1)"
    [ -n "${start}" ] || continue

    if [ "$(printf '%s\n' "${start}" | wc -l | tr -d '[:space:]')" -gt 1 ]; then
      report ADR003 "docs/adr/${base}: two '## Amendments' sections, at lines $(printf '%s' "${start}" | tr '\n' ' ' | sed 's/ $//' | sed 's/ / and /g'); an amendment is a new dated entry in the one section, not a second section (ADR 0013)"
      continue
    fi

    after="$(printf '%s\n' "${body}" | tail -n +"$((start + 1))")"

    # ANY heading at column one, not only a level-2 one. "Nothing follows the
    # section" is the rule; a '# Appendix' or a '### Postscript' after it is the
    # same defect as a '## Notes', and matching '^## ' alone let the first of
    # those through (#150's review). An entry is a bullet, so no legitimate
    # amendment puts a heading here.
    #
    # A setext heading -- 'Notes' underlined with hyphens -- is deliberately NOT
    # matched. This repository writes none, a row of hyphens at column one is
    # also a horizontal rule and a table separator, and `strip_fences` already
    # settles the same question the same way: a rule that guesses at a syntax
    # nobody uses is a rule nobody can predict.
    following="$(printf '%s\n' "${after}" | grep -n -m 1 -E '^#{1,6} ')"
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
    #
    # `-[[:space:]]` here and in the entry match above, not `- `: a tab after
    # the bullet hyphen is a list item in every Markdown renderer, and matching
    # it as an entry while requiring a literal space to see its date reported a
    # correctly dated entry as undated (#150's review). The two patterns have to
    # admit the same whitespace or the second is judging a line the first
    # already misread.
    while IFS= read -r numbered; do
      [ -n "${numbered}" ] || continue
      undated="${numbered#*:}"
      report ADR003 "docs/adr/${base}: line $((start + ${numbered%%:*})): amendment entry must open with a bold ISO date, as in \"- **2026-09-05** — ...\"; found \"${undated}\" (ADR 0013)"
    done < <(printf '%s\n' "${entries}" | grep -vE "${DATED_ENTRY}")

    # Dates never go backwards. This is the one part of "it was an append" that
    # IS visible in the file: an entry put at the TOP of the section -- the
    # natural move if you read the section as a newest-first changelog -- leaves
    # an older date below a newer one, and D-4 makes the section an append-only
    # log. It cannot catch an append carrying a backdated date, and does not
    # claim to; ISO dates sort lexically, which is why no date parsing happens.
    #
    # A STRING comparison, deliberately, not `-lt` on the digits: this text
    # comes from a fork's tree, and arithmetic is the one context where a
    # `$(( ))` inside it would be evaluated. Both operands are fixed-width and
    # matched by DATED_ENTRY, so they are digits and hyphens in the same
    # positions, and no locale collates ASCII digits out of order.
    previous=""
    while IFS= read -r numbered; do
      [ -n "${numbered}" ] || continue
      date="${numbered#*\*\*}"
      date="${date:0:10}"
      if [ -n "${previous}" ] && [[ "${date}" < "${previous}" ]]; then
        report ADR003 "docs/adr/${base}: line $((start + ${numbered%%:*})): amendment entry dated ${date} follows one dated ${previous}; the section is an append-only log, so its dates never go backwards (ADR 0013 D-4)"
      fi
      previous="${date}"
    done < <(printf '%s\n' "${entries}" | grep -E "${DATED_ENTRY}")
  done < <(find "${ROOT}/docs/adr" -type f -name '*.md' | sort)
}

if [ -d "${ROOT}/docs/adr" ]; then
  check_adr_amendments
fi

# --- ADR004: an ADR declares the four sections CLAUDE.md section 7 requires ---
#
# CLAUDE.md section 7: *"ADRs: docs/adr/NNNN-kebab-case.md, with **Status,
# Context, Decision, Consequences**"*. Until #416 that sentence was enforced by
# nothing. ADR001 checks numbers, ADR002 checks filenames and ADR003 checks the
# shape of an Amendments section -- all three are about numbering and
# amendments, and none of them reads the document's own required structure.
# Measured on 2026-09-20: deleting the `- **Status**: Accepted` line from
# docs/adr/0024-offline-and-caching-posture.md left this script reporting clean
# at exit 0.
#
# That is the "a rule that cannot fire" shape this file already carries five
# instances of (DOC002, XML002, XML003, XML004, LIC006's stale entry) -- sitting
# this time INSIDE the rule written because of it. ADR003 exists to stop an
# amendment section being malformed, and the document around it could be
# missing every section the convention names.
#
# Status is the one that costs something. It is how a reader knows whether a
# decision is Accepted, Proposed or Superseded, and this repository's whole
# practice rests on it: section 7 says an ADR is amended by a NEW ADR that
# supersedes it and that Status does not change on an amendment, so a document
# with no Status cannot be read against that rule at all.
#
# ## The matcher, decided deliberately (#416's fourth criterion)
#
# Section 7's wording is prose; the documents on disk are not. All 23 ADRs in
# the tree write Status as a bold label line -- `- **Status**: Accepted` -- and
# the other three as level-2 headings. A rule accepting only one of those
# spellings rejects a valid document; a rule accepting any line that CONTAINS
# the word passes a document that merely mentions it, which is most of them
# (every ADR here discusses its own consequences in prose). So:
#
#   Context, Decision, Consequences   a level-2 heading whose text is the word,
#                                     as a WHOLE word: `## Decision` and
#                                     `## Decision: what was chosen` both count,
#                                     `## Decisions` and a sentence containing
#                                     "the decision" do not.
#   Status                            the same heading form, OR a bold label at
#                                     the start of a line, with or without a
#                                     list bullet: `- **Status**:` and
#                                     `**Status**:` both count. It is metadata
#                                     rather than a section of prose, which is
#                                     why it alone gets the second form -- and
#                                     why the other three deliberately do not:
#                                     a `- **Decision**: yes` line would be a
#                                     summary, not the section section 7 asks
#                                     for.
#
# Level 2 exactly, not `#{1,6}`: `## ` is what every ADR here uses and what
# ADR003 anchors its own matching on, and a `### Decision` inside a Context
# section is a sub-heading rather than the decision.
#
# ## What it deliberately does not check
#
# Whether the Decision section says anything sensible. This is a shape rule, and
# #416 says so in as many words. It also does not reach docs/spikes/ or
# docs/validation/: section 7 scopes the ADR00* rules to docs/adr/ and says a
# spike "is not an ADR and does not decide anything".
#
# ⚠️ Fences are blanked first, for ADR003's reason and with the same
# consequence. ADR 0013 shows the shape it prescribes inside a fence, and #416's
# own successor would want to quote `## Decision` in one; a fenced example is an
# example, not a section. An UNCLOSED fence would blank the rest of the file and
# make every section after it vanish -- so this rule would fire on a document
# that is fine, blaming the wrong thing. ADR003 already reports an odd fence
# count and the build is red either way, so this skips the file and says so
# rather than reporting a second, misleading finding. `check-repo-rules.test.sh`
# carries the case that proves the build still goes red there.
ADR_REQUIRED_SECTIONS="Status Context Decision Consequences"

# Appended to the message for Status alone, which is the one section with a
# second accepted spelling and therefore the one whose failure message would
# otherwise send an author to add a heading no ADR in the tree has.
ADR_STATUS_HINT=" (or a '- **Status**:' line)"

check_adr_sections() {
  local adr base body fences section hint
  while IFS= read -r adr; do
    [ -n "${adr}" ] || continue
    base="$(basename "${adr}")"

    fences="$(grep -c '^[[:space:]]*```' "${adr}")"
    if [ $((fences % 2)) -ne 0 ]; then
      # ADR003 owns this one. See the note above.
      continue
    fi

    body="$(strip_fences "${adr}")"

    for section in ${ADR_REQUIRED_SECTIONS}; do
      hint=""
      if printf '%s\n' "${body}" \
        | grep -qE "^##[[:space:]]+${section}([[:space:]]*$|[[:space:]]|:)"; then
        continue
      fi
      if [ "${section}" = "Status" ]; then
        if printf '%s\n' "${body}" | grep -qE '^-?[[:space:]]*\*\*Status\*\*[[:space:]]*:'; then
          continue
        fi
        hint="${ADR_STATUS_HINT}"
      fi
      report ADR004 "docs/adr/${base}: no '${section}' section; CLAUDE.md section 7 requires Status, Context, Decision and Consequences in every ADR, as a '## ${section}' heading${hint}"
    done
  done < <(find "${ROOT}/docs/adr" -type f -name '*.md' | sort)
}

if [ -d "${ROOT}/docs/adr" ]; then
  check_adr_sections
fi

# --- REL001: no signing key material, anywhere ---------------------------------
# #95's first acceptance criterion: *"signing keys are in CI secrets and NEVER in
# the repo -- a test or scan asserts no keystore or key material is committed"*.
#
# ⚠️ This is the one rule in this file whose violation cannot be undone by fixing
# it. A pushed commit is permanent regardless of what a later commit deletes, and
# an Android upload key that leaks is not rotatable: Play identifies the app by
# the key, so a compromised one is a compromised app identity. Secret scanning
# with push protection is on for this repository and would catch some of these,
# but it runs server-side after a push is attempted -- this runs on a bare clone,
# before, and with no toolchain.
#
# Matched by NAME rather than by content, deliberately. A keystore is a binary
# blob with no reliable magic this can grep for, and a rule that tried to read
# them would fail open on the one that was encrypted or renamed. Names are what a
# build tool requires, so a key that is actually usable by Gradle has one of
# them.
KEY_MATERIAL_NAMES='.*\.(jks|keystore|p12|pfx|key)$|^keystore\.properties$|^(release|upload)-key\.'

#
# ⚠️ Both halves walk `repo_files`, which is the shared prune list and nothing
# else (#229). They used to walk two different lists -- an inline one here that
# skipped `fixtures` and kept `coverage`, and the shared one that does the
# opposite -- and the two halves of this one rule therefore disagreed with each
# other: a PEM under `fixtures/` was reported while a `.jks` beside it was not.
# The disagreement is resolved towards scanning MORE, because this is the rule
# whose violation cannot be undone: `fixtures` is authored and committed, and
# `coverage` is build output that exists only on a machine that has run the
# suite, so reporting it would be a red that only ever appears locally.
check_no_key_material() {
  local candidates
  while IFS= read -r file; do
    [ -n "${file}" ] || continue
    base="$(basename "${file}")"
    relative="${file#"${ROOT}"/}"
    if printf '%s' "${base}" | grep -qE "${KEY_MATERIAL_NAMES}"; then
      report REL001 "${relative}: looks like signing key material; keys belong in CI secrets and never in the repository (#95)"
    fi
  done < <(repo_files | sort)

  # A PEM private key carries its own banner, so this one IS checkable by
  # content -- and it is the case a name rule misses, because a private key
  # pasted into a config file has whatever name that file had.
  #
  # `grep` is handed the same walk's output rather than being asked to recurse
  # with an exclusion list of its own, because `--exclude-dir` cannot express
  # the two path-shaped prunes at all.
  #
  # ⚠️ The guard on an empty walk is where the two `xargs` disagree, and the
  # disagreement is the reason it is here rather than a taste. Given no input at
  # all, the BSD one on macOS does not run the utility -- observed -- and the
  # GNU one on the CI runner runs it once with no operands, which is what
  # `--no-run-if-empty` exists to prevent and is a GNU extension this script
  # cannot use. `grep` with no file operands reads standard input. Whether that
  # returns immediately or waits forever then depends on what standard input
  # happens to be, which is not a thing a gate should depend on.
  candidates="$(repo_files)"
  [ -n "${candidates}" ] || return 0
  while IFS= read -r hit; do
    [ -n "${hit}" ] || continue
    relative="${hit#"${ROOT}"/}"
    # This script and its own suite name the banner in order to look for it.
    case "${relative}" in
      scripts/check-repo-rules.sh | scripts/check-repo-rules.test.sh) continue ;;
    esac
    report REL001 "${relative}: contains a PRIVATE KEY block (#95)"
  done < <(repo_files_z \
    | xargs -0 grep -lE -- '-----BEGIN [A-Z ]*PRIVATE KEY-----' 2>/dev/null | sort)
}

check_no_key_material

# --- REL002: the Android build targets a current API level --------------------
# #95: *"The app targets API 36 and the build fails if the target level regresses
# below it."* Google requires new apps and updates to target Android 16 (API 36);
# #95 records that sources disagree on the exact enforcement date and that Play
# Console is authoritative for the account.
#
# ⚠️ Checked here rather than in Gradle, and that is the point of the criterion.
# A Gradle assertion fails for whoever runs a build -- and CI does not build
# Android at all (CLAUDE.md section 4c). A rule that only fires inside a build
# nobody runs is a rule that never fires. This one runs on a bare clone, in the
# same CI step as every other repository rule.
#
# ⚠️ It reads every Gradle file under the Android project, not variables.gradle
# alone, and #95 is where that changed. The rule used to open ONE file, take the
# FIRST `targetSdkVersion` in it, and `return 0` the moment that file was
# absent -- which is the #142 shape (CLAUDE.md section 4e): a selector ASSERTED
# to exist rather than discovered, failing closed against editing the value it
# names and open against every other way the number reaches the build. Three
# regressions were green under it, and each is now a fixture:
#
#   * deleting variables.gradle and inlining the values into app/build.gradle --
#     a supported Capacitor layout -- removed the floor while looking like
#     tidying;
#   * a literal beside `targetSdkVersion` in app/build.gradle OVERRIDES the ext
#     property, so variables.gradle could say 36 while the shipped app targeted
#     33;
#   * `head -1` read the first assignment and Gradle applies the last, so a
#     lower value appended below a compliant one was invisible.
#
# The floor therefore follows the VALUE rather than a filename: a project that
# declares a compliant level anywhere passes, one that declares none at all
# fails, and every numeric declaration has to clear the floor.
MINIMUM_TARGET_SDK=36

# Every numeric target-API declaration in one Gradle file, as "<spelling> <n>".
#
# ⚠️ `targetSdk` as well as `targetSdkVersion`: the short spelling is the
# current Android Gradle Plugin DSL and sets the same thing, so a rule that knew
# only the old one would be switched off by a routine Gradle modernisation.
#
# ⚠️ A NUMERIC declaration. `targetSdkVersion rootProject.ext.targetSdkVersion`
# is the shipped app/build.gradle and is not a declaration of a level at all; a
# sweep that flagged it would be reverted within a day and the rule would go
# with it. Line comments are stripped first for the same reason -- a Gradle file
# is allowed to say what it used to target. A block comment is NOT stripped, so
# a commented-out literal inside one is a false positive: a loud one, which is
# the side to fail on.
target_sdk_declarations() {
  sed 's|//.*||' "$1" \
    | grep -oE '(^|[^A-Za-z0-9_])targetSdk(Version)?[[:space:]]*(=|\()?[[:space:]]*[0-9]+' \
    | grep -oE 'targetSdk(Version)?[[:space:]]*(=|\()?[[:space:]]*[0-9]+' \
    | sed -E 's/[[:space:]]*(=|\()?[[:space:]]*([0-9]+)$/ \2/'
}

check_android_target_sdk() {
  local android="${ROOT}/apps/mobile/android"
  local file relative declaration spelling level found=0 gradle_files=0
  # A clone with no Android project is not a violation: this rule is about
  # apps/mobile and must not fail every other tree.
  [ -d "${android}" ] || return 0

  while IFS= read -r file; do
    # `find` printing nothing still yields one empty line through a here-doc,
    # and passing that to `sed` reports a missing file rather than iterating
    # zero times.
    [ -n "${file}" ] || continue
    gradle_files=$((gradle_files + 1))
    relative="${file#"${ROOT}"/}"
    while IFS= read -r declaration; do
      [ -n "${declaration}" ] || continue
      found=1
      spelling="${declaration% *}"
      level="${declaration##* }"
      if [ "${level}" -lt "${MINIMUM_TARGET_SDK}" ]; then
        report REL002 "${relative}: ${spelling} ${level} is below the required ${MINIMUM_TARGET_SDK} (#95)"
      fi
    done <<EOF
$(target_sdk_declarations "${file}")
EOF
  done <<EOF
$(find "${android}" \( "${GENERATED[@]}" \) -prune -o \
    -type f \( -name '*.gradle' -o -name '*.gradle.kts' \) -print | sort)
EOF

  # ⚠️ "No Gradle file at all" is not "no target level": a directory named
  # android/ that holds no build script is not an Android project, and a
  # fixture tree built for some other rule is exactly that. The violation is a
  # project that HAS build scripts and declares no level in any of them.
  if [ "${gradle_files}" -gt 0 ] && [ "${found}" -eq 0 ]; then
    report REL002 "apps/mobile/android: declares no targetSdkVersion in any Gradle file, so nothing sets the target API level (#95)"
  fi
}

check_android_target_sdk

# --- XML001 / XML002 / XML003 / XML004: XML a parser will accept --------------
#
# #225. `apps/mobile/android/app/src/main/AndroidManifest.xml` shipped in #87 as
# XML that NO parser accepts: three of its prose comments contained `--`, which
# XML 1.0 section 2.5 forbids inside a comment. The first Gradle build ever run
# against this repository -- on 2026-09-09, months after the file landed --
# failed on it with `ManifestMerger2$MergeFailureException: Error parsing`.
#
# ⚠️ Nothing here caught it, and the reason is the shape this repository keeps
# shipping. LIC001/LIC002 DO scan `.xml` files -- but only for an SPDX
# identifier in the first five lines. Nothing in `check:repo` parsed XML or
# looked past line five, so a manifest no parser accepts passed every gate, and
# the only thing that would have noticed is a build nobody in the original
# environment could run (`apps/mobile/README.md` section 5). That is the one
# file whose correctness under merge IS #87's first acceptance criterion.
#
# The precedent is DOC002, not a new idea. `check-doc-links.sh` already carries
# a rule of exactly this shape -- a code fence that is never closed -- for
# exactly this reason: without it the fence state machine STICKS, everything
# after it is skipped, and the file reports clean. An unclosed XML comment does
# the same thing to a manifest, and it does something worse to a parser: every
# element after it disappears from the document. XML002 is that rule.
#
# The scan is a delimiter state machine rather than a regular expression,
# because a comment spans lines and `grep` sees one line at a time -- a per-line
# match for `--` would fire on every `--` in a table separator, an SPDX header
# comment's rule, or an Android `tools:` attribute, none of which are inside a
# comment at all.
#
# ⚠️ CDATA is tracked for one reason: a `<!--` inside `<![CDATA[ ... ]]>` is
# TEXT, not a comment. Without this, a well-formed file carrying one in a CDATA
# section would open a comment that never closes and fail XML002 -- a gate going
# red on a correct file, which is the failure mode that teaches people to stop
# running the gate. A processing instruction, `<?target ... ?>`, is tracked for
# exactly the same reason: `Comment` is not a production inside `PIContent`, so
# `<?php <!-- a -- b --> ?>` is valid XML that `xmllint` accepts and that #228
# reported as XML001. #228's body claimed zero false positives; that one is the
# exception, and this is where it was fixed rather than restated.
#
# ⚠️ XML003 and XML004 are why the two above can be believed at all (#229).
# Tracking a region that suppresses scanning is tracking a way to switch the
# scanner OFF: before #229 an unclosed `<![CDATA[` set the CDATA state, nothing
# ever cleared it, and XML001 and XML002 both went silent for the remainder of
# the file -- which is DOC002's sticking-fence failure, in the rule that exists
# because of DOC002. The reproduction is in #229: `xmllint` says "CData section
# not finished" and this checker said "clean", while a real `--` violation on
# the next line went unreported.
#
# The fix is not a rule bolted on at EOF. It is that closure is decided WHEN THE
# REGION OPENS, by asking whether its terminator occurs anywhere after it:
#
#   * terminator found  -- enter the region, exactly as before. A CDATA section
#     spanning twenty lines is legal and its contents are text.
#   * no terminator at all -- report it, treat the rest of THAT LINE as the
#     region's text, and carry on scanning the next line.
#
# That is what makes the difference reportable rather than silent, and it is why
# the second half matters as much as the first: a rule that only said "unclosed
# CDATA" at EOF would fail the build and STILL hide every violation after it.
#
# ⚠️ Recovering at the end of the opening line, rather than dropping the opener
# entirely, keeps the conservative reading: up to the newline those characters
# really are the region's content, so nothing there is reported. Recovery is
# conditional on there being no terminator in the whole file, which is what
# stops it firing on a perfectly legal multi-line CDATA section.
#
# ⚠️ **This is deliberately NOT full well-formedness validation, and the limits
# are recorded here rather than discovered later.** A stray `<`, a mismatched
# tag, an unquoted attribute and a bad character reference all still pass. Nor
# does it undo every blinding: a STRAY `<![CDATA[` or `<?` that does have a
# terminator later in the file suppresses the span between the two, and no
# amount of state machinery can tell that apart from a section somebody meant.
# What #229 removes is the case where the region never ends and the file reports
# clean regardless. Full validation needs `xmllint`, which is a tool rather than
# coreutils, and this is the bare-clone gate -- CLAUDE.md section 4a: *bash and
# coreutils only, no install, no network*. A narrow rule that always runs is
# worth more than a broad one that is skipped wherever the tool is missing.
# Whether to ALSO add `xmllint` as a CI step, on the `shellcheck` precedent, is
# a follow-up and was out of scope for #225 and #229 alike.
#
# ⚠️ The line is tokenised by marking its delimiters rather than walked with a
# moving position, and that is a cost fix rather than a style one (#229). The
# version this replaced took `substr($0, pos)` on every iteration, copying the
# whole remainder of the line each time: O(k x len) for k delimiters on one
# line. Measured on this repository's awk (one-true-awk 20200816, macOS) against
# a single line of `<!-- x --><a/>` repeated:
#
#              delimiters       before        after
#              40 002           2.4 s         0.23 s
#              80 002           8.5 s         0.61 s
#             160 002          37.5 s         1.9 s
#             320 002          (not run)      6.5 s
#
# Four times the time for twice the input is the quadratic curve rather than a
# constant factor, and it put a 1 MB minified document in the tens of seconds
# and an 8 MB one out of reach. ⚠️ The replacement is NOT flat either -- about
# three times for twice the input at these sizes, which is awk allocating one
# field per token and not the scan re-reading the line -- so the honest claim is
# that the delimiter count no longer multiplies the line length, not that the
# cost is linear. No `.xml` this repository authors is within three orders of
# magnitude of these numbers; the case they are here for is a generator writing
# one long line.
#
# ⚠️ `split` will not say WHICH delimiter it matched -- the fourth argument that
# reports the separators is a GNU extension, and this has to run under the awk
# on a bare macOS clone. Marking each delimiter and splitting on the marker is
# how the delimiter ends up being read rather than located, which matters
# because `substr(s, pos, 9)` is not a constant-time operation in this awk
# either: it counts UTF-8 characters from the start of the string, so a scan
# built on absolute positions stays quadratic however it finds them. That was
# measured too -- a position-based version of this same tokeniser took 20 s on
# the 160 002 line, against 1.9 s for this one.
xml_comment_findings() {
  awk '
    function flag(kind, line, opened) {
      printf "%s\t%d\t%d\n", kind, line, opened
    }

    # A line with every delimiter wrapped in a marker, so that splitting on the
    # marker yields alternating text and delimiters and the delimiter can be
    # READ rather than located. Seven passes over the line, then one split, all
    # of them linear in its length.
    #
    # ⚠️ The markers are U+0001, which XML 1.0 forbids in a document at all --
    # not merely discourages -- so a line carrying one is already not XML. Any
    # that are there are replaced with a space first, because a marker arriving
    # in the input would otherwise be read as a delimiter boundary.
    #
    # ⚠️ The passes run longest delimiter first, and that ordering is safe
    # rather than lucky: no delimiter here is a substring of another, and each
    # pass leaves behind only text the later passes cannot match inside. The
    # result is the same token sequence a single leftmost-first scan produces --
    # `<!-->` is `<!--` followed by a stray `>`, and `<?>` is `<?` followed by a
    # stray `>`, in both readings.
    function marked(s) {
      gsub(/\001/, " ", s)
      gsub(/<!\[CDATA\[/, "\001<![CDATA[\001", s)
      gsub(/<!--/, "\001<!--\001", s)
      gsub(/-->/, "\001-->\001", s)
      gsub(/\]\]>/, "\001]]>\001", s)
      gsub(/<\?/, "\001<?\001", s)
      gsub(/\?>/, "\001?>\001", s)
      return s
    }

    # Pass one over a line: the index of its LAST CDATA and processing
    # instruction terminator, so that an opener can ask whether one follows it
    # without searching the rest of the file from where it stands.
    function survey(n,   part, m, i) {
      lastcdataclose[n] = 0
      lastpiclose[n] = 0
      m = split(text[n], part, "\001")
      for (i = 1; i <= m; i++) {
        if (part[i] == "]]>") lastcdataclose[n] = i
        else if (part[i] == "?>") lastpiclose[n] = i
      }
    }

    # Pass two: the state machine itself.
    #
    # ⚠️ The content of a comment is judged as it goes rather than assembled.
    # Both things XML001 asks about survive that -- a `--` is either inside one
    # field or straddles two, and the only delimiter that can begin with a
    # hyphen is the one that CLOSES the comment -- and assembling it would put
    # the quadratic cost back, one comment instead of one line: appending k
    # fields to a growing string copies that string k times.
    #
    # ⚠️ `linebad` and `last` are reset at the start of every line, which is not
    # tidiness: a hyphen ending one line and another opening the next is NOT a
    # double hyphen, because the line break is a character between them and
    # libxml2 accepts it. That is a case in the suite, found by running the rule
    # against xmllint over four hundred generated documents.
    function scan(n,   part, m, i, f, linebad, last) {
      linebad = 0
      last = ""
      m = split(text[n], part, "\001")
      for (i = 1; i <= m; i++) {
        f = part[i]
        if (incdata) {
          if (f == "]]>") incdata = 0
          continue
        }
        if (inpi) {
          if (f == "?>") inpi = 0
          continue
        }
        if (incomment) {
          if (f != "-->") {
            if (index(f, "--") > 0) linebad = 1
            else if (last == "-" && substr(f, 1, 1) == "-") linebad = 1
            if (f != "") last = substr(f, length(f), 1)
            continue
          }
          # "--->": the content ends on a hyphen that abuts the terminator,
          # which the XML grammar (Comment ::= *(Char - "-" | "-" (Char - "-"))
          # "-->") forbids for the same reason.
          if (linebad || last == "-") flag("XML001", n, opened)
          incomment = 0
          linebad = 0
          last = ""
          continue
        }
        if (f == "<!--") {
          incomment = 1
          opened = n
          linebad = 0
          last = ""
          continue
        }
        if (f == "<![CDATA[") {
          if (lastcdataclose[n] > i || cdatacloseafter[n]) { incdata = 1; continue }
          flag("XML003", n, n)
          return
        }
        if (f == "<?") {
          if (lastpiclose[n] > i || picloseafter[n]) { inpi = 1; continue }
          flag("XML004", n, n)
          return
        }
        # A "-->" or a "]]>" outside any region is ordinary text.
      }
      # A comment still open at the end of the line: the trailing-hyphen rule is
      # deliberately NOT applied here. It is about the character that abuts the
      # terminator, and there is no terminator on this line.
      if (incomment && linebad) flag("XML001", n, opened)
    }

    { text[NR] = marked($0) }

    END {
      for (n = 1; n <= NR; n++) survey(n)
      # Does a terminator appear on any LATER line? Accumulated backwards, so
      # the question costs nothing at the point an opener asks it.
      cdatacloseafter[NR] = 0
      picloseafter[NR] = 0
      for (n = NR - 1; n >= 1; n--) {
        cdatacloseafter[n] = (lastcdataclose[n + 1] > 0) || cdatacloseafter[n + 1]
        picloseafter[n] = (lastpiclose[n + 1] > 0) || picloseafter[n + 1]
      }
      incomment = 0; incdata = 0; inpi = 0; opened = 0
      for (n = 1; n <= NR; n++) scan(n)
      # Only a comment can still be open here. A CDATA section or a processing
      # instruction is entered ONLY when its terminator was already known to
      # follow, so neither can reach the end of the file unclosed -- which is
      # why there is no branch for them: a branch that cannot fire is the thing
      # this rule set exists to stop shipping.
      if (incomment) flag("XML002", opened, opened)
    }
  ' "$1"
}

check_xml_comments() {
  local file relative kind line opened tab
  # A literal tab, built rather than typed: an editor that expands tabs would
  # silently turn this field separator into spaces, and the failure would be a
  # rule that reports nothing rather than a syntax error.
  tab="$(printf '\t')"
  while IFS= read -r file; do
    [ -n "${file}" ] || continue
    relative="${file#"${ROOT}"/}"
    while IFS="${tab}" read -r kind line opened; do
      [ -n "${kind}" ] || continue
      case "${kind}" in
        XML001)
          report XML001 "${relative}:${line}: \"--\" inside the XML comment opened at line ${opened}; XML 1.0 section 2.5 forbids it and no parser will read this file (#225)" ;;
        XML002)
          report XML002 "${relative}:${line}: XML comment is never closed; everything after it is swallowed, so the file parses as something other than what it looks like -- or not at all (#225)" ;;
        XML003)
          report XML003 "${relative}:${line}: <![CDATA[ opened here and never closed; a parser stops reading the document at this point, and before #229 it stopped this checker too (#229)" ;;
        XML004)
          report XML004 "${relative}:${line}: processing instruction opened here and never closed with \"?>\"; everything after it is read as instruction data (#229)" ;;
      esac
    done < <(xml_comment_findings "${file}")
  done < <(find "${ROOT}" \( "${GENERATED[@]}" \) -prune -o -type f -name '*.xml' -print | sort)
}

check_xml_comments

# --- ASSET001..ASSET005: provenance for every committed binary ----------------
#
# #339, filed before the first model file exists rather than after. The owner
# has ruled on #302 that the game adopts a CC0 model pack, and a `.glb` landing
# in this tree would arrive with no SPDX header (it is a binary, and the header
# has to be in the first five lines of a text file), no licence check (DEP001
# reads npm manifests, and a committed file is in none), no provenance and no
# integrity. Every gate in this repository would have been green about it.
#
# That is the shape this repository has now refused four times -- #299 (a
# generated artefact nothing verified), #318 (a manifest test reading the wrong
# file), #142 (a gate selecting on the wrong thing), #278 (a unit nothing calls)
# -- and its common property is that the green result is indistinguishable from
# the correct one.
#
# So: one text record, `ASSETS.toml` at the repository root, with one entry per
# committed binary. Text, so that `git diff` shows a provenance change in review
# and so that this checker can read it with no toolchain at all.
#
# ⚠️ **Discovery is a walk for BINARIES, not a list of known extensions**, and
# that is the whole design. An extension list fails closed against DELETING a
# format and open against ADDING one: name `.glb` and the `.gltf` beside it is
# invisible, which is #142's defect exactly. Asking whether a file could carry
# an SPDX header at all is a question about the file, so a format nobody has
# thought of is covered on the day it arrives.
#
# ⚠️ Why at the repository ROOT rather than `assets/MANIFEST.toml`, which #339
# floats: the assets themselves will land under `apps/web` (§4h -- the Android
# shell ships apps/web's build), so an `assets/` directory holding only a
# manifest would read as the place the assets live. Root is where `.spdx-exempt`
# already keeps the other list of exact paths this repository maintains by hand.
#
# ⚠️ **§Limits -- read these before taking a green run for more than it is.**
#
#   * "Binary" is decided by CONTENT: a NUL byte in the first
#     ASSET_SNIFF_BYTES. That is git's own rule for the same question, and it
#     is why `.glb`, `.png`, `.jar` and `.fit` are all found without being
#     named. It also means a TEXT-format asset -- a `.gltf`, an `.obj`, an
#     `.svg` -- is NOT discovered. Those are no worse off than before (LIC001's
#     extension list never covered them either) and the manifest may name one
#     voluntarily, which buys ASSET002/ASSET003/ASSET004 over it. Closing that
#     half needs a rule about which text extensions are assets, which is the
#     extension list this one exists to avoid; it is a separate decision.
#   * A zero-byte file carries no NUL and is therefore text by this rule. It
#     also carries nothing to licence. `packages/fit/fixtures/corpus/
#     zero-length.fit` is named in the manifest anyway, because naming it is
#     free and it keeps the corpus's twelve files together.
#   * A recorded SHA-256 pins WHAT IS COMMITTED. It does not prove the bytes
#     are the upstream artefact they claim to be -- nothing here can, without
#     the network this gate refuses to need. `apps/mobile/README.md` §4 records
#     that `gradle-wrapper.jar` is exactly such a file; the manifest makes a
#     later SUBSTITUTION visible, which is the half that is checkable here.
#   * A `path` must be repository-relative and may contain no `..`, so an entry
#     cannot reach outside this tree -- but a committed SYMLINK inside it can,
#     and `[ -f ]` and `shasum` both follow one. Discovery never does (`find
#     -type f` does not match a symlink), so this only affects a file somebody
#     deliberately named. What such an entry can produce is a SHA-256 of the
#     link's target in a failure message, which is why it is recorded here
#     rather than guarded against: the job this runs in holds no secrets (§8),
#     and a digest of a file is not its contents.
#   * Discovery is a filesystem walk, not `git ls-files`, because the fixture
#     suite runs this checker against throwaway directories that are not git
#     repositories. So an ignored-but-present binary is excluded by the
#     GENERATED prune list above rather than by consulting `.gitignore`, and a
#     generated tree that is not on that list produces a local-only red. The
#     fix for one is a line up there, not a line here.
ASSET_MANIFEST_NAME="ASSETS.toml"
ASSET_MANIFEST="${ROOT}/${ASSET_MANIFEST_NAME}"

# git reads the first 8000 bytes when it decides whether a blob is binary. The
# same window here, for the same reason: it bounds the read on a file that may
# be very large, and every container format in the world puts a version or a
# length field carrying a zero byte in its first few.
ASSET_SNIFF_BYTES=8000

# The licence sets, and the path they are judged against. This mirrors
# ADR 0015 D-2's DISTRIBUTED closure table -- permissive anywhere, weak under
# `apps/` only -- because the reasoning transfers exactly: an Apache-2.0 leaf
# package under `packages/` exists to be droppable into someone else's project,
# and a shipped CC0 or MPL file carries obligations (or a public-domain
# dedication whose fallback licence is not Apache-2.0) that the package's own
# LICENSE does not describe. #339 says as much: CC0 requires no attribution,
# and "where the asset lands is already constrained; the manifest is what makes
# that checkable".
#
# ⚠️ It FAILS CLOSED, like DEP001. A licence in neither set is a violation, not
# a pass -- this gate exists for the licence nobody has considered yet. GPL and
# AGPL are deliberately absent from BOTH sets, including under `apps/`: §3
# permits a GPL DEPENDENCY there, and whether a GPL-licensed creative asset is
# the same question is an owner's decision rather than a side effect of writing
# a checker.
#
# ⚠️ **`CC-BY-4.0` was absent for the same reason and no longer is**, and a
# reader who remembers this paragraph citing it as the example of an unruled
# licence is reading the old file. Its condition -- "nothing in the tree needs
# it" -- arrived with #302's better-looking scenery, and ADR 0023 ruled on it.
# It is `ASSET_LICENCES_ATTRIBUTED` below rather than a seventh name in the weak
# set, because it is the first identifier here that asks for something back.
# `Zlib` and `CC-BY-SA-4.0` are still absent, on the posture ADR 0016 took
# towards `Zlib`: a licence nobody has an asset for is a licence nobody has read.
ASSET_LICENCES_PERMISSIVE="Apache-2.0 MIT BSD-2-Clause BSD-3-Clause ISC"
ASSET_LICENCES_WEAK="CC0-1.0 MPL-2.0 BlueOak-1.0.0 MIT-0 0BSD Unlicense"

# ADR 0023 D-1 and D-3, #357. Admitted in exactly the place the weak set is --
# under `apps/` only -- and additionally OWING something: CC BY 4.0 §3(a)(1)
# requires the creator's name and a link to the material whenever the work is
# shared, and §3(a)(1)(B) requires indicating whether it was modified.
#
# ⚠️ Every other identifier above is discharged by the manifest row simply
# existing. This one is not -- it is a CONTINUING obligation, and the manifest is
# where the data that discharges it lives, because #358 generates the in-app
# credits from these keys rather than from somebody maintaining a second list.
# So an entry under one of these licences that records no attribution is
# `ASSET006`, and ADR 0023 §Consequences says why widening a list alone would
# have been the vacuous half of this change.
#
# ⚠️ `CC-BY-NC-4.0` is deliberately NOT here and is two letters away. It is
# non-OSI -- CLAUDE.md §3 names it beside BUSL and SSPL as failing everywhere --
# and every set here is matched by string EQUALITY rather than by prefix, so it
# falls through to the branch above. ADR 0023 D-4 says so in terms, and
# `check-repo-rules.test.sh` asserts it. `CC-BY-3.0` and `CC-BY-SA-4.0` are
# absent too: a different version and a different suffix are different terms.
#
# ⚠️ The three keys such an entry must carry -- `creator`, `url` and
# `modified` -- are named in `asset_manifest_records` below and NOT in a variable
# here. A second list would be a second place to keep them, and the parser is the
# only thing that can read a key at all; this half only knows which licences care.
ASSET_LICENCES_ATTRIBUTED="CC-BY-4.0"

# `shasum` is what CLAUDE.md §4a documents and what macOS ships; `sha256sum` is
# what the GNU coreutils on the CI runner ship. The same pair, and the same
# order, as check-licence-hashes.sh -- a second spelling of "take a digest"
# would be a second thing to keep in step.
if command -v shasum >/dev/null 2>&1; then
  asset_digest() { shasum -a 256 "$1" | cut -d' ' -f1; }
  ASSET_DIGEST_TOOL=1
elif command -v sha256sum >/dev/null 2>&1; then
  asset_digest() { sha256sum "$1" | cut -d' ' -f1; }
  ASSET_DIGEST_TOOL=1
else
  asset_digest() { printf ''; }
  ASSET_DIGEST_TOOL=0
fi

# A file no SPDX header could ever be added to. Decided by reading it rather
# than by its name, so that the rule covers a format that does not exist yet.
#
# The read is bounded by `head` and the test is "did `tr` throw anything away",
# which is three processes per file and about 2 s over this repository. A
# command substitution cannot be used to hold the bytes themselves: bash drops
# NUL from one, which is the byte being looked for.
#
# `< "$1"` rather than `head -c N -- "$1"`, because a redirection cannot mistake
# a filename beginning with a hyphen for an option bundle.
asset_is_binary() {
  local nuls
  nuls="$(head -c "${ASSET_SNIFF_BYTES}" < "$1" 2>/dev/null \
    | LC_ALL=C tr -dc '\000' | wc -c | tr -d '[:space:]')"
  [ -n "${nuls}" ] && [ "${nuls}" != "0" ]
}

# --- Reading ASSETS.toml ------------------------------------------------------
#
# A deliberately small subset of TOML: whole-line `#` comments, `[[asset]]`
# headers, and `key = "value"` lines whose value is a double-quoted string
# containing no quote and no tab. Anything else is a parse ERROR rather than a
# line to skip.
#
# ⚠️ **An unrecognised key is refused, not ignored**, which is the opposite of
# the usual convention and is the same choice ADR 0017 D-4 made for the workout
# file. The reasoning is the same too: a key nobody reads is a claim about an
# asset that silently has no effect, and this file exists precisely so that a
# claim about an asset is checked.
#
# ⚠️ And every parse failure is REPORTED rather than skipped, because a parser
# that skips what it cannot read is how a manifest ends up naming nothing while
# the gate reports clean -- DOC002's sticking fence and XML003's unclosed CDATA
# are the same defect in two other file formats, and this repository has now
# shipped that shape five times.
#
# Emits tab-separated records on stdout:
#   E <line> <message>                     a structural problem  (ASSET005)
#   A <line> <path> <licence> <sha256> <absent>
#                                          one entry; licence and digest
#                                          possibly empty for ASSET004/ASSET003,
#                                          and <absent> the attribution keys it
#                                          does not carry, for ASSET006
asset_manifest_records() {
  awk -v SEP='|' '
    function reset() {
      k_path = ""; k_source = ""; k_licence = ""; k_read = ""; k_sha = ""
      k_creator = ""; k_url = ""; k_modified = ""
    }

    # Which of the attribution keys this entry does NOT carry, as a comma-
    # separated list. Computed for EVERY entry and judged by the caller, because
    # awk here knows the keys and the shell knows the licence sets -- putting
    # the licence question in both places is how two lists drift apart.
    function absentAttribution(  missing) {
      missing = ""
      if (k_creator == "") missing = "creator"
      if (k_url == "") missing = missing (missing == "" ? "" : ", ") "url"
      if (k_modified == "") missing = missing (missing == "" ? "" : ", ") "modified"
      return missing
    }

    function flush() {
      if (!inentry) return
      inentry = 0
      if (k_path == "") {
        print "E" SEP startline SEP "the [[asset]] opened here names no path"
        reset(); return
      }
      if (k_source == "") {
        print "E" SEP startline SEP "the entry for " k_path " records no source; where it came from is the point of this file"
        reset(); return
      }
      # The SHAPE of the date, not its validity -- the same line ADR003 draws,
      # for the same reason: a calendar in bash 3.2 is not worth the lines, and
      # a typo in a date nobody disputes is not the failure this is here for.
      # Spelled out digit by digit rather than with an interval expression,
      # because `{4}` is not portable to every awk this has to run under.
      if (k_read !~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$/) {
        print "E" SEP startline SEP "the entry for " k_path " records no read date in the form YYYY-MM-DD"
        reset(); return
      }
      print "A" SEP startline SEP k_path SEP k_licence SEP k_sha SEP absentAttribution()
      reset()
    }

    BEGIN { inentry = 0; startline = 0; reset() }

    {
      line = $0
      sub(/\r$/, "", line)
      t = line
      sub(/^[ \t]+/, "", t)
      sub(/[ \t]+$/, "", t)
      if (t == "") next
      if (substr(t, 1, 1) == "#") next
      if (t == "[[asset]]") { flush(); inentry = 1; startline = NR; reset(); next }
      if (substr(t, 1, 1) == "[") {
        print "E" SEP NR SEP "expected an [[asset]] header, found \"" t "\""
        next
      }
      if (t !~ /^[a-z][a-z0-9]*[ \t]*=[ \t]*"[^"]*"$/) {
        print "E" SEP NR SEP "not a comment, an [[asset]] header or a key = \"value\" line: \"" t "\""
        next
      }
      k = t; sub(/[ \t]*=.*$/, "", k)
      v = t; sub(/^[a-z][a-z0-9]*[ \t]*=[ \t]*"/, "", v); sub(/"$/, "", v)
      if (!inentry) {
        print "E" SEP NR SEP "key \"" k "\" appears before any [[asset]] header"
        next
      }
      if (v == "") { print "E" SEP NR SEP "key \"" k "\" has an empty value"; next }
      # The three keys named in the pattern below are emitted as fields of a
      # "|"-separated record, so neither character may appear in one. Every
      # other key is free
      # prose that is never emitted -- `source`, and since #357 `creator`, `url`
      # and `modified` -- so the restriction names what it restricts rather than
      # exempting what it does not, which is what stops a key added later
      # inheriting a rule that has nothing to do with it.
      if (k ~ /^(path|licence|sha256)$/ && (index(v, "|") > 0 || index(v, "\t") > 0)) {
        print "E" SEP NR SEP "key \"" k "\" has a \"|\" or a tab in its value"
        next
      }
      if (k == "path") {
        if (k_path != "") { print "E" SEP NR SEP "duplicate key \"path\" in one entry"; next }
        k_path = v; next
      }
      if (k == "source") {
        if (k_source != "") { print "E" SEP NR SEP "duplicate key \"source\" in one entry"; next }
        k_source = v; next
      }
      if (k == "licence") {
        if (k_licence != "") { print "E" SEP NR SEP "duplicate key \"licence\" in one entry"; next }
        k_licence = v; next
      }
      if (k == "read") {
        if (k_read != "") { print "E" SEP NR SEP "duplicate key \"read\" in one entry"; next }
        k_read = v; next
      }
      if (k == "sha256") {
        if (k_sha != "") { print "E" SEP NR SEP "duplicate key \"sha256\" in one entry"; next }
        k_sha = v; next
      }
      # The three keys ADR 0023 D-3 names. Accepted on ANY entry -- recording
      # more than a licence demands is never the failure -- and REQUIRED on one
      # whose licence is in ASSET_LICENCES_ATTRIBUTED, which only the shell
      # knows. No apostrophe anywhere in this awk program: it is a single-quoted
      # shell string, so one would end it.
      if (k == "creator") {
        if (k_creator != "") { print "E" SEP NR SEP "duplicate key \"creator\" in one entry"; next }
        k_creator = v; next
      }
      if (k == "url") {
        if (k_url != "") { print "E" SEP NR SEP "duplicate key \"url\" in one entry"; next }
        k_url = v; next
      }
      if (k == "modified") {
        if (k_modified != "") { print "E" SEP NR SEP "duplicate key \"modified\" in one entry"; next }
        k_modified = v; next
      }
      print "E" SEP NR SEP "unknown key \"" k "\"; an unrecognised key is refused rather than ignored, so that a claim about an asset cannot be one nothing reads (ADR 0017 D-4)"
    }

    END { flush() }
  ' "$1"
}

# Is this licence permitted for a file at this repository-relative path?
# A loop rather than a `case` over a packed string: a licence identifier is
# interpolated into the pattern there, and a pattern is not a literal.
asset_licence_permitted() {
  local licence="$1" path="$2" candidate
  for candidate in ${ASSET_LICENCES_PERMISSIVE}; do
    [ "${candidate}" = "${licence}" ] && return 0
  done
  case "${path}" in
    packages/*) return 1 ;;
  esac
  for candidate in ${ASSET_LICENCES_WEAK} ${ASSET_LICENCES_ATTRIBUTED}; do
    [ "${candidate}" = "${licence}" ] && return 0
  done
  return 1
}

# Does this licence oblige the entry to carry the attribution keys? Asked
# WITHOUT reference to the path, deliberately: a CC-BY file under `packages/`
# is refused by the rule above, and answering "so it owes no attribution"
# would be the wrong reason for the right outcome.
asset_attribution_required() {
  local licence="$1" candidate
  for candidate in ${ASSET_LICENCES_ATTRIBUTED}; do
    [ "${candidate}" = "${licence}" ] && return 0
  done
  return 1
}

check_assets() {
  local record kind line rest path licence sha absent got relative errors=0
  local -a asset_paths=() asset_lines=()
  local i named

  # ⚠️ ASSET005 first, and it returns. A manifest that is not there is not "no
  # entries": it is the gate removed. `check-env-example.sh` sets the precedent
  # in as many words -- "a template that is not there documents nothing" -- and
  # the four rules below would all pass vacuously over an absent file.
  #
  # It does NOT then list every binary as unnamed. One cause, one finding; the
  # build is red either way and forty lines about a single deletion buries it.
  if [ ! -f "${ASSET_MANIFEST}" ]; then
    report ASSET005 "${ASSET_MANIFEST_NAME}: not found; it records the provenance, licence and SHA-256 of every committed binary, and without it ASSET001-ASSET004 check nothing (#339)"
    return 0
  fi

  # ⚠️ **Split by hand rather than with `IFS=<sep> read -r a b c d e`, and both
  # halves of that are findings the fixture suite made rather than preferences.**
  #
  # A TAB separator is wrong because a tab is IFS *whitespace*: `read` collapses
  # a RUN of them into one delimiter, and a record whose licence field is empty
  # because the entry records none is exactly such a run. Every field after it
  # shifted left, so an entry with no `licence` key was read as one whose licence
  # was its SHA-256 -- ASSET004 reported an unintelligible licence, ASSET003
  # reported a missing digest, and the one true finding, "no licence recorded",
  # was the only thing that did not appear.
  #
  # U+0001 is the obvious answer -- not IFS whitespace, and the character
  # `xml_comment_findings` already uses for "cannot occur in the input". It does
  # not work: **bash 3.2.57, which is what a bare macOS clone runs, does not
  # split on it at all.** Measured -- `printf 'A\001B\001C' | IFS=$'\001' read -r
  # a b c` yields `a=ABC`, where the same line with `|` splits correctly. So an
  # exotic separator would have made this parser silently return no entries on
  # one of the two platforms this gate has to run on, which is the vacuous pass
  # the whole rule set exists to stop.
  #
  # `|` it is, refused inside the three values that become fields, and the free
  # text of an E record is the LAST field so it may contain anything.
  while IFS= read -r record; do
    [ -n "${record}" ] || continue
    kind="${record%%|*}"
    rest="${record#*|}"
    line="${rest%%|*}"
    rest="${rest#*|}"
    case "${kind}" in
      E)
        report ASSET005 "${ASSET_MANIFEST_NAME}:${line}: ${rest}"
        errors=$((errors + 1))
        ;;
      A)
        path="${rest%%|*}"
        rest="${rest#*|}"
        licence="${rest%%|*}"
        rest="${rest#*|}"
        sha="${rest%%|*}"
        absent="${rest#*|}"
        asset_paths[${#asset_paths[@]}]="${path}"
        asset_lines[${#asset_lines[@]}]="${line}"

        # ⚠️ Refused for the reason LIC006 refuses them in `.spdx-exempt`: an
        # entry has to name one file inside this repository, and an absolute or
        # `..` path names something outside it -- which would also hand the
        # digest step a file the repository does not contain. A glob is NOT
        # refused separately here, because the lookup below is string equality
        # rather than matching: `models/*.glb` simply names no file and is
        # reported as ASSET002, which is the true statement about it.
        case "${path}" in
          /* | *'..'*)
            report ASSET005 "${ASSET_MANIFEST_NAME}:${line}: ${path}: entries are repository-relative paths"
            errors=$((errors + 1))
            continue
            ;;
        esac

        if [ -z "${licence}" ]; then
          report ASSET004 "${ASSET_MANIFEST_NAME}:${line}: ${path}: no licence recorded; an asset whose terms nobody wrote down is an asset nobody has read (#339)"
        elif ! asset_licence_permitted "${licence}" "${path}"; then
          report ASSET004 "${ASSET_MANIFEST_NAME}:${line}: ${path}: licence ${licence} is not permitted at this path; permissive (${ASSET_LICENCES_PERMISSIVE}) anywhere, weak (${ASSET_LICENCES_WEAK}) and attribution-requiring (${ASSET_LICENCES_ATTRIBUTED}) under apps/ only, and anything else needs a decision recorded in an ADR first (ADR 0015 D-2, ADR 0023 D-1)"
        elif asset_attribution_required "${licence}" && [ -n "${absent}" ]; then
          # ⚠️ Reported for a PERMITTED licence, which is what makes it a rule
          # of its own rather than a branch of ASSET004: the entry's licence is
          # fine and the entry is not, and the fix is three keys rather than a
          # different asset. The obligation is continuing -- if the credits
          # screen #358 generates ever drops this asset, the app is shipping it
          # unlicensed -- so the data it is generated FROM is checked here.
          report ASSET006 "${ASSET_MANIFEST_NAME}:${line}: ${path}: licence ${licence} requires attribution wherever the work is shared, and this entry records no ${absent}; CC BY 4.0 §3(a)(1) wants the creator and a link to the material, §3(a)(1)(B) wants any modification indicated, and #358 generates the in-app credits from exactly these keys (ADR 0023 D-3)"
        fi

        if [ ! -f "${ROOT}/${path}" ]; then
          report ASSET002 "${ASSET_MANIFEST_NAME}:${line}: ${path}: no such file; a stale entry records the provenance of nothing (#339)"
          continue
        fi

        if [ "${ASSET_DIGEST_TOOL}" -eq 0 ]; then
          report ASSET003 "${ASSET_MANIFEST_NAME}:${line}: ${path}: neither shasum nor sha256sum is available, so no asset's integrity can be checked (#339)"
          continue
        fi
        if [ -z "${sha}" ]; then
          report ASSET003 "${ASSET_MANIFEST_NAME}:${line}: ${path}: no SHA-256 recorded; nothing would notice this file being replaced (#339)"
          continue
        fi
        got="$(asset_digest "${ROOT}/${path}")"
        if [ "${got}" != "${sha}" ]; then
          report ASSET003 "${ASSET_MANIFEST_NAME}:${line}: ${path}: SHA-256 is ${got}, but the manifest records ${sha} (#339)"
        fi
        ;;
    esac
  done < <(asset_manifest_records "${ASSET_MANIFEST}")

  # ⚠️ A partially parsed manifest is not a manifest. Walking the tree against
  # a half-read entry list would report every asset whose entry sat after the
  # bad line as unnamed, so the one real finding arrives buried under
  # consequences of itself. The build is already red; ASSET005 is what to fix.
  [ "${errors}" -eq 0 ] || return 0

  while IFS= read -r file; do
    [ -n "${file}" ] || continue
    asset_is_binary "${file}" || continue
    relative="${file#"${ROOT}"/}"
    named=0
    for (( i = 0; i < ${#asset_paths[@]}; i++ )); do
      if [ "${asset_paths[i]}" = "${relative}" ]; then named=1; break; fi
    done
    [ "${named}" -eq 1 ] && continue
    report ASSET001 "${relative}: a committed binary that ${ASSET_MANIFEST_NAME} does not name; no SPDX header can be put in it, so its licence, its source and its integrity are recorded there or nowhere (#339)"
  done < <(repo_files | sort)

  ASSET_NAMED_COUNT="${#asset_paths[@]}"
}

ASSET_NAMED_COUNT=0
check_assets

# --- Result -------------------------------------------------------------------

if [ "${findings}" -gt 0 ]; then
  printf '\n%s repository-rule violation(s). See docs/adr/0005-tech-stack.md and CONTRIBUTING.md.\n' \
    "${findings}" >&2
  exit 1
fi

# The asset count is on the success line deliberately. A rule whose population
# can be empty reads identically whether it checked forty files or none, which
# is the complaint #278 records against a gate that reports only "clean"; this
# is the cheapest possible answer to it.
printf 'check-repo-rules: clean (%s); %s binary asset(s) named in %s\n' \
  "${ROOT}" "${ASSET_NAMED_COUNT}" "${ASSET_MANIFEST_NAME}"
