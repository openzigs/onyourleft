#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for scripts/mirror-base-image.sh -- #1231.
#
# Each case copies the script into a throwaway directory beside a Dockerfile
# and runs it with a fake `skopeo` first on PATH, the way
# check-instance-image.test.sh fakes `docker`. The script has no test-only
# seam. The fake appends every call to ${tmp}/fake/calls, so a case can say
# what the script ASKED as well as what it concluded. Nothing reaches a
# registry.
#
# Run: bash scripts/mirror-base-image.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIRROR_SCRIPT="${SCRIPT_DIR}/mirror-base-image.sh"

pass=0
fail=0
tmp=""
out=""
code=0

cleanup() { [ -n "${tmp}" ] && rm -rf "${tmp}"; }
trap cleanup EXIT

ok() { pass=$((pass + 1)); printf 'ok   %s\n' "$1"; }
bad() {
  fail=$((fail + 1))
  printf 'FAIL %s\n' "$1"
  printf '%s\n' "${out}" | sed 's/^/     | /'
}

DIGEST='sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6'
OTHER_DIGEST='sha256:1111111111111111111111111111111111111111111111111111111111111111'
PINNED="ghcr.io/openzigs/node:24.21.0-bookworm-slim@${DIGEST}"

new_fixture() {
  cleanup
  tmp="$(mktemp -d)"
  mkdir -p "${tmp}/repo/scripts" "${tmp}/repo/apps/instance" "${tmp}/bin" "${tmp}/fake"
  cp "${MIRROR_SCRIPT}" "${tmp}/repo/scripts/mirror-base-image.sh"
  printf 'FROM %s AS install\nRUN true\nFROM %s\n' "${PINNED}" "${PINNED}" \
    > "${tmp}/repo/apps/instance/Dockerfile"
  printf '0\n' > "${tmp}/fake/copy"
  printf '0\n' > "${tmp}/fake/inspect"
  printf '1\n' > "${tmp}/fake/before"
  rm -f "${tmp}/fake/copied"
  : > "${tmp}/fake/calls"
  cat > "${tmp}/bin/skopeo" <<'FAKE'
#!/usr/bin/env bash
fake="${OYL_FAKE_DIR}"
printf 'skopeo %s\n' "$*" >> "${fake}/calls"
case "$1" in
  copy) src="${@: -2:1}"; : > "${fake}/copied-${src##*@}"; exit "$(cat "${fake}/copy")" ;;
  inspect)
    # Before any copy the mirror answers as `before` says (default: absent);
    # after one it answers as `inspect` says.
    if [ -e "${fake}/copied-${3##*@}" ]; then exit "$(cat "${fake}/inspect")"; fi
    exit "$(cat "${fake}/before")" ;;
  *) printf 'fake skopeo: unexpected %s\n' "$*" >&2; exit 99 ;;
esac
FAKE
  chmod +x "${tmp}/bin/skopeo"
}

set_fake() { printf '%s\n' "$2" > "${tmp}/fake/$1"; }
# The case's own printf format: the Dockerfile's text, with its images as %s.
# shellcheck disable=SC2059
dockerfile() { printf "$@" > "${tmp}/repo/apps/instance/Dockerfile"; }

run_mirror() {
  out="$(OYL_FAKE_DIR="${tmp}/fake" PATH="${tmp}/bin:${PATH}" bash "${tmp}/repo/scripts/mirror-base-image.sh" 2>&1)"
  code=$?
}

assert_exit() {
  if [ "${code}" -eq "$2" ]; then ok "$1"; else bad "$1 (exit ${code}, wanted $2)"; fi
}
assert_says() {
  if grep -qF -- "$2" <<< "${out}"; then ok "$1"; else bad "$1 (no '$2')"; fi
}
assert_asked() {
  if grep -qxF -- "$2" "${tmp}/fake/calls"; then ok "$1"; else bad "$1 (never asked '$2')"; fi
}
assert_not_asked() {
  if grep -qF -- "$2" "${tmp}/fake/calls"; then bad "$1 (asked '$2')"; else ok "$1"; fi
}
assert_calls() {
  local n
  n="$(grep -cF -- "$2" "${tmp}/fake/calls")"
  if [ "${n}" -eq "$3" ]; then ok "$1"; else bad "$1 (${n} calls matching '$2', wanted $3)"; fi
}

# --- Green ---------------------------------------------------------------------

new_fixture
run_mirror
assert_exit 'the Dockerfile'"'"'s shape, two stages on one mirrored image, mirrors' 0
assert_asked 'copies Docker Hub'"'"'s official image, by the pinned digest, to the tag, every platform, digests kept' \
  "skopeo copy --all --preserve-digests --retry-times 3 docker://docker.io/library/node@${DIGEST} docker://ghcr.io/openzigs/node:24.21.0-bookworm-slim"
