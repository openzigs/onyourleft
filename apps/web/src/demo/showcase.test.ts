// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The showcase timeline as data — #1653: its shape, the state it gives at a
 * ride time, and its skips. What reaches the renderer is `showcase-stage.test.ts`'s.
 */

import { describe, expect, it } from 'vitest';

import {
  CAPTION_MIN_SECONDS,
  featureOf,
  NO_SEASON_DATE,
  SHOWCASE_TIMELINE,
  showcaseAt,
  showcaseShots,
  type Cue,
  type ShowcaseFeature,
} from './showcase';

const ALL: (feature: ShowcaseFeature) => boolean = () => true;
const captions = SHOWCASE_TIMELINE.cues.filter(
  (cue): cue is Extract<Cue, { kind: 'caption' }> => cue.kind === 'caption',
);

describe('the showcase timeline — #1653', () => {
  it('is in order, inside its length, and every caption is up for at least 3 s and ends before it', () => {
    const ats = SHOWCASE_TIMELINE.cues.map((cue) => cue.at);
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
    for (const cue of SHOWCASE_TIMELINE.cues) {
      expect(cue.at).toBeGreaterThanOrEqual(0);
      expect(cue.at).toBeLessThan(SHOWCASE_TIMELINE.seconds);
    }
    for (const caption of captions) {
      expect(caption.seconds, caption.text).toBeGreaterThanOrEqual(CAPTION_MIN_SECONDS);
      expect(caption.at + caption.seconds, caption.text).toBeLessThanOrEqual(
        SHOWCASE_TIMELINE.seconds,
      );
    }
  });

  it('captions every moment: each switch after the start has a caption naming its feature', () => {
    const moments = SHOWCASE_TIMELINE.cues.filter(
      // A shot is the camera's and a stretch is the road's: neither is a feature.
      (cue) =>
        cue.at > 0 && cue.kind !== 'caption' && cue.kind !== 'shot' && cue.kind !== 'stretch',
    );
    expect(moments.map((cue) => cue.kind).sort()).toEqual([
      'countryside',
      'people',
      'season',
      'season',
      'world',
    ]);
    for (const moment of moments) {
      const caption = captions.find(
        (each) =>
          each.at >= moment.at && each.at - moment.at <= 1 && each.feature === featureOf(moment),
      );
      expect(caption, `${moment.kind} at ${String(moment.at)}`).toBeDefined();
    }
    // The group view: an overhead shot, captioned, on the group preset (`query.ts`).
    const group = captions.find((each) => each.text === 'Ride as a group');
    const overhead = SHOWCASE_TIMELINE.cues.find(
      (cue) => cue.kind === 'shot' && cue.shot === 'overhead' && cue.at <= (group?.at ?? 0),
    );
    expect(group).toBeDefined();
    expect(overhead).toBeDefined();
  });

  it('sets every switch at 0, so every pass starts from the same world', () => {
    const atZero = SHOWCASE_TIMELINE.cues.filter((cue) => cue.at === 0).map((cue) => cue.kind);
    expect(atZero.sort()).toEqual(['countryside', 'people', 'season', 'shot', 'stretch', 'world']);
  });

  it('passes the season fixed dates, never a clock', () => {
    const dates = SHOWCASE_TIMELINE.cues.flatMap((cue) =>
      cue.kind === 'season' ? [cue.date] : [],
    );
    expect(dates).toEqual([NO_SEASON_DATE, '2026-10-31', '2026-12-20']);
  });

  it.each([
    [
      3,
      {
        world: 'stylised',
        date: 'none',
        people: false,
        countryside: false,
        stretch: 'route',
        caption: 'The stylised world',
      },
    ],
    [8, { world: 'realistic', caption: 'And the realistic world' }],
    [12, { world: 'realistic', caption: undefined }],
    [18, { countryside: true, caption: 'Countryside planted by what the map says the land is' }],
    [27, { people: true, stretch: 'route', caption: 'People on the pavements and paths' }],
    [
      36,
      { date: '2026-10-31', stretch: 'village', caption: 'The season from the date: Halloween' },
    ],
    [44, { date: '2026-12-20', stretch: 'village', caption: 'And winter lights in December' }],
    [52, { stretch: 'village', caption: 'Ride as a group' }],
    [
      71.9,
      {
        world: 'realistic',
        date: '2026-12-20',
        people: true,
        countryside: true,
        stretch: 'route',
        caption: undefined,
      },
    ],
  ])('at %d s says what is on', (seconds, expected) => {
    expect(showcaseAt(SHOWCASE_TIMELINE, seconds, ALL)).toMatchObject(expected);
  });

  it('holds a caption exactly its seconds, from its cue', () => {
    const first = captions[0];
    if (first === undefined) throw new Error('no caption');
    expect(showcaseAt(SHOWCASE_TIMELINE, first.at, ALL).caption).toBe(first.text);
    expect(showcaseAt(SHOWCASE_TIMELINE, first.at + first.seconds - 0.01, ALL).caption).toBe(
      first.text,
    );
    expect(showcaseAt(SHOWCASE_TIMELINE, first.at + first.seconds, ALL).caption).toBeUndefined();
  });

  it('skips a missing feature’s cues, lists them, and shows no caption that names it', () => {
    const noSeason = (feature: ShowcaseFeature): boolean => feature !== 'season';
    for (let seconds = 0; seconds < SHOWCASE_TIMELINE.seconds; seconds += 0.25) {
      const state = showcaseAt(SHOWCASE_TIMELINE, seconds, noSeason);
      expect(state.date).toBe(NO_SEASON_DATE);
      expect(state.caption ?? '').not.toMatch(/season|Halloween|winter/i);
    }
    expect(showcaseAt(SHOWCASE_TIMELINE, 50, noSeason).skipped).toEqual([
      'season none at 0',
      'season 2026-10-31 at 34',
      'caption at 34.5',
      'season 2026-12-20 at 42',
      'caption at 42.5',
    ]);
    // Nothing else is touched: the people and the world still switch.
    expect(showcaseAt(SHOWCASE_TIMELINE, 50, noSeason)).toMatchObject({
      world: 'realistic',
      people: true,
    });
    expect(showcaseAt(SHOWCASE_TIMELINE, 50, ALL).skipped).toEqual([]);
  });

  it('counts every cue fired, skipped ones included', () => {
    expect(showcaseAt(SHOWCASE_TIMELINE, 0, ALL).fired).toBe(6);
    expect(showcaseAt(SHOWCASE_TIMELINE, SHOWCASE_TIMELINE.seconds, ALL).fired).toBe(
      SHOWCASE_TIMELINE.cues.length,
    );
  });

  it('makes the shot cues the camera tour, filling the timeline exactly', () => {
    const shots = showcaseShots(SHOWCASE_TIMELINE);
    expect(shots.map((shot) => shot.kind)).toEqual([
      'behind',
      'overhead',
      'behind',
      'overhead',
      'roadside',
    ]);
    expect(shots.reduce((sum, shot) => sum + shot.seconds, 0)).toBe(SHOWCASE_TIMELINE.seconds);
    expect(shots[1]).toEqual({ kind: 'overhead', seconds: 10, into: 'blend' });
  });
});
