#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# check-instance-image.sh — the instance's Docker image builds, and /health
# answers INSIDE the container (#767).
#
# Builds `apps/instance/Dockerfile` with the commit the tree is at, runs it,
# and waits for the image's own HEALTHCHECK — which fetches /health from inside
# the container — to report `healthy`. Then it asks /source from outside,
# through the published port, and requires the answer to carry the commit the
# image was built with (AGPL-3.0 §13, ADR 0036 D-6). The container and the
# image are removed whatever happens.
#
# Why the HEALTHCHECK and not only a request from outside: #767's criterion is
# that /health answers inside the container, and a port that answers from the
# host could be something else listening on it. The container's own probe
# cannot be.
#
# Needs Docker and the network (the base image is pulled by digest the first
# time), so it is NOT in `check:repo`, the bare-clone set.
#
# ⚠️ **The one outside service it needs is Docker Hub** (#841). The base image
# is pulled from there whenever this machine does not already hold it -- on
# every CI run, because a runner starts empty. GitHub's own documentation says
# Docker Hub's rate limit is not applied to GitHub-hosted runners pulling a
# public image (read 2026-09-29), so what is left is an OUTAGE, and that is
# what IMG004 names: the pull is its own step, before the build, so a registry
# that is down reads as the registry being down rather than as a Dockerfile
# that stopped building. CLAUDE.md §4c records the decision to keep this in the
# required job anyway.
#
# Rules:
#   IMG001  the image does not build
#   IMG002  the container never reports healthy
#   IMG003  /source does not name the commit the image was built from
#   IMG004  the base image could not be pulled (Docker Hub, not this tree)
#   IMG005  the Dockerfile's base image is not pinned by digest
#
# Its own suite, with a fake `docker` on PATH and no Docker needed:
#   bash scripts/check-instance-image.test.sh
#
# Run: bash scripts/check-instance-image.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAG="onyourleft-instance:check-$$"
NAME="onyourleft-instance-check-$$"
# How long the container has to report healthy. The HEALTHCHECK's own interval
# is 30 s with a 5 s start period; this asks every second instead of waiting on
# it, by running the image's own probe with `docker exec`.
DEADLINE_SECONDS=30

cleanup() {
  docker rm -f "${NAME}" >/dev/null 2>&1 || true
  docker image rm -f "${TAG}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  printf 'check-instance-image: %s\n' "$1" >&2
  if docker inspect "${NAME}" >/dev/null 2>&1; then
    printf -- '--- the container said:\n' >&2
    docker logs "${NAME}" >&2 2>&1 || true
  fi
  exit 1
}

commit="$(git -C "${ROOT}" rev-parse HEAD)" || fail 'could not read the commit with git.'

# The base images, read out of the Dockerfile rather than written down twice.
# A tag is mutable, so a base image that is not pinned by digest is a finding
# of its own (CLAUDE.md §8's reason for pinning every action to a commit).
#
# EVERY `FROM`, not the first (#852): a second stage built from a tag would
# pass a check that read one line. Docker reads the instruction without regard
# to case and lets options come before the image, so `from`, leading
# whitespace and `FROM --platform=... <image>` are all read. A stage that
# names an EARLIER stage (`FROM build AS run`) or `scratch` pulls nothing and
# is not a base image. Anything this cannot read -- a `FROM` split over a line
# continuation, an image from an `ARG` -- has no digest to show and fails,
# which is the direction a check should fail in.
bases=()
stages=' '
from_lines=0
while IFS= read -r line; do
  read -r -a words <<< "${line}"
  [ "${#words[@]}" -gt 0 ] || continue
  [ "$(printf '%s' "${words[0]}" | tr '[:upper:]' '[:lower:]')" = from ] || continue
  from_lines=$((from_lines + 1))
  index=1
  while [ "${index}" -lt "${#words[@]}" ] && [[ "${words[${index}]}" == --* ]]; do
    index=$((index + 1))
  done
  image="${words[${index}]:-}"
  lowered="$(printf '%s' "${image}" | tr '[:upper:]' '[:lower:]')"
  # Only an EARLIER stage counts: `FROM node AS node` names the image.
  earlier="${stages}"
  if [ "$(printf '%s' "${words[$((index + 1))]:-}" | tr '[:upper:]' '[:lower:]')" = as ] &&
    [ -n "${words[$((index + 2))]:-}" ]; then
    stages+="$(printf '%s' "${words[$((index + 2))]}" | tr '[:upper:]' '[:lower:]') "
  fi
  [ "${lowered}" = scratch ] && continue
  if [ -n "${lowered}" ]; then
    case "${earlier}" in
      *" ${lowered} "*) continue ;;
    esac
  fi
  case "${image}" in
    *@sha256:*) bases+=("${image}") ;;
    *) fail "IMG005 apps/instance/Dockerfile's base image is not pinned by digest: ${image:-(a FROM line with no image)}" ;;
  esac
done < "${ROOT}/apps/instance/Dockerfile"
[ "${from_lines}" -gt 0 ] ||
  fail "IMG005 apps/instance/Dockerfile's base image is not pinned by digest: (no FROM line)"
for base in ${bases[@]+"${bases[@]}"}; do
  if ! docker image inspect "${base}" >/dev/null 2>&1; then
    docker pull --quiet "${base}" >/dev/null ||
      fail "IMG004 the base image ${base} could not be pulled. That is Docker Hub (an outage, or no network), not a defect in apps/instance -- re-run once it answers."
  fi
done

if ! docker build --quiet --build-arg "OYL_INSTANCE_COMMIT=${commit}" \
  -t "${TAG}" "${ROOT}/apps/instance" >/dev/null; then
  fail 'IMG001 apps/instance/Dockerfile did not build.'
fi

docker run --detach --name "${NAME}" --publish 127.0.0.1::8787 "${TAG}" >/dev/null ||
  fail 'IMG002 the container did not start.'

# The image's OWN HEALTHCHECK command, run now rather than on its 30 s
# interval: read out of the image, one argument per line, so this cannot ask a
# different question from the one Docker asks.
probe=()
while IFS= read -r argument; do
  [ -n "${argument}" ] && probe+=("${argument}")
done < <(docker inspect --format \
  '{{range $i, $a := .Config.Healthcheck.Test}}{{if $i}}{{println $a}}{{end}}{{end}}' "${TAG}")
case "${probe[*]:-}" in
  node\ -e\ *'/health'*) ;;
  *) fail "IMG002 the image's HEALTHCHECK does not fetch /health: ${probe[*]:-(none)}" ;;
esac

healthy=0
for _ in $(seq 1 "${DEADLINE_SECONDS}"); do
  if docker exec "${NAME}" "${probe[@]}" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  if [ "$(docker inspect --format '{{.State.Running}}' "${NAME}")" != 'true' ]; then
    fail 'IMG002 the container exited before /health answered.'
  fi
  sleep 1
done
[ "${healthy}" -eq 1 ] || fail "IMG002 /health did not answer inside the container within ${DEADLINE_SECONDS} s."

port="$(docker port "${NAME}" 8787/tcp | head -n 1 | sed 's/.*://')"
source_body="$(curl --silent --show-error --max-time 5 "http://127.0.0.1:${port}/source")" ||
  fail 'IMG003 /source did not answer through the published port.'
case "${source_body}" in
  *"\"url\":\"https://github.com/openzigs/onyourleft/tree/${commit}\""*) ;;
  *) fail "IMG003 /source does not name ${commit}: ${source_body}" ;;
esac

printf 'check-instance-image: the image builds, /health answers inside the container, and /source names %s.\n' "${commit}"
