// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { CodePixels } from './camera-port';
import { CameraController, PAIRING_READER_UNAVAILABLE } from './session';
import { pairingCodeText } from './side-link-code';
import { pairingCodeFromPixels, pairingCodeModules } from './side-link-qr';
import { photographedCode as photographed, scriptedCamera } from './testing';

/** A realistic offer: two candidates and a secret, as `side-link.ts` makes one. */
const OFFER = (() => {
  const made = pairingCodeText(
    'offer',
    {
      ufrag: 'Zq8h',
      password: 'Qm3v0f8y1Jc9dZ2kL5nH7tRp',
      fingerprint: Uint8Array.from({ length: 32 }, (_, index) => index * 7),
      setup: 'actpass',
      candidates: [
        { address: '192.168.68.69', port: 50_123, transport: 'udp', type: 'host' },
        { address: 'fe80::1c2d:3e4f:5a6b:7c8d', port: 50_124, transport: 'udp', type: 'host' },
      ],
    },
    Uint8Array.from({ length: 32 }, (_, index) => 255 - index),
  );
  if (!('text' in made)) {
    throw new Error('no offer');
  }
  return made.text;
})();

describe('a pairing code, drawn and read back', () => {
  it('round-trips a whole offer through the drawing and the reader', () => {
    expect(pairingCodeFromPixels(photographed(pairingCodeModules(OFFER)))).toBe(OFFER);
  });

  it('draws a square grid with no quiet zone — the screen adds its own', () => {
    const modules = pairingCodeModules(OFFER);
    expect(modules.length).toBeGreaterThan(21);
    for (const row of modules) {
      expect(row).toHaveLength(modules.length);
    }
    // The top-left finder pattern starts at the very first module.
    expect(modules[0]?.slice(0, 7)).toEqual([true, true, true, true, true, true, true]);
  });

  it('reads a code shown light-on-dark, as a phone’s screen can photograph', () => {
    expect(pairingCodeFromPixels(photographed(pairingCodeModules(OFFER), 4, 245, 20))).toBe(OFFER);
  });

  it('finds nothing in a picture with no code, and nothing in pixels of the wrong length', () => {
    const blank = { width: 64, height: 64, rgba: new Uint8ClampedArray(64 * 64 * 4).fill(200) };
    expect(pairingCodeFromPixels(blank)).toBeUndefined();
    expect(
      pairingCodeFromPixels({ width: 64, height: 64, rgba: new Uint8ClampedArray(12) }),
    ).toBeUndefined();
  });
});

describe('reading a code with the camera — CameraController.readPairingCode', () => {
  function controllerOn(pixels: () => CodePixels) {
    const camera = scriptedCamera({ codePixels: pixels });
    const controller = new CameraController({
      port: camera.port,
      schedule: () => () => undefined,
    });
    return { camera, controller };
  }

  it('reads a code the running camera sees', async () => {
    const { controller } = controllerOn(() => photographed(pairingCodeModules(OFFER)));
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    await controller.turnOn();
    expect(await controller.readPairingCode()).toBe(OFFER);
  });

  it('opens no camera and reads nothing without the rider’s consent on THIS device', async () => {
    const { camera, controller } = controllerOn(() => photographed(pairingCodeModules(OFFER)));
    await controller.turnOn();
    expect(await controller.readPairingCode()).toBeUndefined();
    expect(camera.calls).not.toContain('start');
    expect(camera.calls).not.toContain('code');
  });

  it('reads nothing from a camera that is off', async () => {
    const { camera, controller } = controllerOn(() => photographed(pairingCodeModules(OFFER)));
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    await controller.turnOn();
    controller.turnOff();
    expect(await controller.readPairingCode()).toBeUndefined();
    expect(camera.calls).not.toContain('code');
  });

  it('reads nothing from a camera whose track ended by itself', async () => {
    const { camera, controller } = controllerOn(() => photographed(pairingCodeModules(OFFER)));
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    await controller.turnOn();
    camera.endTheTrack();
    expect(await controller.readPairingCode()).toBeUndefined();
    expect(camera.calls).not.toContain('code');
  });

  it('reads nothing once the rider withdraws consent', async () => {
    const { camera, controller } = controllerOn(() => photographed(pairingCodeModules(OFFER)));
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    await controller.turnOn();
    controller.revoke();
    expect(await controller.readPairingCode()).toBeUndefined();
    expect(camera.calls).not.toContain('code');
  });

  it('does not count a read as a capture — a code read is not a picture taken', async () => {
    const { controller } = controllerOn(() => photographed(pairingCodeModules(OFFER)));
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    await controller.turnOn();
    await controller.readPairingCode();
    expect(controller.state().captured).toBe(0);
  });

  it('says the reader is unavailable, distinctly, when its chunk will not load — #550’s second review', async () => {
    const camera = scriptedCamera({ codePixels: () => photographed(pairingCodeModules(OFFER)) });
    const controller = new CameraController({
      port: camera.port,
      schedule: () => () => undefined,
      loadCodeReader: async () => Promise.reject(new Error('the chunk would not load')),
    });
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    await controller.turnOn();
    await expect(controller.readPairingCode()).resolves.toBe(PAIRING_READER_UNAVAILABLE);
    // Nothing was read off the camera for a reader that is not there.
    expect(camera.calls).not.toContain('code');
  });

  it('never rejects when the read fails', async () => {
    const { controller } = controllerOn(() => {
      throw new Error('the camera went away');
    });
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    await controller.turnOn();
    await expect(controller.readPairingCode()).resolves.toBeUndefined();
  });
});

