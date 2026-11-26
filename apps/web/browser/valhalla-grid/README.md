# The synthetic routing graph the browser gate routes on (#2734)

One release of a Valhalla 3.8.3 bicycle graph, built from the road grid off
Null Island that `apps/web/tools/valhalla/synthetic-grid.ts` writes: a 21 by
21 grid of streets about 550 m apart, and beside it a square of streets no
road reaches. **No real place and no OpenStreetMap data**: the grid is in open
sea, and every way in it was made by that script.

`browser/valhalla-grid.ts` serves it to `routing.browser.spec.ts` with the
headers R2 gives the published graph, and `routing-harness.tsx` routes on it
with the product's adapter and the real `valhalla-browser`.

## How it was built

```sh
node --import ./tools/ts-extensionless-resolve.mjs tools/valhalla/synthetic-grid.ts /tmp/grid/grid.osm.pbf
bash tools/valhalla/build-graph.sh --pbf /tmp/grid/grid.osm.pbf --prefix oyl-synthetic --out /tmp/grid/out --threads 2
```

run from `apps/web` on 2026-11-24, with Docker and the pinned image
`build-graph.sh` names. Copied from the release directory: `manifest.json`,
`config.json` and `tiles/`. Left out: `graph.tar` (the gate uses the
`individual-tiles` transport, which never reads it) and `NOTICE.txt` (its ODbL
notice is for a graph built from OpenStreetMap, which this is not).

## Why it is committed and not built in CI

Building it needs Docker and the Valhalla image (about a gigabyte), which no
CI shard pulls, and a Valhalla build is not byte-reproducible
(`tools/valhalla/README.md` §1), so a graph built in CI would be a different
release on every run. The two tiles are 142 KB together, and `ASSETS.toml`
records both, with the SHA-256 of the input they were built from;
`tools/valhalla/synthetic-grid.test.ts` holds the script to that input.

The JSON files are left out of Prettier (`.prettierignore`): the manifest
records the SHA-256 of `config.json` as it was written, and reformatting it
would make the SDK refuse the graph.
