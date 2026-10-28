// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1674: `GroundBlobBelt.update` — the whole per-frame path, from the sun's
 * throw to the four buffers it hands the GPU — allocates nothing, and draws
 * exactly what it drew before that was made true.
 *
 * - **Nothing allocated.** A collection during the measured window is the
 *   failure: the window is retried a few times for one the rest of the
 *   process started, and fails if every attempt is collected under —
 *   `mapped-blobs.test.ts` §"allocates nothing filling the casters"'s rule,
 *   over the whole `update` rather than the caster fill.
 * - **Byte for byte.** The buffers over a sweep of roads, casters and suns are
 *   hashed and held to the digest `main` produced before #1674 changed
 *   anything. ⚠️ A change that MEANS to move a blob changes this digest too:
 *   re-take it, and say in the pull request why the drawing moved.
 */

import { createHash, type Hash } from 'node:crypto';
import { getHeapStatistics, GCProfiler } from 'node:v8';

import { describe, expect, it } from 'vitest';

import { metres, type RouteProfile } from '@onyourleft/domain';

import { blobCasters, ROAD_EDGE_METRES, type BlobCasters } from './ground-blob';
import { REALISTIC_GROUND_BLOBS } from './realistic-budget';
import { hairpinRoute, hillRoute, sBendRoute } from './route-fixtures-testing';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { corridorOrigin, type CorridorPoint } from './terrain';
import { GroundBlobBelt } from './three-renderer';
import type { SunStyle } from './world';

type Frame = ReturnType<typeof sceneFrame>;

function frameOn(profile: RouteProfile, along: number): Frame {
  const start = atStartLine(profile);
  return sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: { ...start, ride: { ...start.ride, distance: metres(along) } },
  });
}

/**
 * Casters beside the road on both sides, from just past its edge to 30 m out,
 * round and square, short and tall, some faded, dealt across two lists so the
 * belt's walk over lists is exercised too.
 */
function castersBeside(centre: readonly CorridorPoint[]): BlobCasters[] {
  const lists = [blobCasters(REALISTIC_GROUND_BLOBS), blobCasters(REALISTIC_GROUND_BLOBS)];
  const offsets = [ROAD_EDGE_METRES + 0.5, 4, 9, 18, 30];
  let n = 0;
  for (let row = 1; row + 1 < centre.length; row += 3) {
    const before = centre[row - 1] as CorridorPoint;
    const point = centre[row] as CorridorPoint;
    const after = centre[row + 1] as CorridorPoint;
    const dx = after.x - before.x;
    const dz = after.z - before.z;
    const length = Math.hypot(dx, dz);
    for (const side of [-1, 1]) {
      for (const offset of offsets) {
        const list = lists[n % 2] as BlobCasters;
        const caster = list.casters[list.count];
        if (caster === undefined) continue;
        caster.x = point.x + (side * offset * dz) / length;
        caster.z = point.z - (side * offset * dx) / length;
        caster.y = point.y;
        caster.round = n % 3 !== 0;
        caster.yaw = n * 0.7;
        caster.halfAlong = 1 + (n % 5);
        caster.halfAcross = 0.5 + (n % 4);
        caster.centreAlong = n % 3 === 0 ? 0.5 : 0;
        caster.height = 2 + (n % 7) * 2;
        caster.strength = n % 11 === 0 ? 0.4 : 1;
        list.count += 1;
        n += 1;
      }
    }
  }
  return lists;
}

/** Overhead (no throw), high from one side, and low from the other. */
const SUNS: readonly SunStyle[] = [
  { x: 0, y: 1, z: 0, ambient: 0.4, direct: 0.6 },
  { x: 0.6, y: 0.5, z: 0.62, ambient: 0.4, direct: 0.6 },
  { x: -0.85, y: 0.25, z: -0.46, ambient: 0.4, direct: 0.6 },
];

/** Every buffer the belt hands the GPU, up to what it draws, into `hash`. */
function hashDrawn(belt: GroundBlobBelt, hash: Hash): void {
  const count = belt.mesh.count;
  const geometry = belt.mesh.geometry;
  const bytes = (array: ArrayLike<number>, size: number): void => {
    const floats = array as Float32Array;
    hash.update(new Uint8Array(floats.buffer, floats.byteOffset, count * size * 4));
  };
  hash.update(String(count));
  bytes(belt.mesh.instanceMatrix.array, 16);
  bytes(geometry.getAttribute('blobClipFirst').array, 3);
  bytes(geometry.getAttribute('blobClipSecond').array, 3);
  bytes(geometry.getAttribute('blobStrength').array, 1);
}

describe('GroundBlobBelt.update — #1674', () => {
  it('allocates nothing on a frame', () => {
    const frame = frameOn(hairpinRoute(30), 650);
    const lists = castersBeside(frame.corridor.centre);
    const belt = new GroundBlobBelt();
    const sun = SUNS[1] as SunStyle;
    let sink = 0;
    const frames = (count: number): void => {
      for (let at = 0; at < count; at += 1) {
        belt.update(lists, frame.corridor, frame.terrain.mesh, sun);
        sink += belt.mesh.count;
      }
    };
    frames(400);
    const attempts: string[] = [];
    let measured = false;
    for (let attempt = 0; attempt < 6 && !measured; attempt += 1) {
      const profiler = new GCProfiler();
      profiler.start();
      const before = getHeapStatistics().used_heap_size;
      frames(200);
      const after = getHeapStatistics().used_heap_size;
      const { statistics } = profiler.stop();
      if (statistics.length > 0) {
        attempts.push(`collected ${statistics.length}×`);
        continue;
      }
      measured = true;
      expect(after - before).toBeLessThan(64 * 1024);
    }
    belt.dispose();
    expect(measured, attempts.join(', ')).toBe(true);
    // Non-vacuity: every frame drew blobs.
    expect(sink).toBeGreaterThan(0);
  });

  it('draws byte for byte what it drew before #1674', () => {
    const hash = createHash('sha256');
    let drawn = 0;
    for (const profile of [hillRoute(), hairpinRoute(30), sBendRoute(40)]) {
      for (const along of [200, 650, 900]) {
        const frame = frameOn(profile, along);
        const lists = castersBeside(frame.corridor.centre);
        for (const sun of SUNS) {
          const belt = new GroundBlobBelt();
          belt.update(lists, frame.corridor, frame.terrain.mesh, sun);
          drawn += belt.mesh.count;
          hashDrawn(belt, hash);
          belt.dispose();
        }
      }
    }
    expect(`${drawn} ${hash.digest('hex')}`).toBe(
      '2622 ee765c1568ed59830db525349f375b18ac43d5230de43830bbc852a6dca951e1',
    );
  });
});
