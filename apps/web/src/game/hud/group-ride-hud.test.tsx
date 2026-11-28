// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A group ride on the HUD — #3305 (ADR 0101 D-5): the cue line, the role
 * strip and the announcer's rank, read back from **the HUD the game mounts**
 * (`HudPanel`), never from the selector's answer.
 *
 * The rotation is scripted (`@onyourleft/domain` §`rideLine`, the script the
 * selector's own suite rides): a line of six with a clean rider, a climb after
 * their first turn, and the line waiting late in the ride. Each window goes
 * through the real selector (`stepCues`), the bookkeeping the ride's session
 * uses (`groupRideCueSelected`, `groupRideCueShowing`, `groupRideCueEvent`),
 * the real announcer's core, and onto the real HUD.
 */

import type { JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CUE_EVENT_KINDS,
  CUE_KINDS,
  ROTATION_RIDER_PULL_MS,
  ROTATION_WINDOW_MS,
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  pacerSayProblem,
  routeProfile,
  startCues,
  stepCues,
  type CueKind,
  type LineMember,
  type MemberView,
  type RoutePoint,
} from '@onyourleft/domain';
import { rideLine, type LineWindow } from '@onyourleft/domain/group-ride-line-testing';

import { mount, type Mounted } from '../../testing/mount';
import { atStartLine } from '../simulation';

import {
  ALWAYS_SPOKEN,
  ANNOUNCE_WINDOW_SECONDS,
  INITIAL_ANNOUNCER,
  PRIORITY,
  announce,
  type AnnouncementEvent,
  type AnnouncerState,
} from './announce';
import { DEFAULT_ANNOUNCEMENTS } from './announce-preference';
import { NO_READING, hudReadings } from './fields';
import {
  GROUP_RIDE_CUE_LABEL,
  GROUP_RIDE_CUE_SHOWN_SECONDS,
  GROUP_RIDE_CUE_TEXT,
  GROUP_RIDE_TEXT,
  groupRideCueEvent,
  groupRideCueSelected,
  groupRideCueShowing,
  groupRideReadings,
  type GroupRideCueShown,
  type GroupRideHud,
} from './group-ride-hud';
import { GROUP_RIDE_CUE_CLASS, groupCueNotice } from './GroupRideCue';
import { HudPanel } from './HudPanel';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function route(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 20; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(10),
    });
  }
  return routeProfile(points);
}

const PROFILE = route();

function bot(id: string): LineMember {
  return {
    id,
    kind: 'bot',
    capacity: { cpWatts: 250, wPrimeJoules: 18_000, peakWatts: 450, floorWatts: 200 },
  };
}

const RIDER = 'you';
const SIX: readonly LineMember[] = [
  bot('b1'),
  bot('b2'),
  { id: RIDER, kind: 'rider' },
  bot('b3'),
  bot('b4'),
  bot('b5'),
];

/** Where the script's climb begins, metres: past the rider's first turn on the front. */
const CLIMB_AT_METRES = 1_500;
/** From when the script's line waits for the rider, ms. */
const WAITING_FROM_MS = 215_000;
const RIDE_SECONDS = 240;

/**
 * The scripted rotation: the rider third in a line of six, holding the wheel
 * and pressing pull off a window after the cue asks; a climb ahead after their
 * first turn; and the line waiting from {@link WAITING_FROM_MS}.
 */
