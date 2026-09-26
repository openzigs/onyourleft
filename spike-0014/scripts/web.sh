#!/bin/bash
# Rebuild the product and stage the harness pages into apps/web/dist.
set -eu
export PATH=~/.nvm/versions/node/v24.20.0/bin:$PATH
cd $REPO
corepack pnpm run build 2>&1 | tail -2
corepack pnpm --filter @onyourleft/web run realistic:stage 2>&1 | tail -1
