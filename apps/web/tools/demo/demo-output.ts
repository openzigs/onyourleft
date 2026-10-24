// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the demo build writes besides its bundle, and what it must not — #1645.
 *
 * ## Only two directories of `public/`
 *
 * The product's `public/` holds the web app manifest, its icons, the pose
 * model and the map glyphs as well as the realistic world. The demo needs the
 * realistic world (the owner's ruling on #1643: it loads from the start) and
 * the licence texts (AGPL §6: the bundle is conveyed to every visitor), and
 * nothing else. So the config sets `publicDir: false` and this copies
 * {@link DEMO_PUBLIC_DIRECTORIES} after the bundle is written. It copies the
 * committed files and adds none, so `REALISTIC_BUILD_BYTES` does not move.
 *
 * ## No service worker and no manifest
 *
 * The demo is embedded in somebody else's page. A worker would cache it on
 * that visitor's device and outlive the visit; a manifest would offer to
 * install a page that is not the app. After the build has been written, the
 * output is listed and a `sw.js` or a manifest anywhere in it fails the build.
 */

import { cpSync, existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import type { Plugin } from 'vite';

/** The directories of `public/` the demo ships, under the same names. */
export const DEMO_PUBLIC_DIRECTORIES = ['realistic', 'licences'] as const;

/** Every file under `directory`, as `/`-separated paths relative to it. */
export function filesUnder(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)).replace(/\\/g, '/'));
}

/** The files that make a page a service-worker app or an installable one. */
export function workerOrManifest(files: readonly string[]): string[] {
  return files.filter((file) => {
    const name = file.split('/').pop() ?? file;
    return name === 'sw.js' || name === 'manifest.json' || name.endsWith('.webmanifest');
  });
}

/** The plugin: copies the directories, then reads back what the build wrote. */
export function demoOutput(publicDirectory: string): Plugin {
  let outDir = '';
  return {
    name: 'oyl-demo-output',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      for (const directory of DEMO_PUBLIC_DIRECTORIES) {
        cpSync(join(publicDirectory, directory), join(outDir, directory), { recursive: true });
      }
    },
    closeBundle() {
      // A build that failed wrote nothing, and its own error is the one to see.
      if (!existsSync(outDir)) return;
      const found = workerOrManifest(filesUnder(outDir));
      if (found.length > 0) {
        throw new Error(
          `oyl-demo-output: the demo build wrote a service worker or a web app manifest, and it ` +
            `must have neither (#1645):\n  - ${found.join('\n  - ')}`,
        );
      }
    },
  };
}
