#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for build-graph.sh beside this file -- #2320.
#
# Each case runs the real build-graph.sh with a fake `docker` first on PATH,
# the way ../basemap/build.test.sh fakes `java`. The fake records its
# arguments in ${tmp}/calls and, for `docker run`, writes into the mounted
# /work what the Valhalla image would: a native-config.json, a graph.tar of
# Valhalla's shape (graph-tar-testing.ts, three filler tiles) and the version
# file. make-release.ts then runs for real on it. No image is pulled, no tile
# is built and nothing reaches the network.
#
# Run: bash apps/web/tools/valhalla/build-graph.test.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB="$(cd "${HERE}/../.." && pwd)"
BUILD="${HERE}/build-graph.sh"
IMAGE="$(sed -n 's/^IMAGE="\(.*\)"$/\1/p' "${BUILD}")"

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

new_fixture() {
  cleanup
  tmp="$(mktemp -d)"
  mkdir -p "${tmp}/bin" "${tmp}/extracts"
  : >"${tmp}/calls"
  printf 'an extract\n' >"${tmp}/extracts/somewhere-261030.osm.pbf"

  cat >"${tmp}/bin/docker" <<FAKE
#!/usr/bin/env bash
printf 'docker %s\n' "\$*" >>"\${OYL_FAKE_DIR}/calls"
[ "\${OYL_FAKE_DOCKER_FAIL:-}" = 1 ] && exit 3
work=""
prev=""
for arg in "\$@"; do
  if [ "\${prev}" = -v ]; then
    case "\${arg}" in *:/work) work="\${arg%:/work}" ;; esac
  fi
  prev="\${arg}"
done
[ -n "\${work}" ] || exit 4
printf '{"mjolnir":{"tile_dir":"/work/tiles","tile_extract":"/work/graph.tar"},"loki":{"use_connectivity":false}}' >"\${work}/native-config.json"
(cd "${WEB}" && node --import ./tools/ts-extensionless-resolve.mjs tools/valhalla/graph-tar-testing.ts "\${work}/graph.tar")
printf '%s\n' "\${OYL_FAKE_VERSION:-3.8.3}" >"\${work}/valhalla-version.txt"
FAKE
  chmod +x "${tmp}/bin/docker"
}

run_build() {
  out="$(cd "${tmp}" && OYL_FAKE_DIR="${tmp}" PATH="${tmp}/bin:${PATH}" HOME="${tmp}/home" \
    bash "${BUILD}" --out "${tmp}/out" --work "${tmp}/work" "$@" 2>&1)"
  code=$?
}

check() {
  local name="$1"
  shift
  if "$@"; then ok "${name}"; else bad "${name}"; fi
}

has() { grep -qF -- "$2" <<<"$1"; }
lacks() { ! grep -qF -- "$2" <<<"$1"; }
release_dir() { find "${tmp}/out" -mindepth 1 -maxdepth 1 -type d -name 'oyl-bicycle-*' | head -1; }

# --- A build ----------------------------------------------------------------
new_fixture
run_build --pbf "${tmp}/extracts/somewhere-261030.osm.pbf"
calls="$(cat "${tmp}/calls")"
rel="$(release_dir)"
check 'a build: it succeeds' test "${code}" -eq 0
check 'a build: the image is pinned by digest' has "${calls}" "${IMAGE} bash -c"
check 'a build: the digest is a full sha256' grep -qE '@sha256:[0-9a-f]{64}$' <<<"${IMAGE}"
check 'a build: the extract is mounted read-only' has "${calls}" "-v ${tmp}/extracts:/input:ro"
check 'a build: it runs as the calling user' has "${calls}" "--user $(id -u):$(id -g)"
check 'a build: the config turns loki.use_connectivity off' has "${calls}" '--loki-use-connectivity False'
check 'a build: the extract reaches the container by name only' has "${calls}" '-e PBF_NAME=somewhere-261030.osm.pbf'
check 'a build: the release takes the extract date' grep -qE '/oyl-bicycle-20261030-[0-9a-f]{12}$' <<<"${rel}"
for file in manifest.json config.json graph.tar NOTICE.txt tiles/2/000/519/120.gph; do
  check "a build: the release holds ${file}" test -f "${rel}/${file}"
