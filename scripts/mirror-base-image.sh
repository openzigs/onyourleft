#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# mirror-base-image.sh -- copy the instance's base image from Docker Hub to
# the project's GHCR mirror (#1231).
#
# `apps/instance/Dockerfile` builds from `ghcr.io/openzigs/<name>:<tag>@<digest>`
# (IMG008, scripts/check-instance-image.sh), so the required check never asks
# Docker Hub, whose pull limit and auth timeouts turned it red three times on
# 2026-10-09. This reads every such FROM and copies Docker Hub's official
# image `docker.io/library/<name>@<digest>` -- by the DIGEST, never the tag --
# to `ghcr.io/openzigs/<name>:<tag>`, every platform, with its digests
# preserved, so the mirror serves the same bytes under the same digest. Then
# it reads the image back from the mirror by that digest, which is the pull
# the required check will make.
#
# The pin is what makes the mirror safe to trust: whatever the tag on GHCR is
# made to point at, a build asks for the digest, and a registry cannot serve
# other bytes under it. So moving the base image is a Dockerfile change (a new
# digest, read off Docker Hub), and this copies it across when that lands.
#
# Run by `.github/workflows/mirror-base-image.yml`, which logs `skopeo` in to
# ghcr.io first. Needs skopeo (on GitHub's ubuntu runner images).
#
# Rules:
#   MIR001  a FROM names a base image this cannot map to Docker Hub's official image
#   MIR002  the Dockerfile names no base image at all
#   MIR003  the copy failed
#   MIR004  the mirror does not serve the pinned digest after the copy
#
# Its own suite, with a fake `skopeo` on PATH:
#   bash scripts/mirror-base-image.test.sh
#
# Run: bash scripts/mirror-base-image.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKERFILE="${ROOT}/apps/instance/Dockerfile"
MIRROR='ghcr.io/openzigs'
# <name>:<tag>@sha256:<64 hex>, one path segment: Docker Hub's official images
# are `library/<name>`, which is all this mirrors.
SHAPE="^${MIRROR//./\\.}/([a-z0-9][a-z0-9._-]*):([A-Za-z0-9_][A-Za-z0-9._-]*)@(sha256:[0-9a-f]{64})\$"

fail() {
  printf 'mirror-base-image: %s\n' "$1" >&2
  exit 1
}

# The base images, read as check-instance-image.sh reads them: every FROM,
# options skipped, an earlier stage's name and `scratch` not images.
images=()
stages=' '
while IFS= read -r line || [ -n "${line}" ]; do
  read -r -a words <<< "${line}"
  [ "${#words[@]}" -gt 0 ] || continue
  [ "$(printf '%s' "${words[0]}" | tr '[:upper:]' '[:lower:]')" = from ] || continue
  index=1
  while [ "${index}" -lt "${#words[@]}" ] && [[ "${words[${index}]}" == --* ]]; do
    index=$((index + 1))
  done
  image="${words[${index}]:-}"
  lowered="$(printf '%s' "${image}" | tr '[:upper:]' '[:lower:]')"
  earlier="${stages}"
  if [ "$(printf '%s' "${words[$((index + 1))]:-}" | tr '[:upper:]' '[:lower:]')" = as ] &&
    [ -n "${words[$((index + 2))]:-}" ]; then
    stages+="$(printf '%s' "${words[$((index + 2))]}" | tr '[:upper:]' '[:lower:]') "
  fi
  [ -n "${lowered}" ] && [ "${lowered}" != scratch ] || continue
  case "${earlier}" in
    *" ${lowered} "*) continue ;;
  esac
  [[ "${image}" =~ ${SHAPE} ]] ||
    fail "MIR001 apps/instance/Dockerfile names a base image this cannot mirror: ${image}"
  case " ${images[*]+"${images[*]}"} " in
    *" ${image} "*) ;;
    *) images+=("${image}") ;;
  esac
done < "${DOCKERFILE}"
[ "${#images[@]}" -gt 0 ] || fail 'MIR002 apps/instance/Dockerfile names no base image to mirror.'

for image in "${images[@]}"; do
  [[ "${image}" =~ ${SHAPE} ]]
  name="${BASH_REMATCH[1]}"
  tag="${BASH_REMATCH[2]}"
  digest="${BASH_REMATCH[3]}"
  source="docker.io/library/${name}@${digest}"
  target="${MIRROR}/${name}:${tag}"
  skopeo copy --all --preserve-digests --retry-times 3 "docker://${source}" "docker://${target}" ||
    fail "MIR003 could not copy ${source} to ${target}."
  skopeo inspect --raw "docker://${MIRROR}/${name}@${digest}" >/dev/null ||
    fail "MIR004 ${MIRROR}/${name}@${digest} does not answer after the copy."
  printf 'mirror-base-image: mirrored %s to %s\n' "${source}" "${image}"
done
