# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The instance server as a container image (#767) — the first deploy target
# (ADR 0036 D-7, ADR 0037 D-8): the owner's machine, behind a Cloudflare
# Tunnel. #807 takes it on to compose, the tunnel and backups.
#
# Build from THIS directory, with the commit it is built from:
#
#   docker build --build-arg OYL_INSTANCE_COMMIT="$(git rev-parse HEAD)" \
#     -t onyourleft-instance apps/instance
#
# ⚠️ No build stage and no `npm install`: the instance has no runtime
# dependency (`third-party.txt` says so, and `check:notices` holds it), and
# Node 24 runs the TypeScript as committed. The first dependency (#769's Kysely)
# adds an install step here, from the lockfile.
#
# ⚠️ The base image is pinned by DIGEST as well as by version, for the reason
# CLAUDE.md §8 pins every action to a commit: a tag is mutable. Read with
# `docker buildx imagetools inspect node:24.21.0-bookworm-slim` on 2026-09-29.
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

# The commit is REQUIRED: `GET /source` answers with the source of this exact
# build (AGPL-3.0 §13, ADR 0036 D-6), and an image that does not know which
# build it is could only point at `main`. So a build without it fails here,
# rather than an instance that starts and then refuses.
ARG OYL_INSTANCE_COMMIT
RUN test -n "${OYL_INSTANCE_COMMIT}" || { \
      echo 'Build with --build-arg OYL_INSTANCE_COMMIT="$(git rev-parse HEAD)".' >&2; exit 1; }

WORKDIR /srv/instance
COPY package.json LICENSE third-party.txt ./
COPY src ./src

ENV NODE_ENV=production \
    OYL_INSTANCE_HOST=0.0.0.0 \
    OYL_INSTANCE_PORT=8787 \
    OYL_INSTANCE_COMMIT=${OYL_INSTANCE_COMMIT}

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "src/main.ts"]
