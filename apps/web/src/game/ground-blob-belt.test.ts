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
import { getHeapStatistics, GCProfiler, setFlagsFromString } from 'node:v8';

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

/**
 * What a frame may leave on the heap, and the most one may take back. #1674 set
 * 64 KiB over 200 frames, 328 bytes a frame, with the harness's own first-use
 * cost (about 18 KiB) inside it; with that taken off (see the test) the bound is
 * tightened to 256, #1839. On Node 24, the pinned one, an optimised `update`
 * leaves nothing and a window is almost always exactly 0 bytes; the most one
 * showed in 120 was 9.1 KB, a compiler's one-off that the next window does not
 * repeat, which is why a window that fails is followed by another. It catches
 * an array of 28 numbers made once a frame, and the `subarray` a blob #1674
 * removed many times over; it does not see one of 24, which the test it
 * replaces did not either (it saw 32).
 */
const BYTES_PER_FRAME = 256;
/**
 * Calls of a function before V8 compiles it with its last, allocation-free tier
 * (`--invocation-count-for-turbofan`): the test sets it to {@link TURBOFAN_AFTER_CALLS}
 * and puts it back to V8's default of 3000. Until a function is compiled
 * `update` boxes its numbers, 8 to 23 KiB a frame, none of it ours, and at the
 * default that takes about 250 frames of this belt (a measured 1.3 s of the
 * test under coverage, 3.0 s on the nightly: #1839), which was most of the
 * time. At 300 it takes about 20. The measurement is of the same optimised
 * code, reached sooner; a Node whose V8 lacks the flag only prints that it does
 * not know it, and takes the longer way, through the extra windows.
 */
const TURBOFAN_AFTER_CALLS = 300;
const TURBOFAN_DEFAULT_CALLS = 3000;
/** Frames run before the first window, past what the compiler needs at {@link TURBOFAN_AFTER_CALLS}. */
const WARM_FRAMES = 60;
/** Frames in a window. */
const WINDOW_FRAMES = 40;
/**
 * Windows tried before giving up. One the bound or a collection spoiled, or
 * one in which the heap shrank by more than the bound (a compiler dropping the
 * code it replaced: -360 KB seen), is followed by another. The shrinking one
 * says nothing, because it could have hidden a leak up to its own size. An
 * allocation on every frame is over the bound in every window after the
 * compiler is done, and that is what fails the test.
 */
const MAX_WINDOWS = 12;

/** Windows of frames on one belt until one is quiet enough, or the attempts run out. */
function windowsOnABelt(): { measured: boolean; attempts: string[]; drawn: number } {
  const frame = frameOn(hairpinRoute(30), 650);
  const lists = castersBeside(frame.corridor.centre);
  const belt = new GroundBlobBelt();
  const sun = SUNS[1] as SunStyle;
  let drawn = 0;
  const frames = (count: number): void => {
    for (let at = 0; at < count; at += 1) {
      belt.update(lists, frame.corridor, frame.terrain.mesh, sun);
      drawn += belt.mesh.count;
    }
  };
  /** Heap growth across `count` frames, and the collections that ran meanwhile. */
  const measure = (count: number): { grew: number; collected: number } => {
    const profiler = new GCProfiler();
    profiler.start();
    const before = getHeapStatistics().used_heap_size;
    frames(count);
    const after = getHeapStatistics().used_heap_size;
    return { grew: after - before, collected: profiler.stop().statistics.length };
  };
  frames(WARM_FRAMES);
  // The first measurement of anything costs the harness about 18 KiB, so a
  // window of no frames is taken first, and again before each window: what
  // the measuring itself leaves is taken off, and only the frames are held
  // to the bound.
  measure(0);
  const attempts: string[] = [];
  let measured = false;
  for (let attempt = 0; attempt < MAX_WINDOWS && !measured; attempt += 1) {
    const empty = measure(0);
    const run = measure(WINDOW_FRAMES);
    if (run.collected > 0 || empty.collected > 0) {
      attempts.push(`collected ${run.collected + empty.collected}×`);
      continue;
    }
    const leftBehind = run.grew - empty.grew;
    attempts.push(`${leftBehind} B`);
    measured = Math.abs(leftBehind) < BYTES_PER_FRAME * WINDOW_FRAMES;
  }
  belt.dispose();
  return { measured, attempts, drawn };
}

describe('GroundBlobBelt.update — #1674', () => {
  it('allocates nothing on a frame', () => {
    setFlagsFromString(`--invocation-count-for-turbofan=${TURBOFAN_AFTER_CALLS}`);
    let result: ReturnType<typeof windowsOnABelt>;
    try {
      result = windowsOnABelt();
    } finally {
      setFlagsFromString(`--invocation-count-for-turbofan=${TURBOFAN_DEFAULT_CALLS}`);
    }
    expect(result.measured, result.attempts.join(', ')).toBe(true);
    // Non-vacuity: every frame drew blobs.
    expect(result.drawn).toBeGreaterThan(0);
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
