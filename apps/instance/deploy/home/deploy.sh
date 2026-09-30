#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# deploy.sh — the one command that deploys this checkout to the box (#52, #807).
#
#   bash apps/instance/deploy/home/deploy.sh             # deploy this checkout
#   bash apps/instance/deploy/home/deploy.sh --rollback  # back to the previous deploy
#
# What a deploy does, in order, and why:
#
#   1. Builds the image from this checkout, tagged with its commit, so the
#      running build can always say what source it is (GET /source).
#   2. If an instance is already running: takes a snapshot of its data FIRST
#      (`backup`), into OYL_BACKUP_DIR/pre-deploy. A rollback restores it:
#      the new build's migrations may have moved the database on, and the old
#      build refuses a database that is ahead of it.
#   3. Starts the new image. Compose runs the `migrate` step to completion
#      before the instance (#791), and waits for the image's healthcheck.
#   4. Asks /ready inside the container until it says ready, for up to
#      OYL_DEPLOY_READY_SECONDS (default 120).
#   5. Not ready: ROLLS BACK by itself (the previous image, the pre-deploy
#      snapshot restored), and exits 1. A failing deploy does not stay up.
#   6. Ready: starts the tunnel and the scheduled backup, tags the image
#      `onyourleft-instance:local` (what a hand-run `docker compose` uses),
#      records what is deployed in .deployed beside this file, and prints how
#      long it took.
#
# Needs Docker with Compose, git, and a filled-in .env beside this file
# (copy instance.env.example). Run from anywhere inside the checkout.
#
# ⚠️ This is the ONE deploy there is. It runs a single instance on a single
# box, so there is no second copy to keep serving while the new one starts:
# riders see the room close (1001 server-stopping) and rejoin. #790 is where a
# managed deploy with no gap would go.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "${HERE}" rev-parse --show-toplevel)"
STATE="${HERE}/.deployed"
READY_SECONDS="${OYL_DEPLOY_READY_SECONDS:-120}"
started_at="$(date +%s)"

say() { printf 'deploy: %s\n' "$1"; }
die() { printf 'deploy: %s\n' "$1" >&2; exit 1; }

compose() { docker compose --project-directory "${HERE}" -f "${HERE}/compose.yaml" "$@"; }

state() { [ -f "${STATE}" ] && sed -n "s/^$1=//p" "${STATE}" | head -n 1; }

ready() {
  compose exec -T instance node -e \
    "fetch('http://127.0.0.1:8787/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" \
    >/dev/null 2>&1
}

wait_ready() {
  local waited=0
  while [ "${waited}" -lt "${READY_SECONDS}" ]; do
    ready && return 0
    sleep 2
    waited=$((waited + 2))
  done
  return 1
}

# Starts `image`, waits for it, and answers whether it came up ready.
start() {
  OYL_INSTANCE_IMAGE="$1" compose up -d --wait --wait-timeout "${READY_SECONDS}" instance &&
    wait_ready
}

# Back to `image`, with `snapshot` restored first when there is one.
rollback() {
  local image="$1" snapshot="$2"
  [ -n "${image}" ] || die 'there is no previous deploy to roll back to.'
  say "rolling back to ${image}"
  compose stop instance >/dev/null 2>&1 || true
  if [ -n "${snapshot}" ]; then
    say "restoring ${snapshot}"
    OYL_INSTANCE_IMAGE="${image}" compose run --rm --no-deps --entrypoint node backup \
      src/operator/cli.ts restore "/backups/pre-deploy/${snapshot}" --force ||
      die 'the restore failed: the data is as the failed deploy left it. See docs/operating-an-instance.md, "Restore".'
  fi
  start "${image}" || die "${image} did not come back ready either: see docker compose logs instance."
  OYL_INSTANCE_IMAGE="${image}" compose up -d tunnel backup
  docker tag "${image}" onyourleft-instance:local
  printf 'image=%s\nprevious=\nsnapshot=\n' "${image}" > "${STATE}"
  say "rolled back to ${image} in $(($(date +%s) - started_at)) s."
}

[ -f "${HERE}/.env" ] || die "there is no .env beside compose.yaml: copy instance.env.example and fill it in."

if [ "${1:-}" = '--rollback' ]; then
  rollback "$(state previous)" "$(state snapshot)"
  exit 0
fi

commit="$(git -C "${ROOT}" rev-parse HEAD)" || die 'could not read the commit.'
image="onyourleft-instance:${commit}"
say "building ${image}"
docker build --quiet --build-arg "OYL_INSTANCE_COMMIT=${commit}" \
  -f "${ROOT}/apps/instance/Dockerfile" -t "${image}" "${ROOT}" >/dev/null ||
  die 'the image did not build.'

previous="$(state image)"
snapshot=''
if [ -n "${previous}" ] && [ -n "$(compose ps -q instance 2>/dev/null)" ]; then
  say 'taking a snapshot before anything changes'
  taken="$(OYL_INSTANCE_IMAGE="${previous}" compose run --rm --no-deps --entrypoint node backup \
    src/operator/cli.ts backup /backups/pre-deploy --keep 3)" ||
    die 'the pre-deploy snapshot failed, so nothing was changed.'
  snapshot="$(printf '%s' "${taken}" | sed -n 's/.*"snapshot":"[^"]*\/\(snapshot-[^"]*\)".*/\1/p')"
fi

say "starting ${image}"
if ! start "${image}"; then
  say "${image} did not become ready within ${READY_SECONDS} s."
  if [ -n "${previous}" ]; then
    rollback "${previous}" "${snapshot}"
  fi
  exit 1
fi

OYL_INSTANCE_IMAGE="${image}" compose up -d tunnel backup
# The tag a hand-run `docker compose …` uses when OYL_INSTANCE_IMAGE is not set.
docker tag "${image}" onyourleft-instance:local
printf 'image=%s\nprevious=%s\nsnapshot=%s\n' "${image}" "${previous}" "${snapshot}" > "${STATE}"
say "${image} is ready, in $(($(date +%s) - started_at)) s."
