// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The routing graph the gate routes on (#2734), served the way R2 behind the
 * CDN serves the published one.
 *
 * `valhalla-grid/` holds one release of the synthetic grid off Null Island
 * (`tools/valhalla/synthetic-grid.ts`; its README says how it was built and
 * why it is committed). `vite preview`'s own static server would not do:
 * `valhalla-browser` refuses a tile whose `ETag` is not the strong validator
 * its manifest records (the MD5, quoted, as R2 gives a single-part upload) or
 * that comes without `Last-Modified`, and the preview server sends a weak
 * `ETag` of its own. So this plugin answers `/valhalla-grid/…` itself, with
 * the headers `tools/valhalla/upload.sh` checks on the real host, and before
 * the static server sees the request.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Plugin } from 'vite';

import { GRID_PATH } from './valhalla-grid-release';

const ROOT = fileURLToPath(new URL('./valhalla-grid/', import.meta.url));

/** When the release was "uploaded": any fixed instant, sent as `Last-Modified`. */
const LAST_MODIFIED = new Date('2026-11-24T00:00:00Z').toUTCString();

export function valhallaGridServer(): Plugin {
  return {
    name: 'oyl-valhalla-grid',
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0] ?? '';
        if (!path.startsWith(GRID_PATH)) {
          next();
          return;
        }
        const file = normalize(join(ROOT, decodeURIComponent(path.slice(GRID_PATH.length))));
        if (
          !file.startsWith(ROOT.endsWith(sep) ? ROOT : `${ROOT}${sep}`) ||
          !existsSync(file) ||
          statSync(file).isDirectory()
        ) {
          response.statusCode = 404;
          response.end();
          return;
        }
        const bytes = readFileSync(file);
        response.setHeader(
          'Content-Type',
          file.endsWith('.json') ? 'application/json' : 'application/octet-stream',
        );
        response.setHeader('Content-Length', String(bytes.length));
        response.setHeader('ETag', `"${createHash('md5').update(bytes).digest('hex')}"`);
        response.setHeader('Last-Modified', LAST_MODIFIED);
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        response.setHeader('Accept-Ranges', 'bytes');
        response.end(request.method === 'HEAD' ? undefined : bytes);
      });
    },
  };
}
