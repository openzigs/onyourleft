// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3152: what the capture's file server answers, read without a browser —
 * the review of PR #3160.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { captureEventsFile, captureEventsName, servedFile } from './render-capture';

const DIST = mkdtempSync(join(tmpdir(), 'oyl-capture-dist-'));
mkdirSync(join(DIST, 'assets'));
writeFileSync(join(DIST, 'index.html'), '<!doctype html>');
writeFileSync(join(DIST, 'assets', 'a b.js'), '');

afterAll(() => {
  rmSync(DIST, { recursive: true, force: true });
});

describe('the capture’s file server — #3152', () => {
  it('answers the root with index.html and a file by its escaped name', () => {
    expect(servedFile(DIST, '/')).toBe(join(DIST, 'index.html'));
    expect(servedFile(DIST, '/assets/a%20b.js')).toBe(join(DIST, 'assets', 'a b.js'));
  });

  it('answers a malformed escape with a 404 rather than throwing (PR #3160)', () => {
    expect(servedFile(DIST, '/assets/%E0%A4%A.js')).toBeUndefined();
    expect(servedFile(DIST, '/%')).toBeUndefined();
  });

  it('answers a path out of dist, a directory and a missing file with a 404', () => {
    expect(servedFile(DIST, '/..%2F..%2Fetc%2Fpasswd')).toBeUndefined();
    expect(servedFile(DIST, '/assets')).toBeUndefined();
    expect(servedFile(DIST, '/missing.js')).toBeUndefined();
  });
});

describe('the capture’s event log — #3153', () => {
  const request = {
    scene: 'delivery',
    seconds: 2,
    fps: 60,
    width: 1920,
    height: 1080,
    out: undefined,
  };

  it('is written beside the video, under its name', () => {
    expect(captureEventsName(request)).toBe('delivery-1920x1080-60fps.events.json');
  });

  it('holds the scene, its frames and every event of the last frame', () => {
    const events = [{ frame: 0, kind: 'round', seed: 3, houses: [120, 300] }] as const;
    expect(
      captureEventsFile(request, { drawn: 121, distance: 18, elapsed: 2, events: [...events] }),
    ).toEqual({ scene: 'delivery', fps: 60, frames: 120, events: [...events] });
    expect(captureEventsFile(request, { drawn: 1, distance: 0, elapsed: 0 }).events).toEqual([]);
  });
});
