// SPDX-License-Identifier: AGPL-3.0-or-later

import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { POSE_DIRECTORY, POSE_RUNTIME_WASM_FILE } from '../../src/camera/pose-files';
import {
  copiedIntoBuild,
  fromAPackage,
  unnoticedCopies,
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

function asset(fileName: string, ...originalFileNames: string[]): BuiltAsset {
  return { fileName, originalFileNames };
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

  it('lets the real build through: the committed list names the pose runtime and — #618 — the transcoder', () => {
    expect(() => {
      runPlugin({
        [POSE_RUNTIME]: { type: 'asset', fileName: POSE_RUNTIME, originalFileNames: [] },
        ...TRANSCODER,
        'assets/index-abc.js': { type: 'chunk', fileName: 'assets/index-abc.js' },
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
      });
    }).toThrow(/realistic\/basis\/basis_transcoder\.wasm is in .* and the build did not write it/);
  });

  it('fails the build over a package’s binary the committed list does not name', () => {
    expect(() => {
      runPlugin({
        [POSE_RUNTIME]: { type: 'asset', fileName: POSE_RUNTIME, originalFileNames: [] },
        ...TRANSCODER,
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
      runPlugin({ ...TRANSCODER });
    }).toThrow(/pose\/vision_wasm_module_internal\.wasm is in .* and the build did not write it/);
  });
});
