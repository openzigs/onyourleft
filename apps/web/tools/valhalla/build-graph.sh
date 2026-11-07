#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Builds one state's Valhalla routing graph for valhalla-browser (#2320), the
# way spike 0035 measured it: the official Valhalla image, pinned by digest,
# with `loki.use_connectivity` off, laid out for the `individual-tiles`
# transport. README.md beside this file says what to do with the result.
#
#   build-graph.sh --pbf <extract.osm.pbf> [--out DIR] [--work DIR]
#                  [--prefix NAME] [--extract-date YYYY-MM-DD] [--threads N]
#
# --pbf (or OYL_ROUTING_PBF) is a local OpenStreetMap extract the maintainer
# supplies: this script downloads nothing and names no region. ⚠️ The state is
# never written in public text, code or commits (#2320), so it is never an
# argument here and the release says nothing about it but the box its tiles
# cover (make-release.ts).
#
# What it does:
#   1. runs valhalla_build_config, _admins, _tiles and _extract in the image,
#      with the extract mounted read-only and the work directory the only
#      thing it can write, as the calling user;
#   2. runs make-release.ts, which checks graph.tar the way the SDK will and
#      writes <out>/<release>/ (manifest, config, archive, tiles, ODbL notice)
#      and <out>/<release>.build.json, the local record nobody uploads.
#
# Uploads nothing. upload.sh does that, and only on the owner's word.
#
# Its suite is build-graph.test.sh, with a fake `docker`.

set -euo pipefail

# ghcr.io/valhalla/valhalla:3.8.3, the image index (both platforms), read on
# 2026-11-06 with `docker buildx imagetools inspect`. 3.8.3 is the Valhalla
# valhalla-browser 0.2.1's WebAssembly is built from; make-release.ts refuses
# tiles from any other.
IMAGE="ghcr.io/valhalla/valhalla:3.8.3@sha256:70b45295d81035e3562e1bbf996a28d5fc55e1ccc5d7e3fff9f297d3b1a1359f"

# 2026-09-17T00:00:00Z, upstream valhalla-browser's own default, for the tar's timestamps.
SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-1789603200}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB="$(cd "${HERE}/../.." && pwd)"

die() {
  printf 'build-graph: %s\n' "$1" >&2
  exit 1
}

usage() {
  sed -n '9,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

pbf="${OYL_ROUTING_PBF:-}"
out="${HOME}/.cache/onyourleft/valhalla/releases"
work="${HOME}/.cache/onyourleft/valhalla/work"
prefix="oyl-bicycle"
extract_date=""
threads="4"

while [ $# -gt 0 ]; do
  case "$1" in
    --pbf | --out | --work | --prefix | --extract-date | --threads)
      [ $# -ge 2 ] || die "$1 needs a value"
      case "$1" in
        --pbf) pbf="$2" ;;
        --out) out="$2" ;;
        --work) work="$2" ;;
        --prefix) prefix="$2" ;;
        --extract-date) extract_date="$2" ;;
        --threads) threads="$2" ;;
      esac
      shift 2
      ;;
    -h | --help) usage ;;
    --) shift ;; # what `pnpm run valhalla:graph -- …` may pass through
    *) die "unknown argument $1" ;;
  esac
done

[ -n "${pbf}" ] || die '--pbf <extract.osm.pbf> or OYL_ROUTING_PBF is required'
[ -f "${pbf}" ] || die '--pbf names no file'
case "${pbf}" in
  *.osm.pbf) ;;
  *) die '--pbf must be an .osm.pbf extract' ;;
esac
case "${threads}" in
  '' | *[!0-9]*) die '--threads must be a whole number' ;;
esac
command -v docker >/dev/null 2>&1 || die 'docker is required'
command -v node >/dev/null 2>&1 || die 'node is required'

pbf_dir="$(cd "$(dirname "${pbf}")" && pwd)"
pbf_name="$(basename "${pbf}")"
mkdir -p "${work}" "${out}"
work="$(cd "${work}" && pwd)"
out="$(cd "${out}" && pwd)"
build="$(mktemp -d "${work}/build.XXXXXX")"

start=${SECONDS}
printf 'build-graph: building in %s\n' "${build}" >&2

# The inner script is single-quoted and reads the extract's name from the
# environment, so nothing the maintainer typed is ever parsed as shell.
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH}" \
  -e PBF_NAME="${pbf_name}" \
  -e THREADS="${threads}" \
  -v "${build}:/work" \
  -v "${pbf_dir}:/input:ro" \
  "${IMAGE}" \
  bash -c 'set -euo pipefail
    cd /work
    valhalla_build_config \
      --mjolnir-tile-dir /work/tiles \
      --mjolnir-tile-extract /work/graph.tar \
      --mjolnir-admin /work/admins.sqlite \
      --mjolnir-timezone /work/timezones.sqlite \
      --mjolnir-concurrency "${THREADS}" \
      --loki-use-connectivity False >/work/native-config.json
    valhalla_build_admins -c /work/native-config.json "/input/${PBF_NAME}" >/work/admins.log 2>&1
    valhalla_build_tiles -c /work/native-config.json "/input/${PBF_NAME}" >/work/tiles.log 2>&1
    valhalla_build_extract -c /work/native-config.json -v >/work/extract.log 2>&1
    valhalla_build_tiles --version >/work/valhalla-version.txt' ||
  die "the Valhalla build failed; its logs are in ${build}"

release_args=(--work "${build}" --out "${out}" --pbf "${pbf}" --image "${IMAGE}"
  --valhalla-version "$(cat "${build}/valhalla-version.txt")" --prefix "${prefix}")
[ -z "${extract_date}" ] || release_args+=(--extract-date "${extract_date}")

made="$(cd "${WEB}" && node --import ./tools/ts-extensionless-resolve.mjs \
  tools/valhalla/make-release.ts "${release_args[@]}")" ||
  die "the release could not be made; the build is kept in ${build}"
printf '%s\n' "${made}"
rm -rf "${build}"

release="$(printf '%s\n' "${made}" | sed -n 's/^make-release: wrote \([^ ]*\) to .*$/\1/p')"
printf 'build-graph: %s in %d s\n' "${release}" "$((SECONDS - start))"
printf 'build-graph: nothing is uploaded. When the owner has said yes:\n'
printf '  pnpm --filter @onyourleft/web valhalla:upload -- %s/%s\n' "${out}" "${release}"
