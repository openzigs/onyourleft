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
# Rules:
#   IMG001  the image does not build
#   IMG002  the container never reports healthy
#   IMG003  /source does not name the commit the image was built from
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