assert_calls 'once, though two stages name it' 'skopeo copy' 1
assert_asked 'then reads it back from the mirror BY THE DIGEST the Dockerfile pins' \
  "skopeo inspect --raw docker://ghcr.io/openzigs/node@${DIGEST}"
assert_says 'and says what it mirrored' "mirrored docker.io/library/node@${DIGEST} to ${PINNED}"

new_fixture
# shellcheck disable=SC2016
dockerfile 'from --platform=$BUILDPLATFORM %s as build\nFROM ghcr.io/openzigs/node:24-alpine@%s\nFROM build\n' \
  "${PINNED}" "${OTHER_DIGEST}"
run_mirror
assert_exit 'two images, in every spelling Docker reads, mirror' 0
assert_calls 'one copy each' 'skopeo copy' 2
assert_asked 'the second by its own digest and tag' \
  "skopeo copy --all --preserve-digests --retry-times 3 docker://docker.io/library/node@${OTHER_DIGEST} docker://ghcr.io/openzigs/node:24-alpine"
assert_not_asked 'and not a stage by its name' 'docker://docker.io/library/build'

new_fixture
printf 'FROM %s' "${PINNED}" > "${tmp}/repo/apps/instance/Dockerfile"
run_mirror
assert_exit 'a last FROM with no newline after it is read (#864'"'"'s shape)' 0
assert_calls 'and mirrored' 'skopeo copy' 1

new_fixture
set_fake before 0
run_mirror
assert_exit 'a digest the mirror already serves is a pass' 0
assert_not_asked 'and is not copied again' 'skopeo copy'
assert_says 'saying it is already mirrored' "already mirrored ${PINNED}"

new_fixture
dockerfile 'FROM %s\nFROM ghcr.io/openzigs/node:24-alpine@%s\n' "${PINNED}" "${OTHER_DIGEST}"
printf '0\n' > "${tmp}/fake/before"
cat > "${tmp}/bin/skopeo" <<'FAKE'
#!/usr/bin/env bash
printf 'skopeo %s\n' "$*" >> "${OYL_FAKE_DIR}/calls"
case "$1" in
  inspect) case "$3" in *0e0ff40c*) exit 0 ;; *) exit 1 ;; esac ;;
  *) exit 0 ;;
esac
FAKE
run_mirror
assert_calls 'only the digest the mirror lacks is copied' 'skopeo copy' 1
assert_asked 'the missing one' \
  "skopeo copy --all --preserve-digests --retry-times 3 docker://docker.io/library/node@${OTHER_DIGEST} docker://ghcr.io/openzigs/node:24-alpine"

# --- MIR001: nothing it can mirror -------------------------------------------------

for image in "node:24@${DIGEST}" "ghcr.io/openzigs/node:24.21.0-bookworm-slim" \
  "ghcr.io/openzigs/node@${DIGEST}" "ghcr.io/openzigs/library/node:24@${DIGEST}" \
  "ghcr.io/openzigs/node:24@sha256:abc"; do
  new_fixture
  dockerfile 'FROM %s\n' "${image}"
  run_mirror
  assert_exit "a base it cannot map to Docker Hub fails: ${image}" 1
  assert_says 'as MIR001, naming it' "MIR001 apps/instance/Dockerfile names a base image this cannot mirror: ${image}"
  assert_not_asked 'and copies nothing' 'skopeo copy'
done

new_fixture
dockerfile 'FROM %s AS a\nFROM node:24@%s\n' "${PINNED}" "${DIGEST}"
run_mirror
assert_exit 'one good base and one bad fails before copying either' 1
assert_not_asked 'copies nothing' 'skopeo copy'

new_fixture
dockerfile 'FROM scratch\n'
run_mirror
assert_exit 'a Dockerfile with no base image to mirror fails' 1
assert_says 'as MIR002' 'MIR002 apps/instance/Dockerfile names no base image to mirror.'

# --- MIR003, MIR004: the registries ------------------------------------------------

new_fixture
set_fake copy 1
run_mirror
assert_exit 'a copy that fails fails' 1
assert_says 'as MIR003, naming both ends' \
  "MIR003 could not copy docker.io/library/node@${DIGEST} to ghcr.io/openzigs/node:24.21.0-bookworm-slim"
assert_calls 'without reading back (only the look before the copy)' 'skopeo inspect' 1

new_fixture
set_fake inspect 1
run_mirror
assert_exit 'a copy the mirror will not serve by its digest fails' 1
assert_says 'as MIR004' "MIR004 ghcr.io/openzigs/node@${DIGEST} does not answer after the copy"

printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
[ "${fail}" -eq 0 ]
