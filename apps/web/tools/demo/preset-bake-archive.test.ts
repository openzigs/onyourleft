// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Every committed preset route bakes, from the PUBLISHED archive, to its
 * committed record — #2268.
 *
 * `upstate-climb.bake.json` went stale without anything failing: the basemap
 * moved (ADR 0062) and the reader version did (#1789), and the record was
 * found refusing only when someone ran `demo:bake` by hand. The required half
 * of the check is in `bake-route.test.ts` §"the committed preset records
 * agree with this checkout", and needs no network: it holds the archive URL,
 * the reader version and the GPX's digest. This half reads the archive itself
 * for the other two fields, the archive's identity and the baked file's
 * digest — so it fails when the published archive is replaced, or when what
 * the reader makes of it changes without a reader-version bump.
 *
 * ⚠️ **It reaches the network**: about ten range requests to
 * `PUBLISHED_BASEMAP_URL`, the reads a rider on the route makes. So it runs
 * only with `OYL_DEMO_BAKE_ARCHIVE_CHECK=1`, and a plain `pnpm run test`
 * stays offline:
 *
 * ```sh
 * OYL_DEMO_BAKE_ARCHIVE_CHECK=1 pnpm exec vitest run apps/web/tools/demo/preset-bake-archive.test.ts
 * ```
 *
 * ⚠️ **CI does not set it.** `tiles.openzigs.com` answers a GitHub-hosted
 * runner with HTTP 403 for a range, where it answers a rider with 206 —
 * measured on this check's first nightly runs (run 42269980561). Until the
 * owner lets runners read the archive, a night here would only ever be red.
 * The file is in `test:uninstrumented` so that no required run selects it.
 * Its baked file goes nowhere; the record is never rewritten here
 * (`demo:bake -- --route <id> --record` does that, by hand, after a move on
 * purpose).
 */

import { describe, expect, it } from 'vitest';

import {
  archiveOf,
  bakeRoute,
  parseBakeArguments,
  PRESET_ROUTES_DIRECTORY,
  presetRouteIds,
  readBakeInput,
  recordDrift,
  recordOf,
  type BakeRecord,
} from './bake-route';

/** `1` to bake from the published archive; unset, nothing is fetched and the describe skips. */
const reachesNetwork = process.env['OYL_DEMO_BAKE_ARCHIVE_CHECK'] === '1';

describe.runIf(reachesNetwork)(
  'the preset routes bake from the published archive to their committed records — #2268',
  () => {
    const ids = presetRouteIds(PRESET_ROUTES_DIRECTORY);

    it('has a preset route to check', () => {
      expect(ids).toContain('upstate-climb');
    });

    it.each(ids)(
      '%s bakes to its record',
      async (id) => {
        // `demo:bake -- --route <id>`, as the CLI reads it: the committed GPX
        // and record, and the published archive by default.
        const args = parseBakeArguments(['--route', id]);
        const { gpx, committed } = readBakeInput(args, PRESET_ROUTES_DIRECTORY);
        const { archive, archiveUrl } = archiveOf(args.archive);
        // The read's own lines (`describeCorridorFailure`, which names no
        // coordinate) go into a failure, so a red night says why it was red.
        const lines: string[] = [];
        const log = (line: string): void => {
          lines.push(line);
        };
        const baked = await bakeRoute({ routeId: id, gpx, archive, archiveUrl, log }).catch(
          (error: unknown) => {
            throw new Error(
              [error instanceof Error ? error.message : String(error), ...lines].join('\n'),
            );
          },
        );
        expect(recordDrift(committed as BakeRecord, recordOf(baked.entry))).toStrictEqual([]);
      },
      120_000,
    );
  },
);
