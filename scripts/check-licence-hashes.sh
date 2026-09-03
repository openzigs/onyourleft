#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# check-licence-hashes.sh — verify the committed licence texts still match the
# SHA-256 digests recorded in docs/adr/0001-licence.md.
#
# ADR 0001 keeps LICENSE byte-identical to the canonical AGPL-3.0 text from
# gnu.org and LICENSES/Apache-2.0.txt byte-identical to the canonical Apache-2.0
# text, and records a digest of each so the claim is checkable rather than
# asserted. CLAUDE.md lists both files as protected paths.
#
# The reason this is a machine check and not a review convention: an edit to a
# licence text is a licensing incident rather than a typo, and it is precisely
# the shape of diff a human reviewer scrolls past. Both files are thousands of
# words of dense legal prose that nobody reads twice.
#
# The ADR is the single source of truth for the expected digests. They are read
# out of it rather than duplicated here, because two copies of a constant drift
# and the ADR is the copy a person would go and read. The ADR is itself a
# protected path, amended only by a superseding ADR.
#
# The same reasoning applies to the copy of each text a leaf package carries
# under apps/ and packages/ — CLAUDE.md section 3's "belt and braces". Those are
# not recorded in the ADR and must not be: four more digests in a protected
# document would need a superseding ADR every time a package is added. Instead
# each copy is required to be byte-identical to the canonical text its path
# requires, and the canonical text is the one the ADR records. The chain holds
# without the ADR knowing how many packages exist.
#
# Rule:
#   LIC005  a recorded licence digest does not reproduce, or is not recorded,
#           or a per-package LICENSE copy is not byte-identical to the canonical
#           text its path requires
#
# Usage: scripts/check-licence-hashes.sh [ROOT]   (ROOT defaults to the repo root)
# Exit:  0 every required digest is recorded and reproduces, 1 otherwise.

set -uo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ADR_REL="docs/adr/0001-licence.md"
ADR="${ROOT}/${ADR_REL}"

# The licence texts that must each be covered by a recorded digest. Requiring
# the set by name is what stops the check passing vacuously: without it, an ADR
# whose integrity block was deleted or reworded verifies nothing at all and
# exits 0, which is indistinguishable from a clean run.
REQUIRED_PATHS="LICENSE LICENSES/Apache-2.0.txt"

findings=0

report() {
  printf 'LIC005: %s\n' "$1" >&2
  findings=$((findings + 1))
}

# shasum is what CLAUDE.md section 4a documents and what macOS ships; sha256sum
# is what a minimal Linux image ships. Either satisfies "runs on a bare clone".
if command -v shasum >/dev/null 2>&1; then
  digest_of() { shasum -a 256 "$1" | cut -d' ' -f1; }
elif command -v sha256sum >/dev/null 2>&1; then
  digest_of() { sha256sum "$1" | cut -d' ' -f1; }
else
  printf 'LIC005: neither shasum nor sha256sum is available; cannot verify licence integrity\n' >&2
  exit 1
fi

if [ ! -f "${ADR}" ]; then
  report "${ADR_REL}: not found; it records the licence digests this check verifies"
  exit 1
fi

# Records look like "<64 hex>  <path>" and sit inside a fenced block in the ADR,
# so the line is matched on its own shape rather than on the surrounding prose.
records="$(sed -n -E 's/^([0-9a-f]{64})[[:space:]]+([^[:space:]]+)[[:space:]]*$/\1 \2/p' "${ADR}")"

recorded_paths=""
while read -r want path; do
  [ -n "${path:-}" ] || continue
  recorded_paths="${recorded_paths} ${path}"
  if [ ! -f "${ROOT}/${path}" ]; then
    report "${path}: recorded in ${ADR_REL} but not present in the repository"
    continue
  fi
  got="$(digest_of "${ROOT}/${path}")"
  if [ "${got}" != "${want}" ]; then
    report "${path}: recorded ${want}, computed ${got} — the committed text no longer matches ADR 0001"
  fi
done <<EOF
${records}
EOF

for required in ${REQUIRED_PATHS}; do
  case " ${recorded_paths} " in
    *" ${required} "*) ;;
    *) report "${ADR_REL}: no SHA-256 digest recorded for ${required}; a protected licence text is unverifiable" ;;
  esac
done

# --- The per-package copies ---------------------------------------------------
#
# Every leaf package carries its own LICENSE (rule LIC004 in
# check-repo-rules.sh requires the file to exist; this requires it to say the
# right thing). A copy that has drifted is the same licensing incident as an
# edit to the canonical text, and it is even easier to miss: nobody re-reads the
# fourth copy of the Apache licence.
copies=0

check_copies() {
  local dir="$1" canonical_rel="$2" canonical="${ROOT}/$2" want got copy
  [ -d "${dir}" ] || return 0
  # A canonical text that is missing or unverifiable was already reported above;
  # comparing against it here would only add noise.
  [ -f "${canonical}" ] || return 0
  want="$(digest_of "${canonical}")"
  while IFS= read -r copy; do
    [ -n "${copy}" ] || continue
    copies=$((copies + 1))
    got="$(digest_of "${copy}")"
    if [ "${got}" != "${want}" ]; then
      report "${copy#"${ROOT}"/}: not byte-identical to ${canonical_rel} (that text digests to ${want}, this one to ${got})"
    fi
  done < <(find "${dir}" -name node_modules -prune -o -type f \
    \( -name LICENSE -o -name LICENSE.txt \) -print)
}

check_copies "${ROOT}/packages" "LICENSES/Apache-2.0.txt"
check_copies "${ROOT}/apps" "LICENSE"

if [ "${findings}" -gt 0 ]; then
  printf '\n%s licence-integrity violation(s). See docs/adr/0001-licence.md and CLAUDE.md "Protected paths".\n' \
    "${findings}" >&2
  exit 1
fi

printf 'check-licence-hashes: %s recorded digest(s) reproduce, %s per-package copy(ies) match (%s)\n' \
  "$(printf '%s\n' "${records}" | grep -c . )" "${copies}" "${ROOT}"
