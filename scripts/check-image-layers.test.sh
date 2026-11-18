#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for scripts/check-image-layers.sh -- #2786.
#
# Each case writes a small image archive in the shape `docker save` writes
# (a manifest.json naming a config and its layers, each layer a tar) and runs
# the checker on it, either with --archive or through a fake `docker` first
# on PATH whose `save` prints it. No Docker is needed.
#
# Run: bash scripts/check-image-layers.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="${SCRIPT_DIR}/check-image-layers.sh"

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
assert_exit() {
  if [ "${code}" -eq "$2" ]; then ok "$1"; else bad "$1 (exit ${code}, wanted $2)"; fi
}
assert_says() {
  if grep -qF -- "$2" <<< "${out}"; then ok "$1"; else bad "$1 (no '$2')"; fi
}
assert_not_says() {
  if grep -qF -- "$2" <<< "${out}"; then bad "$1 (said '$2')"; else ok "$1"; fi
}

# new_fixture -- an empty image: a config with a harmless environment and no layers yet.
new_fixture() {
  cleanup
  tmp="$(mktemp -d)"
  mkdir -p "${tmp}/image/blobs/sha256" "${tmp}/bin"
  layers=()
  config_env='"PATH=/usr/bin","NODE_ENV=production","OYL_INSTANCE_PORT=8787"'
  cat > "${tmp}/bin/docker" <<'FAKE'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >> "${OYL_FAKE_CALLS}"
case "$1" in
  save) [ -f "${OYL_FAKE_ARCHIVE}" ] && cat "${OYL_FAKE_ARCHIVE}" ;;
  *) exit 99 ;;
esac
FAKE
  chmod +x "${tmp}/bin/docker"
  : > "${tmp}/calls"
}

# add_layer NAME PATH... -- a layer holding these paths (a trailing / is a folder).
add_layer() {
  local name="$1" root
  shift
  root="${tmp}/layer-${name}"
  mkdir -p "${root}"
  for path in "$@"; do
    case "${path}" in
      */) mkdir -p "${root}/${path}" ;;
      *) mkdir -p "$(dirname "${root}/${path}")" && printf 'x\n' > "${root}/${path}" ;;
    esac
  done
  tar -cf "${tmp}/image/blobs/sha256/${name}" -C "${root}" .
  layers+=("blobs/sha256/${name}")
}

# pack -- write the config and the manifest, and the archive both forms read.
pack() {
  printf '{"architecture":"amd64","config":{"Env":[%s],"User":"node"}}' "${config_env}" \
    > "${tmp}/image/blobs/sha256/config"
  local joined=''
  for layer in ${layers[@]+"${layers[@]}"}; do
    joined+="${joined:+,}\"${layer}\""
  done
  printf '[{"Config":"blobs/sha256/config","RepoTags":["oyl:test"],"Layers":[%s]}]\n' "${joined}" \
    > "${tmp}/image/manifest.json"
  tar -cf "${tmp}/image.tar" -C "${tmp}/image" .
}

run_archive() {
  out="$(bash "${CHECK}" --archive "${tmp}/image.tar" 2>&1)"
  code=$?
}
run_image() {
  out="$(OYL_FAKE_ARCHIVE="${tmp}/image.tar" OYL_FAKE_CALLS="${tmp}/calls" PATH="${tmp}/bin:${PATH}" \
    bash "${CHECK}" "$1" 2>&1)"
  code=$?
}

# --- Green -------------------------------------------------------------------------

new_fixture
add_layer base etc/environment usr/bin/env usr/bin/printenv etc/security/pam_env.conf
add_layer app srv/apps/instance/src/main.ts srv/apps/instance/src/secret-key.ts srv/node_modules/dotenv-like/index.js
pack
run_archive
assert_exit 'an image of ordinary files passes' 0
assert_says 'and says how many layers it read' '2 layers read'

run_image oyl:test
assert_exit 'the same image named rather than given passes' 0
if grep -qxF 'docker save oyl:test' "${tmp}/calls"; then ok 'and is read with docker save'; else bad 'and is read with docker save'; fi

# --- LAYER001 ----------------------------------------------------------------------

for secret in srv/.env srv/apps/instance/deploy/home/.env srv/.env.local \
  srv/apps/instance/deploy/home/instance.env.example srv/instance.env srv/production.env \
  run/secrets/onyourleft/discord-bot-token srv/secrets/ srv/apps/instance/deploy/home/.deployed \
  srv/discord-bot-token; do
  new_fixture
  add_layer base usr/bin/env
  add_layer app srv/apps/instance/src/main.ts "${secret}"
  pack
  run_archive
  assert_exit "a layer holding ${secret} fails" 1
  assert_says 'as LAYER001, naming the path' "${secret%/}"
done

# A file one layer adds and a later one deletes is gone from the container and
# still in the image.
new_fixture
add_layer base usr/bin/env
add_layer leak srv/.env
add_layer cover srv/.wh..env srv/main.ts
pack
run_archive
assert_exit 'an env file a later layer deletes still fails' 1
assert_says 'as LAYER001' 'LAYER001'
assert_says 'naming the layer copy' 'srv/.env'

run_image oyl:test
assert_exit 'and fails the same when read through docker save' 1
assert_says 'as LAYER001' 'LAYER001 oyl:test'

# --- LAYER002 ----------------------------------------------------------------------

for variable in CLOUDFLARE_TUNNEL_TOKEN OYL_INSTANCE_SECRET_KEY OYL_INSTANCE_OWNER_KEY DB_PASSWORD; do
  new_fixture
  add_layer base usr/bin/env
  config_env="\"PATH=/usr/bin\",\"${variable}=abc\""
  pack
  run_archive
  assert_exit "an image that sets ${variable} fails" 1
  assert_says 'as LAYER002, naming the variable' "${variable}"
  assert_not_says 'and never its value' 'abc'
done

# --- LAYER003 ----------------------------------------------------------------------

new_fixture
pack
run_archive
assert_exit 'an image with no layers fails rather than passing unread' 1
assert_says 'as LAYER003' 'LAYER003'

new_fixture
add_layer base usr/bin/env
pack
printf 'not a tar' > "${tmp}/image/blobs/sha256/base"
tar -cf "${tmp}/image.tar" -C "${tmp}/image" .
run_archive
assert_exit 'a layer that does not list fails' 1
assert_says 'as LAYER003, naming it' 'could not be listed: blobs/sha256/base'

new_fixture
add_layer base usr/bin/env
pack
rm "${tmp}/image/manifest.json"
tar -cf "${tmp}/image.tar" -C "${tmp}/image" .
run_archive
assert_exit 'an archive with no manifest fails' 1
assert_says 'as LAYER003' 'has no manifest.json'

new_fixture
add_layer base usr/bin/env
pack
rm "${tmp}/image/blobs/sha256/config"
tar -cf "${tmp}/image.tar" -C "${tmp}/image" .
run_archive
assert_exit 'an archive without the configuration it names fails' 1
assert_says 'as LAYER003' 'configuration (blobs/sha256/config) is not in the archive'

new_fixture
out="$(bash "${CHECK}" --archive "${tmp}/nothing.tar" 2>&1)"
code=$?
assert_exit 'a missing archive fails' 1
assert_says 'as LAYER003' 'there is no archive at'

new_fixture
run_image oyl:gone
assert_exit 'an image docker cannot save fails' 1
assert_says 'as LAYER003' 'LAYER003'

new_fixture
out="$(bash "${CHECK}" 2>&1)"
code=$?
assert_exit 'no image at all fails' 1
assert_says 'as LAYER003' 'name an image'

printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
[ "${fail}" -eq 0 ]
