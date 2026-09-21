// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The announcer's core — #396. Pure, so every case drives a fake clock.
 *
 * ⚠️ `*.test.ts`, not `*.a11y.test.ts`, deliberately: this module renders
 * nothing, and a pure-logic test in the accessibility gate dilutes what a red
 * `test:a11y` means. The region's own tests are #397's.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { stripComments } from '../../units/no-inline-units';

import {
  ANNOUNCE_WINDOW_SECONDS,
  ANNOUNCEABLE_READINGS,
  INITIAL_ANNOUNCER,
  OFF_TARGET_SECONDS,
  PRIORITY,
  announce,
  spokenPower,
  type AnnounceInput,
  type AnnouncerState,
} from './announce';
import { DEFAULT_ANNOUNCEMENTS, type AnnouncementPreference } from './announce-preference';
import { NO_READING, type HudReading } from './fields';

const ON: AnnouncementPreference = { ...DEFAULT_ANNOUNCEMENTS, enabled: true };

const power = (value: string, stale = false): HudReading => ({
  key: 'power',
  label: 'Power',
  value,
  unit: 'W',
  stale,
});

/** Drive the core over a run of calls, collecting every sentence it said. */
function run(
  calls: readonly Partial<AnnounceInput>[],
  preference: AnnouncementPreference = ON,
): { readonly said: (string | undefined)[]; readonly state: AnnouncerState } {
  let state = INITIAL_ANNOUNCER;
  const said: (string | undefined)[] = [];
  for (const call of calls) {
    const out = announce(state, {
      now: 0,
      readings: [power('200')],
      preference,
      ...call,
    });
    said.push(out.sentence);
    state = out.state;
  }
  return { said, state };
}

describe('the throttle — the criterion the module exists for', () => {
  it('lets at most ONE sentence out of sixty updates inside one second', () => {
    // Every call is worth a sentence on its own: power every 15 s from a
    // baseline 15 s back, and a distance mark crossed on each step.
    const calls: Partial<AnnounceInput>[] = [
      { now: 0, remaining: { value: 100, unit: 'kilometres' } },
    ];
    for (let frame = 0; frame < 60; frame += 1) {
      calls.push({
        now: 15 + frame / 60,
        remaining: { value: 99 - frame, unit: 'kilometres' },
      });
    }
    const { said } = run(calls, { ...ON, powerEverySeconds: 15 });
    expect(said.filter((sentence) => sentence !== undefined)).toHaveLength(1);
  });

  it('opens again after the window', () => {
    const { said } = run(
      [
        { now: 0, remaining: { value: 10.2, unit: 'kilometres' } },
        { now: 1, remaining: { value: 9.9, unit: 'kilometres' } },
        { now: 2, remaining: { value: 8.9, unit: 'kilometres' } },
        { now: 1 + ANNOUNCE_WINDOW_SECONDS, remaining: { value: 7.9, unit: 'kilometres' } },
      ],
      { ...ON, powerEverySeconds: 'never' },
    );
    expect(said).toEqual([undefined, '10 kilometres to go', undefined, '8 kilometres to go']);
  });
});

describe('a reading speaks when it crosses its threshold, not before', () => {
  it('says nothing above the mark, and the mark once it is crossed', () => {
    const { said } = run(
      [
        { now: 0, remaining: { value: 5.4, unit: 'miles' } },
        { now: 10, remaining: { value: 5.1, unit: 'miles' } },
        { now: 20, remaining: { value: 4.9, unit: 'miles' } },
      ],
      { ...ON, powerEverySeconds: 'never' },
    );
    expect(said).toEqual([undefined, undefined, '5 miles to go']);
  });

  it('treats the distance going UP as a new lap, not a mark', () => {
    const { said } = run(
      [
        { now: 0, remaining: { value: 0.2, unit: 'kilometres' } },
        { now: 10, remaining: { value: 9.8, unit: 'kilometres' } },
      ],
      { ...ON, powerEverySeconds: 'never' },
    );
    expect(said).toEqual([undefined, undefined]);
  });

  it('says power on its cadence, counted from the start rather than at once', () => {
    const { said } = run([{ now: 0 }, { now: 30 }, { now: 60 }, { now: 90 }], ON);
    expect(said).toEqual([undefined, undefined, 'Power 200 watts', undefined]);
  });

  it('holds off a target for a while before saying so, and says it once', () => {
    const calls = [0, 2, OFF_TARGET_SECONDS, OFF_TARGET_SECONDS + 10].map((now) => ({
      now,
      readings: [power('150')],
      acknowledgedTarget: 200,
    }));
    // The longest cadence, so the only sentence in these fifteen seconds is
    // the off-target one. ⚠️ This used to pass `powerEverySeconds: 'never'`
    // and expect the sentence anyway — pinning the very behaviour PR #444's
    // review found: "never" on the power row did not silence power.
    const { said } = run(calls, { ...ON, powerEverySeconds: 300 });
    expect(said).toEqual([
      undefined,
      undefined,
      'Power 150 watts, under the 200 watt target',
      undefined,
    ]);
  });
});

