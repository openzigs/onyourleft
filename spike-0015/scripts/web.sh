#!/bin/bash
# Rebuild the product and stage the harness pages (realistic.html, godot-realistic.html) into apps/web/dist.
set -eu
export PATH=<local>
cd $REPO
corepack pnpm run build 2>&1 | tail -1
corepack pnpm --filter @onyourleft/web run realistic:stage 2>&1 | tail -1