describe('the two QR libraries stay out of the entry chunk — #550’s review', () => {
  /**
   * A static import of `side-link-qr` anywhere in production code puts
   * `jsqr` and `uqr` in the bundle every launch downloads: `main.tsx` builds
   * the camera controller eagerly, and the Camera screens are in the entry
   * chunk. #550 shipped exactly that, +165 kB on every cold start, and every
   * gate was green. So the only production way in is `import()`, and this
   * reads the source for any other. `import type` is erased and allowed.
   */
  const SOURCE_ROOT = fileURLToPath(new URL('..', import.meta.url));

  function productionSources(directory: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        found.push(...productionSources(path));
      } else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.test\.tsx?$/.test(entry.name) &&
        !/-testing\.tsx?$/.test(entry.name) &&
        entry.name !== 'testing.ts'
      ) {
        found.push(path);
      }
    }
    return found;
  }

  it('is reached from production code by a dynamic import and nothing else', () => {
    // Every static form that pulls the module into the importing chunk:
    // `import … from`, `export … from` (a re-export) and a bare side-effect
    // `import '…'` (#550's second review). `import type` / `export type` are
    // erased and allowed.
    const staticImport =
      /^\s*(?:(?:import|export)\s+(?!type\b)[^;]*from\s+|import\s+)'[^']*\/side-link-qr(?:\.ts)?'/m;
    const probes = [
      "import { pairingCodeModules } from './side-link-qr';",
      "export { pairingCodeModules } from './side-link-qr';",
      "export * from '../camera/side-link-qr';",
      "import './side-link-qr';",
    ];
    for (const probe of probes) {
      expect(staticImport.test(probe), probe).toBe(true);
    }
    for (const allowed of [
      "import type { pairingCodeModules } from './side-link-qr';",
      "export type { PairingCodeDrawer } from './side-link-qr';",
      "const loaded = await import('./side-link-qr');",
    ]) {
      expect(staticImport.test(allowed), allowed).toBe(false);
    }
    const reachers = productionSources(SOURCE_ROOT)
      .filter((file) => staticImport.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SOURCE_ROOT, file));
    expect(reachers).toEqual([]);
    // …and the dynamic imports this rests on are there, so the scan above is
    // not passing over a tree that stopped naming the module at all.
    const dynamic = productionSources(SOURCE_ROOT)
      .filter((file) => readFileSync(file, 'utf8').includes("import('./side-link-qr')"))
      .map((file) => relative(SOURCE_ROOT, file))
      .sort();
    expect(dynamic).toEqual(['camera/PairingCode.tsx', 'camera/session.ts']);
  });
});
