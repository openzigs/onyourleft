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
#   6. Ready: starts the remote path and the scheduled backup, tags the image
#      `onyourleft-instance:local` (what a hand-run `docker compose` uses),
#      records what is deployed in .deployed beside this file, and prints how
#      long it took.
#   7. On the tailnet (#2805): waits for Tailscale to be signed in — printing
#      its sign-in link if it asks for one — and checks that the origin the
#      RUNNING instance has is the name `tailscale serve` answers on. A
#      mismatch is said, with both, and exits 1: every card would be wrong.
#
# The remote path is the compose profile `.env` turns on (ADR 0079): `tailscale`
# or `cloudflare`, never both (D-8, one origin), and checked against
# OYL_INSTANCE_REMOTE_PATH before anything is built. A .env from before #2805,
# with a tunnel token and no profile, keeps its tunnel, and is told to say so.
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
# Git Bash on Windows (#807): it rewrites every argument that looks like a
# path before docker sees it, so the container's `/backups/pre-deploy` arrived
# as `C:/Program Files/Git/backups/pre-deploy` and every update stopped at the
# pre-deploy snapshot. Turned off, and this directory given in the form
# docker.exe reads (C:/…), which that rewriting used to supply.
if [ -n "${MSYSTEM:-}" ]; then
  export MSYS_NO_PATHCONV=1
  HERE="$(cd "${HERE}" && { pwd -W 2>/dev/null || pwd; })"
fi
ROOT="$(git -C "${HERE}" rev-parse --show-toplevel)"
STATE="${HERE}/.deployed"
READY_SECONDS="${OYL_DEPLOY_READY_SECONDS:-120}"
started_at="$(date +%s)"

say() { printf 'deploy: %s\n' "$1"; }
die() { printf 'deploy: %s\n' "$1" >&2; exit 1; }

compose() { docker compose --project-directory "${HERE}" -f "${HERE}/compose.yaml" "$@"; }

state() { [ -f "${STATE}" ] && sed -n "s/^$1=//p" "${STATE}" | head -n 1; }

# A setting as compose reads it: this shell's, or the last line of .env.
setting() {
  if [ -n "${!1:-}" ]; then
    printf '%s' "${!1}"
  else
    sed -n "s/^$1=//p" "${HERE}/.env" | tail -n 1 | tr -d '\r' | sed "s/^[\"']\(.*\)[\"']$/\1/"
  fi
}

# Which remote paths the profiles turn on: `tailscale`, `tunnel`, both or neither.
remote_services() {
  compose config --services 2>/dev/null | grep -xE 'tailscale|tunnel' | tr '\n' ' ' | sed 's/ $//'
}