describe('never means never — for every announceable reading', () => {
  // Derived from the reading list, so a reading added to ANNOUNCEABLE_READINGS
  // without a "never" branch is a red test rather than one nobody wrote.
  const NEVER_FOR: Record<string, Partial<AnnouncementPreference>> = {
    power: { powerEverySeconds: 'never' },
    remaining: { distanceEvery: 'never' },
  };

  for (const key of ANNOUNCEABLE_READINGS) {
    it(`says nothing about ${key} when the rider chose never`, () => {
      const never = NEVER_FOR[key];
      expect(never, `${key} has no "never" setting`).toBeDefined();
      const calls: Partial<AnnounceInput>[] = [];
      for (let second = 0; second < 600; second += 1) {
        calls.push({
          now: second,
          remaining: { value: 100 - second / 10, unit: 'kilometres' },
          // 200 W against an acknowledged 300 W, the whole time: power's
          // SECOND trigger, which "never" has to silence as well as the
          // cadence (PR #444's review).
          acknowledgedTarget: 300,
        });
      }
      const other = { powerEverySeconds: 'never', distanceEvery: 'never' } as const;
      const { said } = run(calls, { ...ON, ...other, ...never });
      expect(said.filter((sentence) => sentence !== undefined)).toEqual([]);
    });
  }

  it('says nothing at all with the master switch off — the default', () => {
    const { said } = run(
      [
        { now: 0, events: [{ kind: 'trainer-lost', text: 'The trainer is not answering.' }] },
        { now: 100, remaining: { value: 1, unit: 'kilometres' } },
      ],
      DEFAULT_ANNOUNCEMENTS,
    );
    expect(DEFAULT_ANNOUNCEMENTS.enabled).toBe(false);
    expect(said).toEqual([undefined, undefined]);
  });
});

