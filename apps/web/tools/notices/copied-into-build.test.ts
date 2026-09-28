// SPDX-License-Identifier: AGPL-3.0-or-later

import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { POSE_DIRECTORY, POSE_RUNTIME_WASM_FILE } from '../../src/camera/pose-files';
import {
  copiedIntoBuild,
  fromAPackage,
  unnoticedCopies,
  unnoticedVendored,
  vendoredModule,
  type BuiltAsset,
} from './copied-into-build';
import { REALISTIC_TRANSCODER_DIRECTORY } from '../../src/game/transcoder-files';
import { TRANSCODER_FILES } from '../basis/transcoder-plugin';

const WEB_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const POSE_RUNTIME = `${POSE_DIRECTORY}${POSE_RUNTIME_WASM_FILE}`;
/** What `tools/basis/transcoder-plugin.ts` emits — #618: a plugin's `emitFile`, so no original file. */
const TRANSCODER = Object.fromEntries(
  TRANSCODER_FILES.map((name) => {
    const fileName = `${REALISTIC_TRANSCODER_DIRECTORY}${name}`;
    return [fileName, { type: 'asset' as const, fileName, originalFileNames: [] as string[] }];
  }),
);

/** Where pnpm installs three, as Rolldown names a module id from it. */
const THREE = '/repo/node_modules/.pnpm/three@0.185.1/node_modules/three/';
/** The renderer chunk as the real build writes it — #618's review: it bundles KTX-Parse and zstddec. */
const RENDERER = {
  'assets/three-renderer-abc.js': {
    type: 'chunk' as const,
    fileName: 'assets/three-renderer-abc.js',
    modules: {
      [`${THREE}build/three.module.js`]: {},
      [`${THREE}examples/jsm/loaders/KTX2Loader.js`]: {},
      [`${THREE}examples/jsm/libs/ktx-parse.module.js`]: {},
      [`${THREE}examples/jsm/libs/zstddec.module.js`]: {},
    },
  },
};

function asset(fileName: string, ...originalFileNames: string[]): BuiltAsset {
  return { fileName, originalFileNames };
}

/** The plugin's hook, run against a bundle of the shape Rolldown hands it. */
function runPlugin(bundle: Record<string, unknown>): void {
  const plugin = copiedIntoBuild(WEB_ROOT);
  const hook = plugin.generateBundle as unknown as (
    this: { error: (message: string) => never },
    options: unknown,
    bundle: Record<string, unknown>,
  ) => void;
  hook.call(
    {
      error(message: string): never {
        throw new Error(message);
      },
    },
    {},
    bundle,
  );
}

