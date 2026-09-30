# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The instance server as a container image (#767, #780, #807) — the first
# deploy target (ADR 0036 D-7, ADR 0037 D-8): the owner's machine, behind a
# Cloudflare Tunnel. `deploy/home/compose.yaml` runs it.
#
# Build from the REPOSITORY ROOT, with the commit it is built from:
#
#   docker build --build-arg OYL_INSTANCE_COMMIT="$(git rev-parse HEAD)" \
#     -f apps/instance/Dockerfile -t onyourleft-instance .
#
# ⚠️ The context is the root, not this directory, since #780: the room core
# imports three of this repository's packages (`packages/domain`, `physics`,
# `protocol`), and the instance has runtime dependencies (`kysely`, `ws`) to
# install from the lockfile. `Dockerfile.dockerignore` beside this file is
# the context's allowlist — BuildKit reads it for this Dockerfile alone — so
# nothing else in the repository reaches the build.
#
# No build step: Node 24 runs the TypeScript as committed, and `src/main.ts`
# registers the resolve hook that lets it load the packages'
# extensionless imports (`src/node-imports.ts`).
#
# ⚠️ The base image is pinned by DIGEST as well as by version, for the reason
# CLAUDE.md §8 pins every action to a commit: a tag is mutable. Read with
# `docker buildx imagetools inspect node:24.21.0-bookworm-slim` on 2026-09-29.
# Both stages name the same image, so a build pulls it once.

FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS install

# A production install of the instance and the workspace packages it names,
# from the lockfile and nothing else: `--frozen-lockfile` fails rather than
# resolve anything the lockfile does not describe, and `--prod` installs no
# test runner, no typechecker and no `workerd`. `--ignore-scripts`: nothing
# the instance depends on has an install script to run (pnpm-workspace.yaml).
WORKDIR /srv
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/instance/package.json apps/instance/
COPY packages/domain/package.json packages/domain/
COPY packages/physics/package.json packages/physics/
COPY packages/protocol/package.json packages/protocol/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter @onyourleft/instance...
COPY packages/domain packages/domain
COPY packages/physics packages/physics
COPY packages/protocol packages/protocol
COPY apps/instance apps/instance

FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

# The commit is REQUIRED: `GET /source` answers with the source of this exact
# build (AGPL-3.0 §13, ADR 0036 D-6), and an image that does not know which
# build it is could only point at `main`. So a build without it fails here,
# rather than an instance that starts and then refuses.
ARG OYL_INSTANCE_COMMIT
RUN test -n "${OYL_INSTANCE_COMMIT}" || { \
      echo 'Build with --build-arg OYL_INSTANCE_COMMIT="$(git rev-parse HEAD)".' >&2; exit 1; }

COPY --from=install /srv /srv
WORKDIR /srv/apps/instance

# One volume holds everything the instance keeps: the database and the blobs.
# It belongs to the unprivileged user the server runs as.
RUN mkdir /data && chown node:node /data
VOLUME /data

ENV NODE_ENV=production \
    OYL_INSTANCE_HOST=0.0.0.0 \
    OYL_INSTANCE_PORT=8787 \
    OYL_INSTANCE_DATABASE=/data/instance.sqlite \
    OYL_INSTANCE_BLOBS=/data/blobs \
    OYL_INSTANCE_COMMIT=${OYL_INSTANCE_COMMIT}

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# The server. The deploy runs `node src/operator/cli.ts migrate` in this
# image FIRST, as its own step (#791): the server never migrates.
CMD ["node", "src/main.ts"]
