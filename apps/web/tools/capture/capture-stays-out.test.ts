// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  CAPTURE_MODE,
  CAPTURE_SCENE_MARK as SCENE_MARK,
  CAPTURE_SCENES,
} from '../../src/game/capture-scene';
import {
  CAPTURE_BUILD_MODE,
  CAPTURE_SCENE_MARK,
  captureInProduct,
  captureOutDir,
  captureStaysOut,
} from './capture-stays-out';

type Hook = (...args: unknown[]) => void;

/** The plugin, run as a build in `mode` would run it, over `bundle`. */
function runPlugin(mode: string, bundle: Record<string, unknown>): void {
  const plugin = captureStaysOut();
  (plugin.configResolved as unknown as Hook)({ mode });
  (plugin.generateBundle as unknown as Hook).call(
    {
      error(message: string): never {
        throw new Error(message);
      },
    },
    {},
    bundle,
  );
}

const WITH_SCENE = {
  'assets/ride.js': {
    type: 'chunk',
    fileName: 'assets/ride.js',
    code: 'const s={"route-hud":{id:"oyl-capture-scene:route-hud",keys:[]}};',
  },
  'sw.js': { type: 'asset', fileName: 'sw.js', source: 'oyl-capture-scene:route-hud' },
};

describe('no build but the capture tool’s carries capture mode — PR #3160', () => {
  it('mirrors capture-scene.ts: the same mode and the same mark, which begins every scene’s id', () => {
    expect(CAPTURE_BUILD_MODE).toBe(CAPTURE_MODE);
    expect(CAPTURE_SCENE_MARK).toBe(SCENE_MARK);
    for (const [name, scene] of Object.entries(CAPTURE_SCENES)) {
      expect(scene.id).toBe(`${CAPTURE_SCENE_MARK}${name}`);
    }
  });

  it('finds a scene in a chunk’s code by the mark, never by a name the product carries anyway (#3153)', () => {
    expect(
      captureInProduct([
        // What `routes.ts` and `courses.ts` carry in every release: no scene.
        { fileName: 'assets/index.js', code: 'x="delivery";y="lap-race";z="workout";p="pacer"' },
        { fileName: 'assets/ride.js', code: 'x="oyl-capture-scene:delivery"' },
      ]),
    ).toEqual(['assets/ride.js']);
  });

  it('fails a production build that carries one', () => {
    expect(() => {
      runPlugin('production', WITH_SCENE);
    }).toThrow(/oyl-capture-stays-out: a production build [\s\S]*- assets\/ride\.js/);
  });

  it('lets the capture tool’s build carry it — the control', () => {
    expect(() => {
      runPlugin('capture', WITH_SCENE);
    }).not.toThrow();
  });

  it('lets a production build with none through', () => {
    expect(() => {
      runPlugin('production', {
        'assets/ride.js': { type: 'chunk', fileName: 'assets/ride.js', code: 'ride()' },
      });
    }).not.toThrow();
  });
});

describe('the capture tool’s build has a directory of its own — #3153', () => {
  type ConfigHook = (config: object, env: { readonly mode: string }) => unknown;
  const hook = captureOutDir('/web/capture/dist/app').config as unknown as ConfigHook;

  it('writes the capture build there, so `dist`, Capacitor’s webDir, is never one', () => {
    expect(hook({}, { mode: 'capture' })).toEqual({ build: { outDir: '/web/capture/dist/app' } });
  });

  it('leaves every other build where its config says', () => {
    for (const mode of ['production', 'development', 'Capture']) {
      expect(hook({}, { mode })).toBeUndefined();
    }
  });
});