function rotation(): readonly LineWindow[] {
  return rideLine({
    line: SIX,
    seed: 7,
    seconds: RIDE_SECONDS,
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

/** The strip for a scripted window, as `ride-group.ts` §`groupRideStrip` reads a session. */
function stripOf(window: LineWindow, live = true): GroupRideHud {
  const { order, pull, line } = window.step.state;
  const at = order.indexOf(RIDER);
  const wheel = at > 0 ? order[at - 1] : at < 0 ? order[order.length - 1] : undefined;
  const me = window.view.members[RIDER] as MemberView;
  const gap =
    wheel === undefined
      ? undefined
      : (window.view.members[wheel] as MemberView).distanceM - me.distanceM;
  return {
    place: at < 0 ? line.length : at + 1,
    of: line.length,
    gapMetres: gap !== undefined && gap > 0 ? gap : undefined,
    pullLeftSeconds:
      window.step.roles[RIDER] === 'on-front' && pull !== null && pull.by === RIDER
        ? Math.max(0, Math.ceil((pull.endsAtMs - window.atMs) / 1_000))
        : undefined,
    groupSpeed: window.view.groupSpeedMps,
    targetSpeed: 28 / 3.6,
    live,
  };
}

/** The HUD the game mounts, with a group on it. */
function panel(
  strip: GroupRideHud | undefined,
  cue: string | undefined,
  announcement = '',
): JSX.Element {
  return (
    <main>
      <h1>Ride</h1>
      <HudPanel
        profile={PROFILE}
        state={atStartLine(PROFILE)}
        cadence={{ value: 88, live: true }}
        heartRate={{ value: 150, live: true }}
        onPause={() => undefined}
        onEnd={() => undefined}
        paused={false}
        announcement={announcement}
        groupRide={strip}
        notices={[groupCueNotice(cue)]}
      />
    </main>
  );
}

const text = (element: Element | null | undefined): string =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The cue line as the HUD draws it: its sentence without its label, or `undefined` with none drawn. */
function cueLine(): string | undefined {
  const line = document.querySelector(`.${GROUP_RIDE_CUE_CLASS}`);
  if (line === null) return undefined;
  const label = text(line.querySelector('.oyl-status__label'));
  expect(label).toBe(`${GROUP_RIDE_CUE_LABEL}:`);
  // The glyph is `aria-hidden`; the sentence is what follows the label.
  return text(line)
    .slice(text(line).indexOf(label) + label.length)
    .trim();
}

/** The field labelled `label`, as a screen reader hears it: its term, then its definition. */
function field(label: string): string | undefined {
  const found = [...document.querySelectorAll('.oyl-hud__field')].find(
    (each) => text(each.querySelector('dt')) === label,
  );
  return found === undefined
    ? undefined
    : `${text(found.querySelector('dt'))} ${text(found.querySelector('dd'))}`;
}

/** The HUD's one live region. */
function region(): string {
  return text(document.querySelector('[data-oyl-announcer="hud"]'));
}

const ANNOUNCING = {
  ...DEFAULT_ANNOUNCEMENTS,
  enabled: true,
  powerEverySeconds: 'never',
  distanceEvery: 'never',
} as const;

describe('one sentence for every cue kind — #3305', () => {
  it('has a sentence for each kind the selector can choose, and for nothing else', () => {
    expect(CUE_KINDS.length).toBeGreaterThanOrEqual(13);
    for (const kind of CUE_KINDS) {
      const sentence = (GROUP_RIDE_CUE_TEXT as Partial<Record<CueKind, string>>)[kind];
      expect(sentence, `${kind} has no sentence: it would ship silent on the HUD`).toBeTypeOf(
        'string',
      );
      expect((sentence ?? '').trim().length, kind).toBeGreaterThan(0);
    }
    expect(Object.keys(GROUP_RIDE_CUE_TEXT).sort()).toEqual([...CUE_KINDS].sort());
    // Exactly one each: no two kinds read alike.
    expect(new Set(Object.values(GROUP_RIDE_CUE_TEXT)).size).toBe(CUE_KINDS.length);
  });
});

describe('the cue line through a scripted rotation, on the real HUD — #3305', () => {
  it('shows each event sentence when its kind is selected and clears it after its shown time', async () => {
    const windows = rotation();
    let cues = startCues(0);
    let shown: GroupRideCueShown | undefined;
    // The test's own account of what should be on the line.
    let last: { kind: CueKind; atMs: number } | undefined;
    const selected: CueKind[] = [];
    const cleared = new Set<CueKind>();
    mounted = await mount(panel(stripOf(windows[0] as LineWindow), undefined));
    expect(cueLine()).toBeUndefined();
    for (const window of windows) {
      const answer = stepCues(cues, {
        rotation: window.step,
        line: window.view,
        powerWatts: 200,
        thresholdWatts: null,
      });
      cues = answer.state;
      const now = window.atMs / 1_000;
      shown = groupRideCueSelected(shown, answer.cue, now);
      await mounted.rerender(panel(stripOf(window), groupRideCueShowing(shown, now)));
      if (answer.cue !== null) {
        last = { kind: answer.cue.kind, atMs: window.atMs };
        selected.push(answer.cue.kind);
        // On the HUD in the window it was selected in.
        expect(cueLine(), `${answer.cue.kind} at ${String(now)} s`).toBe(
          GROUP_RIDE_CUE_TEXT[answer.cue.kind],
        );
      } else if (last === undefined) {
        expect(cueLine()).toBeUndefined();
      } else if (window.atMs - last.atMs < GROUP_RIDE_CUE_SHOWN_SECONDS * 1_000) {
        expect(cueLine(), `${last.kind} still showing at ${String(now)} s`).toBe(
          GROUP_RIDE_CUE_TEXT[last.kind],
        );
      } else {
        expect(cueLine(), `${last.kind} cleared by ${String(now)} s`).toBeUndefined();
        cleared.add(last.kind);
      }
    }
    // Every event kind was selected by the script, and so was on the HUD.
    for (const kind of CUE_EVENT_KINDS) expect(selected, kind).toContain(kind);
    // The rider's first turn, in order.
    expect(selected.slice(0, 6)).toEqual([
      'next-up',
      'your-pull',
      'pull-off',
      'ease',
      'last-wheel',
      'back-in-line',
    ]);
    // And the line was seen empty again after a cue that nothing followed.
    for (const kind of ['next-up', 'your-pull', 'back-in-line', 'climb'] as const) {
      expect(cleared, `${kind} was never seen cleared`).toContain(kind);
    }
  });

  it('is one labelled notice, drawn as the pacer’s line, and not a second live region', async () => {
    mounted = await mount(panel(undefined, GROUP_RIDE_CUE_TEXT['pull-off']));
    const line = document.querySelector(`.${GROUP_RIDE_CUE_CLASS}`);
    expect(text(line)).toContain('Group ride: Pull off now.');
    expect(line?.closest('[role="status"], [aria-live]')).toBeNull();
    expect(document.querySelectorAll('[role="status"], [aria-live]')).toHaveLength(1);
  });
});

describe('the role strip on the real HUD — #3305', () => {
  const IN_LINE: GroupRideHud = {
    place: 3,
    of: 6,
    gapMetres: 1.24,
    pullLeftSeconds: undefined,
    groupSpeed: 31.4 / 3.6,
    targetSpeed: 30 / 3.6,
    live: true,
  };

  it('shows the place in the line, the gap to the wheel ahead and both speeds', async () => {
    mounted = await mount(panel(IN_LINE, undefined));
    expect(field('In line')).toBe('In line 3 of 6 Gap 1.2 m');
    expect(field('Group')).toBe('Group 31 km/h Target average 30');
    // Two fields, in a lap race's places and a mode's readings.
    const fields = [...document.querySelectorAll('.oyl-hud__field--group-ride')];
    expect(fields).toHaveLength(2);
    expect(fields.every((each) => each.classList.contains('oyl-hud__field--lap-race'))).toBe(true);
  });

  it('reads the gap in feet and the speeds in mph for a rider who reads imperial', () => {
    const [line, group] = groupRideReadings(IN_LINE, 'imperial');
    expect(line?.detail).toBe('Gap 4 ft');
    expect(`${group?.value ?? ''} ${group?.unit ?? ''} ${group?.detail ?? ''}`).toBe(
      '20 mph Target average 19',
    );
  });

  it('shows the countdown only while the rider is on the front, through the scripted rotation', async () => {
    const windows = rotation();
    mounted = await mount(panel(stripOf(windows[0] as LineWindow), undefined));
    const counted: number[] = [];
    let offFront = 0;
    for (const window of windows) {
      await mounted.rerender(panel(stripOf(window), undefined));
      const read = field('In line') ?? '';
      const pull = /Pull (\d+) s/.exec(read);
      if (window.step.roles[RIDER] === 'on-front') {
        expect(pull, `on the front at ${String(window.atMs)} ms: ${read}`).not.toBeNull();
        expect(read.startsWith('In line 1 of 6')).toBe(true);
        counted.push(Number(pull?.[1]));
      } else {
        expect(
          pull,
          `${window.step.roles[RIDER] ?? ''} at ${String(window.atMs)} ms: ${read}`,
        ).toBeNull();
        offFront += 1;
      }
    }
    // A whole pull was counted down, from its length to nothing, and never up.
    expect(counted[0]).toBe(ROTATION_RIDER_PULL_MS / 1_000);
    expect(counted).toContain(1);
    expect(
      counted.every((left, index) => index === 0 || left <= (counted[index - 1] as number)),
    ).toBe(true);
    expect(offFront).toBeGreaterThan(100);
  });

  it('shows no gap on the front or level with the wheel, where there is none to close', () => {
    for (const gapMetres of [undefined, 0, -3]) {
      const [line] = groupRideReadings({ ...IN_LINE, place: 1, gapMetres }, 'metric');
      expect(line?.detail).toBeUndefined();
    }
  });

  it('with no power reading shows a dash for the place and the group’s speed, never a zero', async () => {
    const lost: GroupRideHud = {
      ...IN_LINE,
      place: 1,
      gapMetres: undefined,
      pullLeftSeconds: 12,
      groupSpeed: 0,
      live: false,
    };
    mounted = await mount(panel(lost, undefined));
    const line = field('In line') ?? '';
    const group = field('Group') ?? '';
    expect(line).toContain(`In line ${NO_READING} of 6`);
    expect(group).toContain(`Group ${NO_READING} km/h`);
    // No place, no countdown, no gap and no speed: the only digits left are the
    // line's size and the average the rider chose.
    expect(line.replace('of 6', '')).not.toMatch(/\d/);
    expect(group.replace('Target average 30', '')).not.toMatch(/\d/);
    expect(line).not.toContain('Pull');
    expect(group).toContain('Target average 30');
  });

  it('puts nothing on an ordinary ride’s HUD', async () => {
    mounted = await mount(panel(undefined, undefined));
    expect(field('In line')).toBeUndefined();
    expect(field('Group')).toBeUndefined();
    expect(cueLine()).toBeUndefined();
  });
});

describe('the announcer’s rank for a cue — #3305, ADR 0101 D-5.5', () => {
  const cue = (kind: CueKind): AnnouncementEvent => ({
    kind: 'group-ride-cue',
    text: GROUP_RIDE_CUE_TEXT[kind],
  });

  it('is one rank: below every safety and workout sentence, above a lap and every reading', () => {
    const rank = PRIORITY.indexOf('group-ride-cue');
    expect(rank).toBeGreaterThan(-1);
    expect(PRIORITY.filter((kind) => kind.startsWith('group-ride'))).toEqual(['group-ride-cue']);
    for (const above of [
      'trainer-lost',
      'workout-fault',
      'interval-now',
      'interval-ahead',
      'climb-ahead',
      'not-recording',
      'screen-off-risk',
      'erg-held',
      'hold-changed',
      'plan-changed',
    ] as const) {
      expect(rank, above).toBeGreaterThan(PRIORITY.indexOf(above));
    }
    for (const below of ['lap-ended', 'power-off-target', 'distance-tick', 'power'] as const) {
      expect(rank, below).toBeLessThan(PRIORITY.indexOf(below));
    }
    // It follows the rider's announcement setting.
    expect(ALWAYS_SPOKEN).not.toContain('group-ride-cue');
  });

  it.each([
    ['a workout block', { kind: 'interval-now', text: 'Now: 4 minutes at 200 watts.' }],
    ['a safety sentence', { kind: 'trainer-lost', text: 'Control lost.' }],
    ['the climb ahead', { kind: 'climb-ahead', text: 'Climb in 250 metres.' }],
  ] as const)(
    'due in the same window as %s: that one reaches the live region and the cue is dropped, not queued',
    async (_name, higher) => {
      mounted = await mount(panel(undefined, undefined));
      let state: AnnouncerState = INITIAL_ANNOUNCER;
      const heard: string[] = [];
      const say = async (now: number, events: readonly AnnouncementEvent[]): Promise<void> => {
        const said = announce(state, { now, readings: [], events, preference: ANNOUNCING });
        state = said.state;
        if (said.sentence !== undefined) {
          await mounted?.rerender(panel(undefined, undefined, said.sentence));
          heard.push(region());
        }
      };
      // Something was said a second ago, so both of these wait for the window.
      await say(0, [{ kind: 'lap-ended', text: 'Lap 1 done.' }]);
      await say(1, [cue('pull-off'), higher]);
      // The window opens, and stays open for three more of them.
      for (let now = ANNOUNCE_WINDOW_SECONDS; now <= 4 * ANNOUNCE_WINDOW_SECONDS; now += 0.5) {
        await say(now, []);
      }
      expect(heard).toEqual(['Lap 1 done.', higher.text]);
      expect(heard).not.toContain(GROUP_RIDE_CUE_TEXT['pull-off']);
    },
  );

  it('is said when nothing higher is due, and only with announcements on', () => {
    const on = announce(INITIAL_ANNOUNCER, {
      now: 0,
      readings: [],
      events: [cue('next-up')],
      preference: ANNOUNCING,
    });
    expect(on.sentence).toBe('You are next on the front.');
    expect(on.kind).toBe('group-ride-cue');
    const off = announce(INITIAL_ANNOUNCER, {
      now: 0,
      readings: [],
      events: [cue('next-up')],
      preference: DEFAULT_ANNOUNCEMENTS,
    });
    expect(off.sentence).toBeUndefined();
  });

  it('a cue is offered once: the same cue on the next frame offers nothing', () => {
    const first: GroupRideCueShown = { kind: 'next-up', atSeconds: 10 };
    expect(groupRideCueEvent(undefined, undefined)).toEqual({
      event: undefined,
      offered: undefined,
    });
    const offer = groupRideCueEvent(first, undefined);
    expect(offer.event).toEqual(cue('next-up'));
    expect(offer.offered).toBe(first);
    const repeat = groupRideCueEvent(first, offer.offered);
    expect(repeat.event).toBeUndefined();
    expect(repeat.offered).toBe(first);
    // The same kind selected again is a new cue.
    const again = groupRideCueSelected(first, { kind: 'next-up' }, 200);
    expect(again).toEqual({ kind: 'next-up', atSeconds: 200 });
    expect(again).not.toBe(first);
    expect(groupRideCueEvent(again, first).event).toEqual(cue('next-up'));
    // A window that selected none keeps the one before.
    expect(groupRideCueSelected(first, null, 11)).toBe(first);
  });
});

describe('the pull’s countdown never reaches the live region — #3305, ADR 0101 D-5.3', () => {
  it('counts the region’s updates over a 30 s pull: the cues, and no second of the countdown', async () => {
    const windows = rotation();
    const from = windows.findIndex((window) => window.step.roles[RIDER] === 'on-front');
    expect(from).toBeGreaterThan(0);
    let cues = startCues(0);
    let shown: GroupRideCueShown | undefined;
    let offered: GroupRideCueShown | undefined;
    let state: AnnouncerState = INITIAL_ANNOUNCER;
    mounted = await mount(panel(stripOf(windows[0] as LineWindow), undefined));
    const updates: string[] = [];
    const counted = new Set<string>();
    let before = region();
    for (const [index, window] of windows.entries()) {
      const answer = stepCues(cues, {
        rotation: window.step,
        line: window.view,
        powerWatts: 200,
        thresholdWatts: null,
      });
      cues = answer.state;
      const now = window.atMs / 1_000;
      shown = groupRideCueSelected(shown, answer.cue, now);
      const strip = stripOf(window);
      const offer = groupRideCueEvent(shown, offered);
      offered = offer.offered;
      // The frame's loop: the HUD's own readings, the strip's included, go to the core.
      const said = announce(state, {
        now,
        readings: hudReadings({
          profile: PROFILE,
          state: atStartLine(PROFILE),
          cadence: { value: 88, live: true },
          heartRate: { value: 150, live: true },
          groupRide: strip,
        }),
        events: offer.event === undefined ? [] : [offer.event],
        preference: { ...DEFAULT_ANNOUNCEMENTS, enabled: true },
      });
      state = said.state;
      await mounted.rerender(
        panel(strip, groupRideCueShowing(shown, now), said.sentence ?? before),
      );
      if (window.step.roles[RIDER] !== 'on-front' || index < from) {
        before = region();
        continue;
      }
      const pull = /Pull (\d+) s/.exec(field('In line') ?? '');
      if (pull?.[1] !== undefined) counted.add(pull[1]);
      if (region() !== before) updates.push(region());
      before = region();
    }
    // The strip counted the whole pull down, a second at a time.
    expect(counted.size).toBeGreaterThanOrEqual(ROTATION_RIDER_PULL_MS / 1_000);
    // The region changed for the pull's cues and the ride's ordinary readings,
    // far fewer times than the countdown's seconds, and never with a second of it.
    expect(updates).toContain(GROUP_RIDE_CUE_TEXT['your-pull']);
    expect(updates).toContain(GROUP_RIDE_CUE_TEXT['pull-off']);
    expect(updates.length, updates.join(' | ')).toBeLessThanOrEqual(3);
    for (const update of updates) {
      expect(update).not.toMatch(/Pull \d|In line|\d+ s\b/);
    }
  });
});

describe('what no sentence may say — #3305 (ADR 0004 D, ADR 0009, ADR 0030, ADR 0101 D-5.4)', () => {
  /** Every word the group ride puts on the HUD or says: the cues, the label and the strip's. */
  const SENTENCES: readonly string[] = [
    ...CUE_KINDS.map((kind) => GROUP_RIDE_CUE_TEXT[kind]),
    GROUP_RIDE_CUE_LABEL,
    GROUP_RIDE_TEXT.line,
    GROUP_RIDE_TEXT.group,
    GROUP_RIDE_TEXT.pull(30),
    GROUP_RIDE_TEXT.gap('1.2 m'),
    GROUP_RIDE_TEXT.target('30'),
  ];
  const CUES: readonly string[] = CUE_KINDS.map((kind) => GROUP_RIDE_CUE_TEXT[kind]);

  /**
   * The fixed "effort up" list: words that ask the rider for more. A cue asks
   * for the group's speed, for less, or for a place in the line, and never
   * for this.
   */
  const EFFORT_UP =
    /\b(?:harder|faster|push\w*|sprint\w*|attack\w*|chas\w*|dig\w*|surge\b|accelerat\w*|speed\s+up|more\s+(?:power|effort|watts)|pick\s+(?:it\s+)?up|go\s+(?:hard|deep|all\s+out)|give\s+it|step\s+on|hammer\w*|drive\w*|power\s+up|lift\s+(?:the|your)|raise\s+(?:the|your)|catch\s+up|hurry|quick\w*|come\s+on|keep\s+up|don'?t\s+(?:slow|ease|stop)|no\s+pain|suffer\w*|empty\s+the)\b/i;

  /** The one use of a listed word that asks for less: "no faster". */
  const withoutNoFaster = (sentence: string): string => sentence.replace(/\bno faster\b/gi, '');

  it('no digit run in any cue, so nothing that could be a coordinate or a target', () => {
    for (const sentence of CUES) expect(sentence, sentence).not.toMatch(/\d/);
    // The strip's own digits are a count of seconds, a gap and a speed: never a coordinate's run.
    for (const sentence of SENTENCES) expect(sentence, sentence).not.toMatch(/-?\d+\.\d{3,}/);
  });

  it('no place name: no capital but a sentence’s first letter', () => {
    for (const sentence of SENTENCES) {
      const inside = sentence.replace(/(^|[.!?]\s+)\p{Lu}/gu, '$1');
      expect(inside, sentence).not.toMatch(/\p{Lu}/u);
    }
  });

  it('none of the load-metric trademarks, no medical wording and no number, by the pacer line’s screen', () => {
    for (const sentence of CUES) {
      expect(pacerSayProblem(sentence), sentence).toBeUndefined();
    }
    for (const sentence of SENTENCES) {
      expect(sentence, sentence).not.toMatch(/\b(?:NP|TSS|IF|CTL|ATL|TSB)\b/);
      expect(sentence, sentence).not.toMatch(
        /normali[sz]ed\s+power|training\s+stress|intensity\s+factor|training\s+load/i,
      );
      expect(sentence, sentence).not.toMatch(
        /\b(?:heart|cardiac|medical\w*|doctors?|injur\w*|pain\w*|health\w*|fatigue\w*|tired|exhaust\w*|lactate|breath\w*|calories?|fitness|weight|body)\b/i,
      );
    }
  });

  it('no other product’s wording, and nobody is called a leader', () => {
    for (const sentence of SENTENCES) {
      expect(sentence, sentence).not.toMatch(
        /\b(?:leaders?|zwift\w*|strava\w*|peloton\w*|rouvy|trainerroad|wahoo)\b/i,
      );
    }
  });

  it('none urges more effort: nothing from the fixed "effort up" list', () => {
    for (const sentence of SENTENCES) {
      expect(withoutNoFaster(sentence), sentence).not.toMatch(EFFORT_UP);
    }
    // The list can fail: it catches the sentence a careless cue would be.
    expect('Close the gap, push harder.').toMatch(EFFORT_UP);
    expect('Speed up to the wheel.').toMatch(EFFORT_UP);
    expect(withoutNoFaster('Ride faster.')).toMatch(EFFORT_UP);
  });
});