done
check 'a build: nothing in the release names the extract' test -z "$(grep -rl somewhere "${rel}")"
check 'a build: the local record does' grep -q 'somewhere-261030.osm.pbf' "${rel}.build.json"
check 'a build: the working copy is removed' test -z "$(ls -A "${tmp}/work")"
check 'a build: it says nothing is uploaded' has "${out}" 'nothing is uploaded'
check 'a build: it prints the upload command for this release' has "${out}" "valhalla:upload -- ${rel}"

# --- The extract from the environment, and a date given -----------------------
new_fixture
out="$(cd "${tmp}" && OYL_FAKE_DIR="${tmp}" PATH="${tmp}/bin:${PATH}" HOME="${tmp}/home" \
  OYL_ROUTING_PBF="${tmp}/extracts/somewhere-261030.osm.pbf" \
  bash "${BUILD}" --out "${tmp}/out" --work "${tmp}/work" --extract-date 2026-11-02 2>&1)"
code=$?
check 'OYL_ROUTING_PBF: the build succeeds' test "${code}" -eq 0
check '--extract-date: it names the release' grep -qE '/oyl-bicycle-20261102-' <<<"$(release_dir)"

# --- Refusals before anything runs ---------------------------------------------
new_fixture
run_build
check 'no extract: refused' test "${code}" -eq 1
check 'no extract: it says how to give one' has "${out}" '--pbf <extract.osm.pbf> or OYL_ROUTING_PBF is required'
check 'no extract: docker is not run' test ! -s "${tmp}/calls"

new_fixture
run_build --pbf "${tmp}/extracts/missing-261030.osm.pbf"
check 'a missing extract: refused, without docker' test "${code}" -eq 1 -a ! -s "${tmp}/calls"
check 'a missing extract: the message does not quote the path' lacks "${out}" 'missing-261030'

new_fixture
printf 'xml\n' >"${tmp}/extracts/somewhere.osm"
run_build --pbf "${tmp}/extracts/somewhere.osm"
check 'not a .osm.pbf: refused' has "${out}" '--pbf must be an .osm.pbf extract'

new_fixture
run_build --pbf "${tmp}/extracts/somewhere-261030.osm.pbf" --threads 'four; rm -rf /'
check 'a bad --threads: refused, without docker' test "${code}" -eq 1 -a ! -s "${tmp}/calls"

new_fixture
run_build --pbf "${tmp}/extracts/somewhere-261030.osm.pbf" --state somewhere
check 'an unknown argument: refused' has "${out}" 'unknown argument --state'

# --- Failures after it runs ----------------------------------------------------
new_fixture
out="$(cd "${tmp}" && OYL_FAKE_DIR="${tmp}" OYL_FAKE_DOCKER_FAIL=1 PATH="${tmp}/bin:${PATH}" HOME="${tmp}/home" \
  bash "${BUILD}" --out "${tmp}/out" --work "${tmp}/work" --pbf "${tmp}/extracts/somewhere-261030.osm.pbf" 2>&1)"
code=$?
check 'a failed Valhalla build: the script fails' test "${code}" -eq 1
check 'a failed Valhalla build: it says where the logs are' has "${out}" 'the Valhalla build failed; its logs are in'
check 'a failed Valhalla build: no release is written' test -z "$(release_dir)"

new_fixture
out="$(cd "${tmp}" && OYL_FAKE_DIR="${tmp}" OYL_FAKE_VERSION=3.9.0 PATH="${tmp}/bin:${PATH}" HOME="${tmp}/home" \
  bash "${BUILD}" --out "${tmp}/out" --work "${tmp}/work" --pbf "${tmp}/extracts/somewhere-261030.osm.pbf" 2>&1)"
code=$?
check 'another Valhalla: refused' test "${code}" -eq 1
check 'another Valhalla: it says which and why' has "${out}" 'built by Valhalla 3.9.0, and valhalla-browser@0.2.1 runs 3.8.3'
check 'another Valhalla: no release is written' test -z "$(release_dir)"
check 'another Valhalla: the build is kept to read' test -n "$(ls -A "${tmp}/work")"

printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
[ "${fail}" -eq 0 ]
