// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { CAPTURE_MODE, CAPTURE_SCENES } from '../../src/game/capture-scene';
import {
  CAPTURE_BUILD_MODE,
  CAPTURE_SCENE_NAMES,
  captureInProduct,
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
    code: 'const s={"route-hud":{id:"route-hud",keys:[]}};',
  },
  'sw.js': { type: 'asset', fileName: 'sw.js', source: 'route-hud' },
};

describe('no build but the capture tool’s carries capture mode — PR #3160', () => {
  it('mirrors capture-scene.ts: the same mode and every scene name', () => {
    expect(CAPTURE_BUILD_MODE).toBe(CAPTURE_MODE);
    expect([...CAPTURE_SCENE_NAMES].sort()).toEqual(Object.keys(CAPTURE_SCENES).sort());
  });

  it('finds a scene in a chunk’s code', () => {
    expect(
      captureInProduct([
        { fileName: 'assets/index.js', code: 'route' },
        { fileName: 'assets/ride.js', code: 'x="route-hud"' },
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