# The name `tailscale serve` answers on, `https://` and no trailing dot, once
# Tailscale is signed in. Prints its sign-in link once if it asks for one.
tailnet_origin() {
  local waited=0 status name link asked=''
  while [ "${waited}" -lt "${READY_SECONDS}" ]; do
    status="$(compose exec -T tailscale tailscale status --json --peers=false 2>/dev/null)"
    if grep -q '"BackendState": *"Running"' <<< "${status}"; then
      name="$(printf '%s' "${status}" | sed -n 's/.*"DNSName": *"\([^"]*\)".*/\1/p' | head -n 1)"
      if [ -n "${name}" ]; then
        printf 'https://%s' "${name%.}"
        return 0
      fi
    fi
    link="$(printf '%s' "${status}" | sed -n 's/.*"AuthURL": *"\(https:[^"]*\)".*/\1/p' | head -n 1)"
    if [ -n "${link}" ] && [ -z "${asked}" ]; then
      # To the terminal, not into the caller's $(…).
      say "sign this machine in to your tailnet: open ${link}" >&2
      asked=1
    fi
    sleep 2
    waited=$((waited + 2))
  done
  return 1
}

# The origin the running instance was started with, read back from it.
running_origin() {
  compose exec -T instance node -e "process.stdout.write(process.env.OYL_INSTANCE_ORIGIN ?? '')" 2>/dev/null
}

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
  # The backup service too (#2606): it opens the database to look for the
  # owner's "back up now", and must not while a restore replaces it.
  compose stop instance backup >/dev/null 2>&1 || true
  if [ -n "${snapshot}" ]; then
    say "restoring ${snapshot}"
    OYL_INSTANCE_IMAGE="${image}" compose run --rm --no-deps --entrypoint node backup \
      src/operator/cli.ts restore "/backups/pre-deploy/${snapshot}" --force ||
      die 'the restore failed: the data is as the failed deploy left it. See docs/operating-an-instance.md, "Restore".'
    # A restore ends by rotating the instance's encryption key (#1189, ADR
    # 0047 D-5). The `backup` service holds no secret, so it is done here, in
    # the `instance` service that does; an instance with no keys, or a build
    # from before them, says so and the rollback carries on.
    OYL_INSTANCE_IMAGE="${image}" compose run --rm --no-deps -T instance node \
      src/operator/cli.ts instance-key rotate ||
      say 'the encryption key was not rotated after the restore (no keys, or no secret): see docs/operating-an-instance.md, "The instance'"'"'s keys".'
  fi
  start "${image}" || die "${image} did not come back ready either: see docker compose logs instance."
  # shellcheck disable=SC2086 # the remote services are words: none, or one name
  OYL_INSTANCE_IMAGE="${image}" compose up -d ${REMOTE} backup
  docker tag "${image}" onyourleft-instance:local
  printf 'image=%s\nprevious=\nsnapshot=\n' "${image}" > "${STATE}"
  say "rolled back to ${image} in $(($(date +%s) - started_at)) s."
}

[ -f "${HERE}/.env" ] || die "there is no .env beside compose.yaml: copy instance.env.example and fill it in."

# #2781 (ADR 0080 D-4): the folder the instance makes its secret key in on
# its first start. Made here, by the user who deploys, because Docker would
# make a missing one owned by root on Linux, where the instance (uid 1000)
# could not write it. Owner-only; an existing one is left as it is.
if [ ! -d "${HERE}/secrets" ]; then
  mkdir -p "${HERE}/secrets" && chmod 700 "${HERE}/secrets" ||
    die 'could not make the secrets folder beside compose.yaml.'
fi

# The remote path (#2805, ADR 0079), checked before anything changes.
compose config --quiet || die 'compose.yaml and .env do not make a configuration: the line above says what is missing.'
REMOTE="$(remote_services)"
if [ -z "${REMOTE}" ] && [ -n "$(setting CLOUDFLARE_TUNNEL_TOKEN)" ]; then
  # A .env from before the tunnel was a profile: it keeps its tunnel.
  say 'a tunnel token and no remote path profile: starting the tunnel as before. Add cloudflare to COMPOSE_PROFILES in .env to say so.'
  profiles="$(setting COMPOSE_PROFILES)"
  export COMPOSE_PROFILES="${profiles:+${profiles},}cloudflare"
  REMOTE="$(remote_services)"
fi
path="$(setting OYL_INSTANCE_REMOTE_PATH)"
case "${REMOTE}" in
  *tailscale*tunnel* | *tunnel*tailscale*)
    die 'COMPOSE_PROFILES turns on both tailscale and cloudflare: an instance has one origin, so choose one (docs/self-hosting/home-machine.md).' ;;
  tailscale)
    case "${path}" in
      tailnet | funnel) ;;
      *) die 'the tailscale profile needs OYL_INSTANCE_REMOTE_PATH=tailnet (or funnel) in .env.' ;;
    esac ;;
  tunnel)
    [ -n "$(setting CLOUDFLARE_TUNNEL_TOKEN)" ] ||
      die 'the cloudflare profile needs CLOUDFLARE_TUNNEL_TOKEN in .env beside compose.yaml.'
    case "${path}" in
      '' | cloudflare) ;;
      *) die "the cloudflare profile needs OYL_INSTANCE_REMOTE_PATH=cloudflare, or empty, in .env." ;;
    esac ;;
  '')
    say 'no remote path profile in COMPOSE_PROFILES: the instance is reachable on this machine only.' ;;
esac

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

# shellcheck disable=SC2086 # the remote services are words: none, or one name
OYL_INSTANCE_IMAGE="${image}" compose up -d ${REMOTE} backup
# The tag a hand-run `docker compose …` uses when OYL_INSTANCE_IMAGE is not set.
docker tag "${image}" onyourleft-instance:local
printf 'image=%s\nprevious=%s\nsnapshot=%s\n' "${image}" "${previous}" "${snapshot}" > "${STATE}"
say "${image} is ready, in $(($(date +%s) - started_at)) s."

# The round trip (#2805): the origin read back from the running instance is
# the name serve answers on, or every card the instance draws names another.
if [ "${REMOTE}" = 'tailscale' ]; then
  served="$(tailnet_origin)" ||
    die 'Tailscale did not sign in: see docker compose logs tailscale, then run this again.'
  origin="$(running_origin)"
  [ "${origin}" = "${served}" ] ||
    die "the instance's origin is ${origin:-not set}, and tailscale serve answers on ${served}: set OYL_INSTANCE_ORIGIN=${served} in .env and run this again. Every device then scans the new card."
  say "reached on your tailnet at ${served}"
fi