describe('a file the build copies out of a package is named in the notices — #664', () => {
  it('reads an asset a plugin emitted with no origin as a package’s, which is how the pose runtime arrives', () => {
    expect(fromAPackage(asset('pose/runtime.wasm'))).toBe(true);
  });

  it('reads an asset emitted for a module under node_modules as a package’s', () => {
    expect(
      fromAPackage(
        asset('assets/sprite-abc.png', '../../node_modules/.pnpm/x@1/node_modules/x/sprite.png'),
      ),
    ).toBe(true);
  });

  it('reads an asset emitted for this repository’s own source as ours', () => {
    expect(fromAPackage(asset('assets/tree_oak-abc.glb', 'src/game/models/tree_oak.glb'))).toBe(
      false,
    );
  });

  it('fails a package’s binary the list does not name', () => {
    expect(unnoticedCopies([asset('pose/runtime.wasm')], []).unnamed).toEqual([
      'pose/runtime.wasm',
    ]);
    expect(
      unnoticedCopies([asset('assets/sprite-abc.png', 'node_modules/x/sprite.png')], []).unnamed,
    ).toEqual(['assets/sprite-abc.png']);
  });

  it('passes it once the list names it', () => {
    expect(unnoticedCopies([asset('pose/runtime.wasm')], [{ path: 'pose/runtime.wasm' }])).toEqual({
      unnamed: [],
      stale: [],
    });
  });

  it('leaves code to the closure: a worker built from a package is a .js asset with no origin', () => {
    expect(
      unnoticedCopies(
        [asset('assets/maplibre-gl-worker-abc.js'), asset('assets/index-abc.css', 'index.html')],
        [],
      ).unnamed,
    ).toEqual([]);
  });

  it('leaves this repository’s own binaries alone', () => {
    expect(
      unnoticedCopies([asset('assets/colormap-abc.png', 'src/game/models/colormap.png')], [])
        .unnamed,
    ).toEqual([]);
  });

  it('reports a named file the build no longer writes', () => {
    expect(unnoticedCopies([], [{ path: 'pose/runtime.wasm' }]).stale).toEqual([
      'pose/runtime.wasm',
    ]);
  });

  it('lets the real build through: the committed list names the pose runtime and — #618 — the transcoder', () => {
    expect(() => {
      runPlugin({
        [POSE_RUNTIME]: { type: 'asset', fileName: POSE_RUNTIME, originalFileNames: [] },
        ...TRANSCODER,
        ...RENDERER,
        'assets/index-abc.js': { type: 'chunk', fileName: 'assets/index-abc.js', modules: {} },
      });
    }).not.toThrow();
  });

  it('fails the build when the transcoder’s .wasm is not written — #618', () => {
    // Its `.js` is code and is not this rule's; its `.wasm` is, and the list
    // names both, so a build that stopped writing it is a stale entry.
    const withoutWasm = Object.fromEntries(
      Object.entries(TRANSCODER).filter(([name]) => !name.endsWith('.wasm')),
    );
    expect(() => {
      runPlugin({
        [POSE_RUNTIME]: { type: 'asset', fileName: POSE_RUNTIME, originalFileNames: [] },
        ...withoutWasm,
        ...RENDERER,
      });
    }).toThrow(/realistic\/basis\/basis_transcoder\.wasm is in .* and the build did not write it/);
  });

  it('fails the build over a package’s binary the committed list does not name', () => {
    expect(() => {
      runPlugin({
        [POSE_RUNTIME]: { type: 'asset', fileName: POSE_RUNTIME, originalFileNames: [] },
        ...TRANSCODER,
        ...RENDERER,
        'assets/basis_transcoder-abc.wasm': {
          type: 'asset',
          fileName: 'assets/basis_transcoder-abc.wasm',
          originalFileNames: [],
        },
      });
    }).toThrow(/assets\/basis_transcoder-abc\.wasm is written out of a package/);
  });

  it('fails the build when a named file is no longer written', () => {
    expect(() => {
      runPlugin({ ...TRANSCODER, ...RENDERER });
    }).toThrow(/pose\/vision_wasm_module_internal\.wasm is in .* and the build did not write it/);
  });
});

describe('code a package vendors from somebody else is named in the notices — #618’s review', () => {
  it('reads a module under three’s examples/jsm/libs/ as vendored, and three’s own code as not', () => {
    expect(vendoredModule(`${THREE}examples/jsm/libs/zstddec.module.js`)).toEqual({
      package: 'three',
      file: 'examples/jsm/libs/zstddec.module.js',
    });
    expect(
      vendoredModule(`${THREE}examples/jsm/libs/zstddec.module.js?commonjs-es-import`),
    ).toEqual({ package: 'three', file: 'examples/jsm/libs/zstddec.module.js' });
    expect(vendoredModule(`${THREE}examples/jsm/loaders/KTX2Loader.js`)).toBeUndefined();
    expect(vendoredModule('/repo/apps/web/src/game/three-renderer.ts')).toBeUndefined();
  });

  it('fails a vendored module the list does not name, and a name the build no longer bundles', () => {
    expect(
      unnoticedVendored(
        [
          `${THREE}examples/jsm/libs/ktx-parse.module.js`,
          `${THREE}examples/jsm/libs/fflate.module.js`,
        ],
        [
          { package: 'three', file: 'examples/jsm/libs/ktx-parse.module.js' },
          { package: 'three', file: 'examples/jsm/libs/zstddec.module.js' },
        ],
      ),
    ).toEqual({
      unnamed: ['three/examples/jsm/libs/fflate.module.js'],
      stale: ['three/examples/jsm/libs/zstddec.module.js'],
    });
  });

  it('fails the build over a vendored module the committed list does not name', () => {
    const renderer = RENDERER['assets/three-renderer-abc.js'];
    expect(() => {
      runPlugin({
        [POSE_RUNTIME]: { type: 'asset', fileName: POSE_RUNTIME, originalFileNames: [] },
        ...TRANSCODER,
        'assets/three-renderer-abc.js': {
          ...renderer,
          modules: { ...renderer.modules, [`${THREE}examples/jsm/libs/fflate.module.js`]: {} },
        },
      });
    }).toThrow(/three\/examples\/jsm\/libs\/fflate\.module\.js is somebody else's code/);
  });

  it('fails the build when a named vendored module is no longer bundled', () => {
    expect(() => {
      runPlugin({
        [POSE_RUNTIME]: { type: 'asset', fileName: POSE_RUNTIME, originalFileNames: [] },
        ...TRANSCODER,
      });
    }).toThrow(
      /ktx-parse\.module\.js is in .* §vendoredIntoBundle and the build did not bundle it/,
    );
  });
});
