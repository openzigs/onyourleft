// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { shippedFiles } from '../../tools/realistic/sources';
import {
  isRealisticVegetation,
  REALISTIC_DIRECTORY,
  REALISTIC_VEGETATION,
  REALISTIC_VEGETATION_KINDS,
  realisticFiles,
  realisticUrl,
  realisticWorldChosenText,
  realisticWorldNotice,
} from './realistic-assets';
import { SCATTER_KINDS } from './scatter';

const COMMITTED = readdirSync(fileURLToPath(new URL('../../public/realistic/', import.meta.url)));

describe('what the renderer loads is what the pipeline ships — #430', () => {
  it('names exactly the committed files, in both directions', () => {
    // A file the pipeline ships and the renderer never loads is APK weight for
    // nothing; a file the renderer loads and nothing ships is a 404 on the
    // tablet and a world that silently stays stylised.
    expect([...realisticFiles()].sort()).toEqual([...COMMITTED].sort());
    expect([...realisticFiles()].sort()).toEqual([...shippedFiles()].sort());
  });

  it('names each file once', () => {
    expect(new Set(realisticFiles()).size).toBe(realisticFiles().length);
  });

  it('serves them under one directory, which is what the precache excludes', () => {
    for (const file of realisticFiles()) {
      expect(realisticUrl(file)).toBe(`/${REALISTIC_DIRECTORY}${file}`);
    }
  });
});

describe('the kinds layer 2 replaces — ADR 0026 D-12, #474', () => {
  it('are the trees, the shrub and the rock, and not the post', () => {
    // ADR 0022 D-3's `post` stays procedural in both worlds (ADR 0026 D-3).
    expect([...REALISTIC_VEGETATION_KINDS].sort()).toEqual([
      'rock',
      'shrub',
      'tree-broadleaf',
      'tree-conifer',
    ]);
    expect(isRealisticVegetation('post')).toBe(false);
    expect(isRealisticVegetation('building')).toBe(false);
    for (const kind of REALISTIC_VEGETATION_KINDS) {
      expect(SCATTER_KINDS, kind).toContain(kind);
      expect(isRealisticVegetation(kind)).toBe(true);
      expect(REALISTIC_VEGETATION[kind].length, kind).toBeGreaterThan(0);
    }
  });

  it('gives every tree an impostor and nothing else one', () => {
    for (const kind of REALISTIC_VEGETATION_KINDS) {
      for (const model of REALISTIC_VEGETATION[kind]) {
        expect(model.impostor !== undefined, model.name).toBe(kind.startsWith('tree-'));
      }
    }
  });
});

describe('what a rider is told when the realistic world is not what they ride in — ADR 0026 D-7', () => {
  it('says nothing when it loaded', () => {
    expect(realisticWorldNotice({ loaded: true })).toBeUndefined();
  });

  it('says it is not kept offline, when the browser was offline — the expected case', () => {
    const notice = realisticWorldNotice({
      loaded: false,
      offline: true,
      detail: 'Failed to fetch',
    });
    expect(notice).toMatch(/offline/);
    expect(notice).toMatch(/standard world/);
  });

  it('says only that it could not load otherwise, and never the failure’s own words', () => {
    const notice = realisticWorldNotice({
      loaded: false,
      offline: false,
      detail: 'shrub_02_c.glb: 404 Not Found',
    });
    expect(notice).toMatch(/could not be loaded/);
    expect(notice).toMatch(/standard world/);
    expect(notice).not.toMatch(/404|shrub/);
  });
});

describe('what a rider is told inside the Android shell, where the set ships in the APK — #478', () => {
  const offline = { loaded: false, offline: true, detail: 'Failed to fetch' } as const;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never says it is not kept on the device, because in the shell it is', () => {
    const notice = realisticWorldNotice(offline, true);
    expect(notice).not.toMatch(/offline|not kept/);
    expect(notice).toMatch(/could not be loaded/);
    expect(notice).toMatch(/standard world/);
  });

  it('still says so in a browser, which is the case the sentence is for', () => {
    expect(realisticWorldNotice(offline, false)).toMatch(/not kept on this device/);
  });

  it('asks the shell question the way this client does — the Capacitor global', () => {
    // Inside the shell, with no second argument: the global decides.
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true, getPlatform: () => 'android' });
    expect(realisticWorldNotice(offline)).toMatch(/could not be loaded/);
    // Capacitor's WEB build defines the global too, and says it is not native.
    vi.stubGlobal('Capacitor', { isNativePlatform: () => false, getPlatform: () => 'web' });
    expect(realisticWorldNotice(offline)).toMatch(/not kept on this device/);
    vi.unstubAllGlobals();
    expect(realisticWorldNotice(offline)).toMatch(/not kept on this device/);
  });
});

describe('what a rider who chose the realistic world is told before a ride — #475', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says in a browser that it is not kept for offline use, and what happens then', () => {
    const said = realisticWorldChosenText(false);
    expect(said).toMatch(/not kept on this device for use offline/);
    expect(said).toMatch(/standard world instead and the ride screen says so/);
  });

  it('says nothing about the network in the shell, where the set ships in the APK', () => {
    const said = realisticWorldChosenText(true);
    expect(said).not.toMatch(/offline|network|not kept/);
    expect(said).toMatch(/standard world instead and the ride screen says so/);
  });

  it('asks the shell question the way this client does — the Capacitor global', () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true, getPlatform: () => 'android' });
    expect(realisticWorldChosenText()).toBe(realisticWorldChosenText(true));
    vi.unstubAllGlobals();
    expect(realisticWorldChosenText()).toBe(realisticWorldChosenText(false));
  });
});
