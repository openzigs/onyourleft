// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The side camera's picture timings — #1112. What the recorder keeps, what it
 * summarises, and that a snapshot is numbers and enumerations and nothing that
 * could be a picture (ADR 0029 D-8, ADR 0033 D-8).
 */

import { describe, expect, it } from 'vitest';

import {
  percentile,
  SIDE_TICK_OUTCOMES,
  SIDE_TIMINGS_RECORDS,
  SIDE_TIMINGS_WINDOW_MILLISECONDS,
  SidePictureTimings,
  sidePictureTimingsForThisPage,
  type SideTickRecord,
} from './side-picture-timings';

/** A sent picture at `tickAt`, every stage filled. */
function sent(tickAt: number, videoFrames = tickAt): SideTickRecord {
  return {
    tickAt,
    outcome: 'sent',
    captureMilliseconds: 12,
    drawMilliseconds: 2,
    encodeMilliseconds: 9,
    videoFrames,
    encoder: 'worker',
    bytes: 9000,
    bufferedBefore: 0,
    sentAt: tickAt + 12,
  };
}

/** Every leaf of `value`, with its path. */
function leaves(value: unknown, path = '$'): [string, unknown][] {
  if (Array.isArray(value)) {
    return value.flatMap((each, index) => leaves(each, `${path}[${String(index)}]`));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, each]) => leaves(each, `${path}.${key}`));
  }
  return [[path, value]];
}

describe('the recorder', () => {
  it('keeps the newest ticks only, and counts every one', () => {
    const timings = new SidePictureTimings();
    for (let tick = 1; tick <= SIDE_TIMINGS_RECORDS + 50; tick += 1) {
      timings.record(sent(tick * 200));
    }
    const { records, summary } = timings.snapshot();
    expect(records).toHaveLength(SIDE_TIMINGS_RECORDS);
    expect(records[0]?.tickAt).toBe(51 * 200);
    expect(summary.totals.sent).toBe(SIDE_TIMINGS_RECORDS + 50);
  });

  it('notes the page’s visibility with each tick', () => {
    let visibility = 'visible';
    const timings = new SidePictureTimings({ visibility: () => visibility });
    timings.record(sent(200));
    visibility = 'hidden';
    timings.record(sent(400));
    expect(timings.snapshot().records.map((each) => each.visibility)).toEqual([
      'visible',
      'hidden',
    ]);
    expect(timings.summary().visibility).toBe('hidden');
  });

  it('starts again from nothing', () => {
    const timings = new SidePictureTimings();
    timings.record(sent(200));
    timings.started();
    expect(timings.snapshot().records).toEqual([]);
    expect(timings.summary().totals.sent).toBe(0);
    expect(timings.summary().lastTickAt).toBeUndefined();
  });
});

describe('the summary', () => {
  it('reads five a second off five a second', () => {
    const timings = new SidePictureTimings();
    for (let tick = 1; tick <= 100; tick += 1) {
      timings.record(sent(tick * 200));
    }
    const summary = timings.summary();
    expect(summary.sentPerSecond).toBe(5);
    expect(summary.ticksPerSecond).toBe(5);
    expect(summary.outcomes.sent).toBe(SIDE_TIMINGS_WINDOW_MILLISECONDS / 200);
    expect(summary.sendInterval.p50).toBe(200);
    expect(summary.encode).toEqual({ count: 50, p50: 9, p95: 9 });
    expect(summary.encoder).toBe('worker');
  });

  it('reads the owner’s phone: one picture sent in every fifteen ticks, the rest still taking', () => {
    const timings = new SidePictureTimings();
    for (let tick = 1; tick <= 150; tick += 1) {
      timings.record(
        tick % 15 === 0
          ? { ...sent(tick * 200), captureMilliseconds: 3000, encodeMilliseconds: 2990 }
          : { tickAt: tick * 200, outcome: 'still-taking' },
      );
    }
    const summary = timings.summary();
    // Ticks 101 to 150 are in the window, and four of them are multiples of 15.
    expect(summary.sentPerSecond).toBe(0.4);
    expect(summary.ticksPerSecond).toBe(5);
    expect(summary.outcomes['still-taking']).toBe(46);
    expect(summary.capture.p50).toBe(3000);
    expect(summary.encode.p95).toBe(2990);
  });

  it('divides a young session by how long it has been filming, not by the whole window', () => {
    const timings = new SidePictureTimings();
    for (let tick = 1; tick <= 10; tick += 1) {
      timings.record(sent(tick * 200));
    }
    expect(timings.summary().sentPerSecond).toBe(5);
  });

  it('counts a picture drawn from a video frame the last one was drawn from', () => {
    const timings = new SidePictureTimings();
    timings.record(sent(200, 7));
    timings.record(sent(400, 7));
    timings.record(sent(600, 8));
    expect(timings.summary().repeatedVideoFrames).toBe(1);
  });

  it('reports the fullest the pictures channel was before an offer', () => {
    const timings = new SidePictureTimings();
    timings.record({ ...sent(200), bufferedBefore: 300 });
    timings.record({ tickAt: 400, outcome: 'busy', bufferedBefore: 9000 });
    expect(timings.summary().maxBufferedBefore).toBe(9000);
  });

  it('says nothing was measured rather than nought, before a tick', () => {
    const summary = new SidePictureTimings().summary();
    expect(summary.sentPerSecond).toBe(0);
    expect(summary.capture).toEqual({ count: 0, p50: undefined, p95: undefined });
    expect(summary.maxBufferedBefore).toBeUndefined();
  });

  it('takes percentiles by nearest rank', () => {
    expect(percentile([], 0.5)).toBeUndefined();
    expect(percentile([5, 1, 3], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5);
  });
});

describe('what a snapshot may hold — ADR 0029 D-8, ADR 0033 D-8', () => {
  it('is numbers, the outcome words, the encoder words and the visibility word, and nothing else', () => {
    const timings = new SidePictureTimings({ visibility: () => 'visible' });
    for (const [index, outcome] of SIDE_TICK_OUTCOMES.entries()) {
      timings.record({ ...sent((index + 1) * 200), outcome });
    }
    const snapshot = timings.snapshot();
    // It survives JSON, which is how `webview-probe.mjs` returns it.
    const parsed = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
    expect(parsed.records).toHaveLength(SIDE_TICK_OUTCOMES.length);
    expect(parsed.summary.totals).toEqual(snapshot.summary.totals);
    const words = new Set<unknown>([...SIDE_TICK_OUTCOMES, 'worker', 'main-thread', 'visible']);
    for (const [path, value] of leaves(snapshot)) {
      if (value === undefined || typeof value === 'number') {
        continue;
      }
      expect(words.has(value), `${path} is ${JSON.stringify(value)}`).toBe(true);
    }
  });
});

describe('the page’s one recorder', () => {
  it('is made once and published where the probe reads it', () => {
    const target: { __oylSideCameraTimings?: SidePictureTimings } = {};
    const first = sidePictureTimingsForThisPage(target);
    expect(target.__oylSideCameraTimings).toBe(first);
    expect(sidePictureTimingsForThisPage(target)).toBe(first);
  });
});
