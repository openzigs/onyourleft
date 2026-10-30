// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DEMO_PUBLIC_DIRECTORIES, demoOutput, filesUnder, workerOrManifest } from './demo-output';

const made: string[] = [];

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'oyl-demo-output-'));
  made.push(path);
  return path;
}

function write(path: string, contents = ''): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, contents);
}

afterEach(() => {
  for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true });
});

/** The plugin, configured as Vite would, against `root` with `outDir` inside it. */
function pluginFor(publicDirectory: string, root: string) {
  const plugin = demoOutput(publicDirectory);
  const call = (hook: unknown, ...args: unknown[]): void => {
    (hook as (...a: unknown[]) => void).call({}, ...args);
  };
  call(plugin.configResolved, { root, build: { outDir: 'dist' } });
  return {
    writeBundle: () => {
      call(plugin.writeBundle);
    },
    closeBundle: () => {
      call(plugin.closeBundle);
    },
  };
}

describe('the demo build ships no worker and no manifest — #1645', () => {
  it('finds a service worker or a manifest at any depth, and nothing else', () => {
    expect(
      workerOrManifest([
        'index.html',
        'assets/index-abc.js',
        'sw.js',
        'manifest.webmanifest',
        'nested/manifest.json',
        'realistic/sw.js.map',
      ]),
    ).toEqual(['sw.js', 'manifest.webmanifest', 'nested/manifest.json']);
  });

  it('fails the build once a service worker has been written', () => {
    const root = directory();
    write(join(root, 'dist/index.html'));
    write(join(root, 'dist/sw.js'));
    expect(() => {
      pluginFor(directory(), root).closeBundle();
    }).toThrow(/a service worker or a web app manifest[\s\S]*- sw\.js/);
  });

  it('lets an output with neither through', () => {
    const root = directory();
    write(join(root, 'dist/index.html'));
    write(join(root, 'dist/assets/index.js'));
    expect(() => {
      pluginFor(directory(), root).closeBundle();
    }).not.toThrow();
  });
});

describe('the demo build copies three directories of public/, and only those', () => {
  it('copies the realistic world, the licences and the glyphs, and leaves the manifest and icons behind', () => {
    const publicDirectory = directory();
    write(join(publicDirectory, 'realistic/road.ktx2'), 'road');
    write(join(publicDirectory, 'licences/third-party.txt'), 'notices');
    // #1683: the banners' glyphs, with the font's licence beside them.
    write(join(publicDirectory, 'glyphs/Roboto-Regular/0-255.pbf'), 'glyphs');
    write(join(publicDirectory, 'manifest.webmanifest'), '{}');
    write(join(publicDirectory, 'icon-192.png'));
    write(join(publicDirectory, 'pose/model.task'));
    const root = directory();
    // The transcoder the bundle wrote already, which the copy must not remove.
    write(join(root, 'dist/realistic/basis/basis_transcoder.wasm'));
    const plugin = pluginFor(publicDirectory, root);
    plugin.writeBundle();
    expect(filesUnder(join(root, 'dist')).sort()).toEqual([
      'glyphs/Roboto-Regular/0-255.pbf',
      'licences/third-party.txt',
      'realistic/basis/basis_transcoder.wasm',
      'realistic/road.ktx2',
    ]);
    expect(DEMO_PUBLIC_DIRECTORIES).toEqual(['realistic', 'licences', 'glyphs']);
    expect(() => {
      plugin.closeBundle();
    }).not.toThrow();
    expect(existsSync(join(root, 'dist/manifest.webmanifest'))).toBe(false);
  });
});