describe('priority is an ORDER, not a politeness', () => {
  it('lets a safety event win over a routine reading in the same window', () => {
    const { said } = run(
      [
        { now: 0, remaining: { value: 10.1, unit: 'kilometres' } },
        {
          now: 60,
          remaining: { value: 9.9, unit: 'kilometres' },
          events: [{ kind: 'trainer-lost', text: 'The trainer has stopped answering.' }],
        },
      ],
      ON,
    );
    expect(said[1]).toBe('The trainer has stopped answering.');
  });

  it('drops the lower item rather than queueing it behind the higher', () => {
    const { said } = run(
      [
        { now: 0, remaining: { value: 10.1, unit: 'kilometres' } },
        {
          now: 60,
          remaining: { value: 9.9, unit: 'kilometres' },
          events: [{ kind: 'workout-fault', text: 'The trainer refused that target.' }],
        },
        { now: 60 + ANNOUNCE_WINDOW_SECONDS, remaining: { value: 9.8, unit: 'kilometres' } },
      ],
      { ...ON, powerEverySeconds: 'never' },
    );
    expect(said).toEqual([undefined, 'The trainer refused that target.', undefined]);
  });

  it('keeps a safety event waiting through a closed window, and says it when it opens', () => {
    const { said } = run(
      [
        { now: 0, remaining: { value: 10.1, unit: 'kilometres' } },
        { now: 1, remaining: { value: 9.9, unit: 'kilometres' } },
        {
          now: 2,
          events: [{ kind: 'trainer-lost', text: 'Lost.' }],
          remaining: { value: 9.9, unit: 'kilometres' },
        },
        { now: 1 + ANNOUNCE_WINDOW_SECONDS, remaining: { value: 9.9, unit: 'kilometres' } },
      ],
      { ...ON, powerEverySeconds: 'never' },
    );
    expect(said).toEqual([undefined, '10 kilometres to go', undefined, 'Lost.']);
  });

  it('is not displaced from the waiting slot by a lower event arriving after it', () => {
    const { said } = run(
      [
        { now: 0, remaining: { value: 10.1, unit: 'kilometres' } },
        { now: 1, remaining: { value: 9.9, unit: 'kilometres' } },
        { now: 2, events: [{ kind: 'trainer-lost', text: 'Lost.' }] },
        { now: 3, events: [{ kind: 'interval-ahead', text: 'In ten seconds: easier.' }] },
        { now: 1 + ANNOUNCE_WINDOW_SECONDS },
      ],
      { ...ON, powerEverySeconds: 'never' },
    );
    expect(said.at(-1)).toBe('Lost.');
  });

  it('puts the safety events first, in the order #395 decided', () => {
    expect(PRIORITY.slice(0, 3)).toEqual(['trainer-lost', 'workout-fault', 'interval-ahead']);
    expect(PRIORITY.indexOf('distance-tick')).toBeLessThan(PRIORITY.indexOf('power'));
  });
});

describe('what a sentence may say', () => {
  it('never speaks a dropped sensor as a zero', () => {
    for (const reading of [power(NO_READING), power('0', true), undefined]) {
      const sentence = spokenPower(reading);
      expect(sentence).toBe('No power reading');
      expect(sentence.toLowerCase()).not.toMatch(/\b(zero|nought|0)\b/);
    }
    // And through the core, not only the helper.
    const { said } = run([{ now: 0 }, { now: 60, readings: [power(NO_READING)] }], ON);
    expect(said[1]).toBe('No power reading');
  });

  it('announces no gap — so it cannot re-invert #255’s direction word', () => {
    // #395: the pacer and ghost gaps are not in the first cut. When they are,
    // the spoken word must be `gapReading`'s own; today the assertion is that
    // no gap reading can be spoken at all.
    expect(ANNOUNCEABLE_READINGS).not.toContain('gap');
    const gap: HudReading = {
      key: 'gap',
      label: 'Pacer',
      value: '12',
      unit: 's',
      stale: false,
      detail: 'ahead',
    };
    const { said } = run(
      [
        { now: 0, readings: [gap] },
        { now: 600, readings: [gap] },
      ],
      ON,
    );
    expect(said.join(' ')).not.toContain('ahead');
  });

  it('can carry no coordinate: no announceable reading is a position', () => {
    for (const key of ANNOUNCEABLE_READINGS) {
      expect(key).not.toMatch(/lat|lon|position|coordinate/i);
    }
  });

  it('keeps no state of its own: a new ride starts from nothing', () => {
    const first = run([{ now: 0 }, { now: 60 }], ON);
    expect(first.said[1]).toBe('Power 200 watts');
    const second = run([{ now: 60 }], ON);
    expect(second.said).toEqual([undefined]);
  });
});

describe('no text-to-speech anywhere in the client', () => {
  // A source scan, on `units/no-inline-units.test.ts`'s precedent. The lint
  // rule covers `announce.ts`; this covers every other file a later edit
  // might reach for it in.
  const ROOTS = [
    join(dirname(fileURLToPath(import.meta.url)), '..', '..'),
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'mobile', 'src'),
  ];
  const sources = (directory: string): string[] =>
    readdirSync(directory).flatMap((name) => {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });

  it('names speechSynthesis nowhere', () => {
    const found = ROOTS.flatMap(sources).filter((file) =>
      // Comments stripped: `announce.ts` NAMES it, to say why it is refused.
      /speechSynthesis|SpeechSynthesisUtterance/.test(stripComments(readFileSync(file, 'utf8'))),
    );
    expect(found.map((file) => relative(ROOTS[0] ?? '', file))).toEqual([]);
  });
});
