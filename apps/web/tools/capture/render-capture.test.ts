// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3152: what the capture's file server answers, read without a browser —
 * the review of PR #3160.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  archiveRange,
  captureArchiveUrl,
  captureEventsFile,
  captureEventsName,
  captureRequestsName,
  servedFile,
} from './render-capture';

const DIST = mkdtempSync(join(tmpdir(), 'oyl-capture-dist-'));
mkdirSync(join(DIST, 'assets'));
writeFileSync(join(DIST, 'index.html'), '<!doctype html>');
writeFileSync(join(DIST, 'assets', 'a b.js'), '');
const ARCHIVE = join(DIST, 'basemap.pmtiles');
writeFileSync(ARCHIVE, Buffer.from('0123456789abcdef'));

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

describe('a free ride’s blocks, from the local archive — #3154', () => {
  it('answers a range with its bytes from disk, as the archive’s host does', () => {
    const answer = archiveRange(ARCHIVE, 'bytes=2-5');
    expect(answer.status).toBe(206);
    expect(answer.body.toString()).toBe('2345');
    expect(answer.headers['content-range']).toBe('bytes 2-5/16');
    expect(answer.headers['content-length']).toBe('4');
    expect(answer.headers['access-control-allow-origin']).toBe('*');
    expect(archiveRange(ARCHIVE, 'bytes=0-15').body.toString()).toBe('0123456789abcdef');
    // Past the end: cut at it, as a host does — the reader asks for 16 KiB of header.
    const cut = archiveRange(ARCHIVE, 'bytes=10-16383');
    expect([cut.status, cut.body.toString(), cut.headers['content-range']]).toEqual([
      206,
      'abcdef',
      'bytes 10-15/16',
    ]);
  });

  it('refuses a range that is not one, or starts past the end, with a 416 and no bytes', () => {
    for (const range of [undefined, 'bytes=5-2', 'bytes=16-20', 'bytes=-4', 'items=0-1']) {
      const answer = archiveRange(ARCHIVE, range);
      expect(answer.status, String(range)).toBe(416);
      expect(answer.body.length).toBe(0);
      expect(answer.headers['content-range']).toBe('bytes */16');
    }
  });

  it('logs its requests beside the video', () => {
    expect(
      captureRequestsName({
        scene: 'free-ride',
        seconds: 2,
        fps: 60,
        width: 1920,
        height: 1080,
        out: undefined,
      }),
    ).toBe('free-ride-1920x1080-60fps.requests.json');
  });
});

describe('the archive URL a capture answers — PR #3169', () => {
  it('reads it from the .env files the capture build reads, not the environment alone', () => {
    // The environment wins over a file, as in the build: clear it for this case.
    vi.stubEnv('VITE_BASEMAP_PMTILES_URL', undefined);
    const root = mkdtempSync(join(tmpdir(), 'oyl-capture-env-'));
    try {
      writeFileSync(
        join(root, '.env'),
        'VITE_BASEMAP_PMTILES_URL=https://tiles.example/a.pmtiles\n',
      );
      expect(captureArchiveUrl(root)).toBe('https://tiles.example/a.pmtiles');
      writeFileSync(
        join(root, '.env.capture'),
        'VITE_BASEMAP_PMTILES_URL=https://tiles.example/b.pmtiles\n',
      );
      expect(captureArchiveUrl(root)).toBe('https://tiles.example/b.pmtiles');
    } finally {
      rmSync(root, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });
});
