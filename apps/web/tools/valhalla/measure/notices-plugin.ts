// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The measurement page's licence notices (#2320).
 *
 * The page serves `valhalla-browser`'s worker and WebAssembly from its own
 * origin, which is redistributing the runtime, and the package asks for its
 * notices to travel with it: *"Compiled dependencies' license texts are
 * included under `dist/licenses/`; preserve these notices when redistributing
 * the runtime."* So the page serves `licences/valhalla-browser.txt`: the
 * package's MIT `LICENSE`, its `NOTICE.md`, and every file in
 * `dist/licenses/` (Valhalla, Boost, Protobuf, zlib and the rest), verbatim.
 *
 * Not `apps/web/public/licences/third-party.txt`, which is the product's
 * distributed closure (`check:notices`, §4g): the package is a devDependency
 * and the product ships none of it. When snapping ships (#2009's build), it
 * becomes a dependency and that document takes it, all fifteen texts with it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { Plugin } from 'vite';

/** Where the page serves the document. */
export const NOTICES_PATH = 'licences/valhalla-browser.txt';

/** The installed package's root directory. */
export function packageRoot(): string {
  const require = createRequire(import.meta.url);
  return dirname(dirname(require.resolve('valhalla-browser/runtime.json')));
}

/** The files whose text goes into the document, relative to the package root, in order. */
export function noticeFiles(root: string): string[] {
  const licences = readdirSync(join(root, 'dist', 'licenses'))
    .filter((name) => !name.startsWith('.'))
    .sort()
    .map((name) => `dist/licenses/${name}`);
  if (licences.length === 0)
    throw new Error('valhalla-browser ships no dist/licenses/: read the new version first');
  return ['LICENSE', 'NOTICE.md', ...licences];
}

/** The document: each file's path and its text, verbatim. */
export function noticesDocument(root: string): string {
  const { name, version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
  };
  const sections = noticeFiles(root).map(
    (file) =>
      `${'='.repeat(78)}\n${name}@${version}: ${file}\n${'='.repeat(78)}\n\n${readFileSync(join(root, file), 'utf8')}`,
  );
  return `${[`Licence notices for ${name}@${version}, as its npm package ships them.`, ...sections].join('\n\n').trimEnd()}\n`;
}

/** Serves the document in `vite` and writes it into `vite build`'s output. */
export function valhallaNotices(root: string = packageRoot()): Plugin {
  return {
    name: 'oyl-valhalla-notices',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== `/${NOTICES_PATH}`) {
          next();
          return;
        }
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.end(noticesDocument(root));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: NOTICES_PATH, source: noticesDocument(root) });
    },
  };
}
