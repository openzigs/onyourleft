// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A distinct sound for each cue kind** — #3306, epic #3296, ADR 0101 D-5.
 *
 * Two layers, each read back where its consumer reads it:
 *
 * - **the table and the notes**: every kind `@onyourleft/domain` §`CUE_KINDS`
 *   can select maps to a sound (`audio-cues.ts` §`GROUP_RIDE_CUE_SOUND`), and
 *   each sound is read back as the notes `web-audio.ts` tells a (fake)
 *   platform to play, so no two sounds share a note sequence — a test of the
 *   oscillators, not of a table restated here;
 * - **a scripted rotation** (`@onyourleft/domain` §`rideLine`, the script the
 *   selector's own suite and `hud/group-ride-hud.test.tsx` ride), through the
 *   real selector (`stepCues`), the bookkeeping `GameView` keeps
 *   (`groupRideCueSelected`, `groupRideCueEvent`), the real announcer's core
 *   and the real `RideCues`, onto the port double of `audio-testing.ts`.
 *
 * `group-ride-wiring.test.tsx` drives the same through the real `GameView`.
 *
 * ⚠️ What none of this can say: that the kinds can be told apart by ear on a
 * moving ride. That is the owner's tablet check (#3306), with music on and off.
 */

import { describe, expect, it } from 'vitest';

import {
  CUE_CORRECTION_GAP_MS,
  CUE_CORRECTION_KINDS,
  CUE_EVENT_KINDS,
  CUE_KINDS,
  ROTATION_RIDER_PULL_MS,
  ROTATION_WINDOW_MS,
  startCues,
  stepCues,
  type CueKind,
  type LineMember,
  type MemberView,
  type RotationView,
} from '@onyourleft/domain';
import {
  SCRIPT_GROUP_SPEED_MPS,
  rideLine,
  type LineWindow,
} from '@onyourleft/domain/group-ride-line-testing';

import { GROUP_RIDE_CUE_SOUND, RIDE_CUE_LEVEL, RideCues } from '../audio-cues';
import type { CueName, GroupRideCueName } from '../audio-port';
import {
  EVERY_BUS_ON,
  busOf,
  fakeAudioContext,
  notesOf,
  recordingOutput,
  type RecordedCall,
  type RecordingOutput,
} from '../audio-testing';
import { DEFAULT_CUES, type CuePreference } from '../cue-preference';
import { INITIAL_ANNOUNCER, announce, type AnnouncementEvent } from '../hud/announce';
import { DEFAULT_ANNOUNCEMENTS } from '../hud/announce-preference';
import {
  groupRideCueEvent,
  groupRideCueSelected,
  type GroupRideCueShown,
} from '../hud/group-ride-hud';
import { webAudioOutput } from '../web-audio';

const ON: CuePreference = { ...DEFAULT_CUES, enabled: true };

/** Every short sound the ride and the menus play, the group ride's from its table. */
const GROUP_SOUNDS: readonly GroupRideCueName[] = [...new Set(Object.values(GROUP_RIDE_CUE_SOUND))];
const EVERY_SOUND: readonly CueName[] = [
  'interval',
  'distance',
  'select',
  'confirm',
  'back',
  ...GROUP_SOUNDS,
];

/** A short sound's notes as the platform is told them, rounded to the millisecond and the hundredth of a hertz. */
function noteSequence(cue: CueName): string {
  const fake = fakeAudioContext();
  const output = webAudioOutput(() => fake.context, EVERY_BUS_ON);
  output.resume();
  return notesOf(fake, output, cue)
    .map((note) => `${note.hz.toFixed(2)}Hz@${note.at.toFixed(3)}-${note.until.toFixed(3)}`)
    .join(' ');
}

describe('a sound for every cue kind, and no two kinds alike — #3306', () => {
  it('maps every kind the selector can choose to a sound, and nothing else', () => {
    expect(Object.keys(GROUP_RIDE_CUE_SOUND).sort()).toEqual([...CUE_KINDS].sort());
    for (const kind of CUE_KINDS) {
      expect(
        (GROUP_RIDE_CUE_SOUND as Partial<Record<CueKind, GroupRideCueName>>)[kind],
        `${kind} has no sound`,
      ).toBeTypeOf('string');
    }
  });

  it('gives each event a sound of its own, and every correction the one shared sound', () => {
    const events = CUE_EVENT_KINDS.map((kind) => GROUP_RIDE_CUE_SOUND[kind]);
    expect(new Set(events).size).toBe(CUE_EVENT_KINDS.length);
    const corrections = new Set(CUE_CORRECTION_KINDS.map((kind) => GROUP_RIDE_CUE_SOUND[kind]));
    expect([...corrections]).toEqual(['group-correction']);
    expect(events).not.toContain('group-correction');
    // Eight events and the corrections' one: nine sounds.
    expect(GROUP_SOUNDS).toHaveLength(CUE_EVENT_KINDS.length + 1);
  });

  it('plays no two sounds as the same note sequence, the ride’s and the menus’ included', () => {
    const heard = new Map<string, CueName>();
    for (const cue of EVERY_SOUND) {
      const notes = noteSequence(cue);
      expect(notes.length, `${cue} plays no note`).toBeGreaterThan(0);
      expect(heard.get(notes), `${cue} sounds exactly as ${String(heard.get(notes))}`).toBe(
        undefined,
      );
      heard.set(notes, cue);
    }
    expect(heard.size).toBe(EVERY_SOUND.length);
  });

  it('keeps each sound short: over in under 0.6 s, so none outlasts the next window', () => {
    for (const cue of GROUP_SOUNDS) {
      const fake = fakeAudioContext();
      const output = webAudioOutput(() => fake.context, EVERY_BUS_ON);
      output.resume();
      const notes = notesOf(fake, output, cue);
      expect(Math.max(...notes.map((note) => note.until)), cue).toBeLessThan(0.6);
    }
  });
});

describe('through the existing mix, at the cue level — #3306', () => {
  it('plays every group sound on the cue bus, at the rider’s cue volume, never the effects bus', () => {
    const fake = fakeAudioContext();
    const mix = {
      ...EVERY_BUS_ON(),
      effects: { volume: 0.8, muted: false },
      cues: { volume: 0.3, muted: false },
    };
    const output = webAudioOutput(
      () => fake.context,
      () => mix,
    );
    output.resume();
    const cues = busOf(fake, output, 'interval');
    const effects = busOf(fake, output, 'select');
    expect(cues).not.toBe(effects);
    for (const sound of GROUP_SOUNDS) {
      const bus = busOf(fake, output, sound);
      expect(bus, sound).toBe(cues);
      expect(bus.gain.value, sound).toBe(0.3);
    }
  });

  it('asks the port for each at the ride’s cue level, as the interval sound', () => {
    const output = recordingOutput();
    const cues = new RideCues(output, ON);
    cues.begin();
    for (const sound of GROUP_SOUNDS) cues.cue(sound);
    expect(output.calls.slice(1)).toEqual(
      GROUP_SOUNDS.map((cue) => ({ kind: 'playCue', cue, gain: RIDE_CUE_LEVEL })),
    );
  });
});

// --- a scripted rotation -----------------------------------------------------

function bot(id: string): LineMember {
  return {
    id,
    kind: 'bot',
    capacity: { cpWatts: 250, wPrimeJoules: 18_000, peakWatts: 450, floorWatts: 200 },
  };
}

const RIDER: LineMember = { id: 'you', kind: 'rider' };
const SIX: readonly LineMember[] = [bot('b1'), bot('b2'), RIDER, bot('b3'), bot('b4'), bot('b5')];
const CLIMB_AT_METRES = 1_500;
const WAITING_FROM_MS = 215_000;

/**
 * `hud/group-ride-hud.test.tsx`'s script: the rider third of six, holding the
 * wheel and pressing pull off a window after the cue asks; a climb ahead after
 * their first turn; the line waiting from {@link WAITING_FROM_MS}. Every
 * event kind is selected in it.
 */
function rotation(): readonly LineWindow[] {
  return rideLine({
    line: SIX,
    seed: 7,
    seconds: 240,
    rider: { signalAfterMs: ROTATION_RIDER_PULL_MS + ROTATION_WINDOW_MS },
    climbAheadM: (frontM) => (frontM < CLIMB_AT_METRES ? CLIMB_AT_METRES - frontM : null),
  }).windows.map((window) =>
    window.atMs >= WAITING_FROM_MS
      ? {
          ...window,
          step: { ...window.step, state: { ...window.step.state, phase: 'waiting' as const } },
        }
      : window,
  );
}

/** One window of a scripted ride, as the port and the announcer saw it. */
interface Heard {
  readonly atMs: number;
  /** The kind selected in this window, or `null`. */
  readonly selected: CueKind | null;
  /** A correction returned as a quiet mark in this window, or `null`. */
  readonly mark: string | null;
  /** The port's calls made in this window. */
  readonly calls: readonly RecordedCall[];
  /** What the announcer said in this window, if anything. */
  readonly said: string | undefined;
}

interface Ride {
  readonly windows: readonly LineWindow[];
  readonly preference?: CuePreference;
  /** Press *Ride*: `false` leaves the sounds never begun. */
  readonly begun?: boolean;
  /** The rider's power each window; 200 W unless said, and `null` is no reading. */
  readonly power?: (atMs: number) => number | null;
  readonly view?: (window: LineWindow) => RotationView;
  /** A higher-ranked sentence due in a window, beside the cue. */
  readonly beside?: (atMs: number) => AnnouncementEvent | undefined;
}

/**
 * A scripted ride, window by window, as `GameView`'s frame keeps it: the
 * selector's answer, the cue kept (`groupRideCueSelected`), offered once
 * (`groupRideCueEvent`) to the announcer, and its sound played on the same
 * window from the table.
 */
function ride(script: Ride): {
  readonly heard: readonly Heard[];
  readonly output: RecordingOutput;
} {
  const output = recordingOutput();
  const sounds = new RideCues(output, script.preference ?? ON);
  if (script.begun !== false) sounds.begin();
  let state = startCues(0);
  let shown: GroupRideCueShown | undefined;
  let offered: GroupRideCueShown | undefined;
  let announcer = INITIAL_ANNOUNCER;
  const heard: Heard[] = [];
  for (const window of script.windows) {
    const before = output.calls.length;
    const answer = stepCues(state, {
      rotation: window.step,
      line: script.view?.(window) ?? window.view,
      powerWatts: script.power === undefined ? 200 : script.power(window.atMs),
      thresholdWatts: null,
    });
    state = answer.state;
    shown = groupRideCueSelected(shown, answer.cue, window.atMs / 1_000);
    const offer = groupRideCueEvent(shown, offered);
    offered = offer.offered;
    const events: AnnouncementEvent[] = [];
    const higher = script.beside?.(window.atMs);
    if (higher !== undefined) events.push(higher);
    if (offer.event !== undefined) {
      events.push(offer.event);
      if (offer.offered !== undefined) sounds.cue(GROUP_RIDE_CUE_SOUND[offer.offered.kind]);
    }
    const spoken = announce(announcer, {
      now: window.atMs / 1_000,
      readings: [],
      events,
      preference: { ...DEFAULT_ANNOUNCEMENTS, enabled: true, powerEverySeconds: 'never' },
    });
    announcer = spoken.state;
    heard.push({
      atMs: window.atMs,
      selected: answer.cue?.kind ?? null,
      mark: answer.mark,
      calls: output.calls.slice(before),
      said: spoken.sentence,
    });
  }
  return { heard, output };
}

const played = (heard: readonly Heard[]): string[] =>
  heard.flatMap((each) =>
    each.calls.flatMap((call) => (call.kind === 'playCue' ? [call.cue] : [])),
  );

/**
 * The selector's own surging script (`cues.test.ts`): on the front of four
 * for 90 s, over the group's speed for the first 60 — said twice, then a mark.
 */
function surgingRide(): ReturnType<typeof ride> {
  const line = [RIDER, bot('b1'), bot('b2'), bot('b3')];
  const windows = rideLine({ line, seed: 1, seconds: 90 }).windows;
  const surge = (window: LineWindow): RotationView => {
    if (window.atMs >= 60_000) return window.view;
    const you = window.view.members['you'] as MemberView;
    return {
      ...window.view,
      members: { ...window.view.members, you: { ...you, speedMps: SCRIPT_GROUP_SPEED_MPS + 1 } },
    };
  };
  return ride({ windows, view: surge });
}

describe('a scripted rotation sounds each selected cue once, in order — #3306', () => {
  it('makes one call on the port per selected cue, in its window, with its kind’s sound', () => {
    const { heard, output } = ride({ windows: rotation() });
    const selected = heard.flatMap((each) => (each.selected === null ? [] : [each.selected]));
    // The script selects every event kind.
    for (const kind of CUE_EVENT_KINDS) expect(selected, kind).toContain(kind);
    for (const each of heard) {
      expect(each.calls, `${String(each.atMs)} ms`).toEqual(
        each.selected === null
          ? []
          : [{ kind: 'playCue', cue: GROUP_RIDE_CUE_SOUND[each.selected], gain: RIDE_CUE_LEVEL }],
      );
    }
    expect(played(heard)).toEqual(selected.map((kind) => GROUP_RIDE_CUE_SOUND[kind]));
    // The press's resume, then the sounds and nothing else: no tone.
    expect(output.calls[0]).toEqual({ kind: 'resume' });
    expect(output.count('startTone')).toBe(0);
  });

  it('plays the correction sound for each correction said', () => {
    const { heard } = surgingRide();
    const surgingAt = heard.filter((each) => each.selected === 'surging').map((each) => each.atMs);
    expect(surgingAt).toEqual([5_000, 5_000 + CUE_CORRECTION_GAP_MS]);
    for (const at of surgingAt) {
      expect(heard.find((each) => each.atMs === at)?.calls).toEqual([
        { kind: 'playCue', cue: 'group-correction', gain: RIDE_CUE_LEVEL },
      ]);
    }
  });
});

describe('a correction past its limit, the quiet mark, plays no sound — #3306', () => {
  it('sounds surging twice, and nothing for the mark that follows', () => {
    const { heard } = surgingRide();
    const marks = heard.filter((each) => each.mark !== null);
    expect(marks.map((each) => [each.atMs, each.mark])).toEqual([
      [5_000 + 2 * CUE_CORRECTION_GAP_MS, 'surging'],
    ]);
    expect(marks[0]?.calls).toEqual([]);
    // Two correction sounds in the whole ride: the two said, and none for the mark.
    expect(played(heard).filter((cue) => cue === 'group-correction')).toHaveLength(2);
  });
});

describe('silence is the answer to every “I do not know” — #3306', () => {
  const selectsCues = (heard: readonly Heard[]): void => {
    expect(heard.some((each) => each.selected !== null)).toBe(true);
  };

  it('with sounds off: zero calls on the port across the whole ride', () => {
    const { heard, output } = ride({ windows: rotation(), preference: DEFAULT_CUES });
    selectsCues(heard);
    expect(output.calls).toEqual([]);
  });

  it('muted: nothing after the press’s own resume, across the whole ride', () => {
    const { heard, output } = ride({ windows: rotation(), preference: { ...ON, muted: true } });
    selectsCues(heard);
    expect(output.calls).toEqual([{ kind: 'resume' }]);
    expect(heard.every((each) => each.calls.length === 0)).toBe(true);
  });

  it('the ride not started: zero calls, every cue selected included', () => {
    const { heard, output } = ride({ windows: rotation(), begun: false });
    selectsCues(heard);
    expect(output.calls).toEqual([]);
  });

  it('no power reading: no cue is selected and the port hears nothing after the press', () => {
    const { heard, output } = ride({ windows: rotation(), power: () => null });
    expect(heard.every((each) => each.selected === null && each.mark === null)).toBe(true);
    expect(output.calls).toEqual([{ kind: 'resume' }]);
  });

  it('a reading lost mid-ride: the sounds stop with it and start again with the cues', () => {
    const lost = (atMs: number): number | null => (atMs >= 60_000 && atMs < 120_000 ? null : 200);
    const { heard } = ride({ windows: rotation(), power: lost });
    const during = heard.filter((each) => each.atMs >= 60_000 && each.atMs < 120_000);
    expect(during.length).toBeGreaterThan(0);
    expect(during.every((each) => each.calls.length === 0)).toBe(true);
    expect(heard.some((each) => each.atMs >= 120_000 && each.calls.length > 0)).toBe(true);
  });
});

describe('a cue’s sound plays when its sentence is dropped — #3306, ADR 0101 D-5.5', () => {
  it('a higher-ranked sentence in the same window takes the live region; the sound still plays', () => {
    // A climb ahead (announce.ts rank 5) beside every cue the script selects.
    const windows = rotation();
    const cueAt = new Set(
      ride({ windows }).heard.flatMap((each) => (each.selected === null ? [] : [each.atMs])),
    );
    const higher = (atMs: number): AnnouncementEvent | undefined =>
      cueAt.has(atMs) ? { kind: 'climb-ahead', text: 'Climb ahead.' } : undefined;
    const { heard } = ride({ windows, beside: higher });
    const cued = heard.filter((each) => each.selected !== null);
    expect(cued.length).toBeGreaterThan(0);
    for (const each of cued) {
      // The sentence lost the window…
      expect(each.said, `${String(each.atMs)} ms`).not.toBe(
        groupRideCueEvent({ kind: each.selected as CueKind, atSeconds: 0 }, undefined).event?.text,
      );
      // …and the sound did not.
      expect(each.calls, `${String(each.atMs)} ms`).toEqual([
        {
          kind: 'playCue',
          cue: GROUP_RIDE_CUE_SOUND[each.selected as CueKind],
          gain: RIDE_CUE_LEVEL,
        },
      ]);
    }
  });
});
