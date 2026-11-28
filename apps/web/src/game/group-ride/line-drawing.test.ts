// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The group ride's line as it is drawn — #3304, ADR 0101 D-3.3: single file
 * in one lane, the member who has pulled off one lane to the side while they
 * drift back, the rider never moved, and nothing read back from the drawing.
 *
 * Every case reads `groupRideDrawing`, the function `GameView` draws a frame
 * from, over **every simulation step** of one scripted ride of a line of six
 * (`line-testing.ts`): the five bots' pulls, the rider's own, and the first
 * bot's again. Nothing is sampled.
 */

import { describe, expect, it } from 'vitest';

import { LANE_CHANGE_SECONDS, LANE_OFFSETS_METRES } from '../lanes';
import { BIKE_LENGTH_METRES, NO_PACK_LAYOUT, PACK_ABREAST_METRES } from '../lap-race/pack-layout';
import { SIMULATION_STEP_SECONDS } from '../simulation';

import { rideLine, type LineFrame } from './line-testing';
import {
  GROUP_LINE_LANE,
  GROUP_PULL_OFF_LANE,
  GROUP_RIDE_RIDER_ID,
  groupRideDrawing,
  stepGroupRideSession,
  type GroupRideSession,
} from './ride-group';

const LINE = LANE_OFFSETS_METRES[GROUP_LINE_LANE] as number;
const ASIDE = LANE_OFFSETS_METRES[GROUP_PULL_OFF_LANE] as number;

/** One whole rotation of six and the start of the next: 220 s, 4 401 frames. */
const FRAMES = rideLine({ seconds: 220 });

/**
 * The most a bot takes from the rules' word to the pull-off lane, or back
 * from it once the line has drawn it room, seconds: the pack layout's change
 * of line for a bot (#2665: 1.4 m/s, eased), measured at 1.95 s out and
 * 2.15 s back.
 */
const BOT_ACROSS_MOST_SECONDS = 2.5;

/** The most the rider takes back into the line once the rules have them in it, seconds: measured 0.7. */
const RIDER_BACK_MOST_SECONDS = 1.5;

/** How long after a change ends the line is whole again, seconds. */
const SETTLED_SECONDS = BOT_ACROSS_MOST_SECONDS;

/**
 * The band the drawn drift back must be in, metres a second: about the
 * 1 m/s of a real one (#3304). Measured 1.23 to 1.24 for every bot of this
 * ride, at `rotation.ts` §`ROTATION_EASE_SHARE` 0.12.
 */
const DRIFT_BAND_MPS = [0.9, 1.5] as const;

interface Drawn {
  readonly id: string;
  /** Where it is drawn along the road, metres. */
  readonly along: number;
  /** Where it is drawn across it, metres. */
  readonly across: number;
  /** Its odometer, metres. */
  readonly odometer: number;
}

/** Every member as `groupRideDrawing` draws them, `behindSeconds` before the newest step. */
function drawnAt(session: GroupRideSession, behindSeconds = 0): readonly Drawn[] {
  const riderDrawn = session.rider.distanceM - session.rider.speedMps * behindSeconds;
  const drawing = groupRideDrawing(session, riderDrawn, behindSeconds);
  return [
    {
      id: GROUP_RIDE_RIDER_ID,
      along: drawing.riderDistance,
      across: drawing.steeredLateral,
      odometer: session.rider.distanceM,
    },
    ...session.botIds.map((id, index) => ({
      id,
      along: drawing.raceBots[index]?.distanceMetres as number,
      across: drawing.raceBots[index]?.lateralMetres as number,
      odometer: session.state.bots[id]?.distanceM as number,
    })),
  ];
}

const of = (drawn: readonly Drawn[], id: string): Drawn =>
  drawn.find((each) => each.id === id) as Drawn;

/** A stretch of frames in which one member was aside by the rules, and the frames after it. */
interface Episode {
  readonly id: string;
  /** The first frame the rules had them aside. */
  readonly from: number;
  /** The first frame the rules had them back in the line. */
  readonly back: number;
  /** The frame before the next member pulls off, or the ride's last. */
  readonly until: number;
}

/** Every finished pull-off of the ride, in order. */
function episodes(frames: readonly LineFrame[]): readonly Episode[] {
  const found: Episode[] = [];
  let open: { id: string; from: number; back?: number } | undefined;
  frames.forEach(({ session }, at) => {
    const aside = session.state.rotation.aside;
    if (open !== undefined && open.back === undefined && aside !== open.id) open.back = at;
    if (aside !== null && aside !== open?.id) {
      if (open?.back !== undefined)
        found.push({ id: open.id, from: open.from, back: open.back, until: at - 1 });
      open = { id: aside, from: at };
    }
  });
  if (open?.back !== undefined) {
    found.push({ id: open.id, from: open.from, back: open.back, until: frames.length - 1 });
  }
  return found;
}

const EPISODES = episodes(FRAMES);
const seconds = (frames: number): number => frames * SIMULATION_STEP_SECONDS;

describe('the scripted rotation these cases read', () => {
  it('is every bot’s pull and the rider’s own, each with a drift back and a latch', () => {
    expect(EPISODES.map((episode) => episode.id)).toStrictEqual([
      'bot-1',
      'bot-2',
      'bot-3',
      'bot-4',
      'bot-5',
      GROUP_RIDE_RIDER_ID,
      'bot-1',
    ]);
    const phases = new Set(FRAMES.map(({ session }) => session.phase));
    expect([...phases].sort()).toStrictEqual(['changing', 'forming', 'latching', 'steady']);
  });
});

describe('the line in single file', () => {
  it('stands nose to tail ahead of the rider from the press', () => {
    const drawn = [...drawnAt((FRAMES[0] as LineFrame).session)].sort((a, b) => a.along - b.along);
    expect(drawn[0]?.id).toBe(GROUP_RIDE_RIDER_ID);
    drawn.slice(1).forEach((each, index) => {
      const behind = drawn[index] as Drawn;
      expect(each.across).toBe(LINE);
      expect(each.along - behind.along).toBeCloseTo(
        BIKE_LENGTH_METRES + (each.odometer - behind.odometer),
        9,
      );
    });
  });

  it('in steady, draws every rider in one lane, in odometer order, a bike length and the wheel gap apart', () => {
    let settledSince = 0;
    let read = 0;
    FRAMES.forEach(({ session }, at) => {
      if (session.phase !== 'steady') settledSince = at + 1;
      if (seconds(at - settledSince) < SETTLED_SECONDS) return;
      read += 1;
      const drawn = [...drawnAt(session)].sort((a, b) => b.along - a.along);
      for (const each of drawn) expect(each.across).toBeCloseTo(LINE, 9);
      expect(drawn.map((each) => each.id)).toStrictEqual(
        [...drawn].sort((a, b) => b.odometer - a.odometer).map((each) => each.id),
      );
      drawn.slice(1).forEach((each, index) => {
        const ahead = drawn[index] as Drawn;
        const wheelGap = ahead.odometer - each.odometer;
        expect(wheelGap).toBeGreaterThan(0);
        expect(ahead.along - each.along).toBeCloseTo(BIKE_LENGTH_METRES + wheelGap, 6);
      });
    });
    // Most of the ride is the line riding steady and whole.
    expect(read).toBeGreaterThan(FRAMES.length / 2);
  });

  it('draws no bicycle inside another on any frame, on a step or between two', () => {
    for (const { session } of FRAMES) {
      for (const behind of [0, SIMULATION_STEP_SECONDS / 2]) {
        const drawn = drawnAt(session, behind);
        drawn.forEach((one, index) => {
          for (const other of drawn.slice(index + 1)) {
            const along = Math.abs(one.along - other.along);
            const across = Math.abs(one.across - other.across);
            expect(
              along >= BIKE_LENGTH_METRES - 1e-6 || across >= PACK_ABREAST_METRES - 1e-6,
              `${one.id} and ${other.id} at ${String(session.state.atMs)} ms`,
            ).toBe(true);
          }
        });
      }
    }
  });
});

describe('the rider', () => {
  it('is drawn along the road where the ride has them on every frame, whatever the line does', () => {
    const asideFrames = FRAMES.filter(
      ({ session }) => session.state.rotation.aside === GROUP_RIDE_RIDER_ID,
    );
    expect(asideFrames.length).toBeGreaterThan(0);
    for (const { session } of FRAMES) {
      // The ride's own drawn odometer comes back untouched: what a ride with no group draws.
      for (const drawnOdometer of [session.rider.distanceM, session.rider.distanceM - 0.21, 0]) {
        expect(groupRideDrawing(session, drawnOdometer, 0.02).riderDistance).toBe(drawnOdometer);
      }
    }
  });

  it('is drawn in the line’s lane while they hold a wheel or the front', () => {
    const own = EPISODES.find((episode) => episode.id === GROUP_RIDE_RIDER_ID) as Episode;
    FRAMES.forEach(({ session }, at) => {
      if (at >= own.from && seconds(at - own.back) < RIDER_BACK_MOST_SECONDS) return;
      const drawing = groupRideDrawing(session, 0, 0);
      expect(drawing.steeredLateral).toBe(LINE);
      expect(drawing.steeringSpeed).toBe(0);
    });
  });
});

describe('the member who has pulled off', () => {
  const bots = EPISODES.filter((episode) => episode.id !== GROUP_RIDE_RIDER_ID);

  it('goes to the one stated side: one lane to the left of the line', () => {
    expect(GROUP_PULL_OFF_LANE).toBe(GROUP_LINE_LANE - 1);
    expect(ASIDE).toBeLessThan(LINE);
  });

  it('a bot is drawn one lane to the pull-off side soon after, and stays there while the rules have it aside', () => {
    expect(bots).toHaveLength(6);
    for (const { id, from, back } of bots) {
      // It leaves the line's lane from the first frame, toward the pull-off side only.
      for (let at = from; at < back; at += 1) {
        const across = of(drawnAt((FRAMES[at] as LineFrame).session), id).across;
        expect(across).toBeLessThanOrEqual(LINE + 1e-9);
        expect(across).toBeGreaterThanOrEqual(ASIDE - 1e-9);
        if (seconds(at - from) >= BOT_ACROSS_MOST_SECONDS) expect(across).toBeCloseTo(ASIDE, 9);
      }
      // Both roles of a member aside are in those frames: drifting back, then latching.
      const roles = new Set(
        FRAMES.slice(from, back).map(({ session }) => session.state.rotation.roles[id]),
      );
      expect([...roles].sort()).toStrictEqual(['drifting-back', 'latching']);
      expect(seconds(back - from)).toBeGreaterThan(BOT_ACROSS_MOST_SECONDS);
    }
  });

  it('a bot is back in the line’s lane once it has a wheel role again, and stays there', () => {
    for (const { id, back, until } of bots) {
      for (let at = back; at <= until; at += 1) {
        const { session } = FRAMES[at] as LineFrame;
        expect(['last-wheel', 'in-line', 'second-wheel', 'on-front']).toContain(
          session.state.rotation.roles[id],
        );
        if (seconds(at - back) >= BOT_ACROSS_MOST_SECONDS) {
          expect(of(drawnAt(session), id).across).toBeCloseTo(LINE, 9);
        }
      }
      expect(seconds(until - back)).toBeGreaterThan(BOT_ACROSS_MOST_SECONDS);
    }
  });

  it('the rider’s own lane moves, by the steer’s 0.4 s a lane, and no bot is moved for them', () => {
    const own = EPISODES.find((episode) => episode.id === GROUP_RIDE_RIDER_ID) as Episode;
    const lineBefore = drawnAt((FRAMES[own.from - 1] as LineFrame).session);
    for (let at = own.from; at < own.back; at += 1) {
      const { session } = FRAMES[at] as LineFrame;
      const drawing = groupRideDrawing(session, session.rider.distanceM, 0);
      // The rider: out to the pull-off lane within the lane-change time, and there until they are back.
      if (seconds(at - own.from + 1) >= LANE_CHANGE_SECONDS) {
        expect(drawing.steeredLateral).toBe(ASIDE);
        expect(drawing.steeringSpeed).toBe(0);
      } else {
        expect(drawing.steeringSpeed).toBeLessThan(0);
      }
      // The steer's own state: the lane, and the place across the scene is handed.
      expect(session.riderSteer.lane).toBe(GROUP_PULL_OFF_LANE);
      expect(drawing.steeredLateral).toBe(session.riderSteer.offset);
      // The group: every bot still in the line's lane, in the order it was, nose to tail.
      const drawn = drawnAt(session).filter((each) => each.id !== GROUP_RIDE_RIDER_ID);
      for (const bot of drawn) expect(bot.across).toBeCloseTo(LINE, 9);
      const order = [...drawn].sort((a, b) => b.along - a.along);
      expect(order.map((bot) => bot.id)).toStrictEqual(
        [...lineBefore]
          .filter((each) => each.id !== GROUP_RIDE_RIDER_ID)
          .sort((a, b) => b.along - a.along)
          .map((bot) => bot.id),
      );
      order.slice(1).forEach((bot, index) => {
        const ahead = order[index] as Drawn;
        expect(ahead.along - bot.along).toBeCloseTo(
          BIKE_LENGTH_METRES + (ahead.odometer - bot.odometer),
          6,
        );
      });
    }
    expect(seconds(own.back - own.from)).toBeGreaterThan(2 * LANE_CHANGE_SECONDS);
    // And they are back in the line's lane, on the last wheel, soon after the rules say so.
    const after = (
      FRAMES[own.back + Math.ceil(RIDER_BACK_MOST_SECONDS / SIMULATION_STEP_SECONDS)] as LineFrame
    ).session;
    expect(after.role).toBe('last-wheel');
    expect(groupRideDrawing(after, 0, 0).steeredLateral).toBe(LINE);
  });

  it('draws the frames between two steps between the rider’s two places across', () => {
    const own = EPISODES.find((episode) => episode.id === GROUP_RIDE_RIDER_ID) as Episode;
    const moving = (FRAMES[own.from + 2] as LineFrame).session;
    expect(moving.steeredBefore).not.toBe(moving.riderSteer.offset);
    expect(moving.steeredBefore).toBe(
      (FRAMES[own.from + 1] as LineFrame).session.riderSteer.offset,
    );
    expect(groupRideDrawing(moving, 0, 0).steeredLateral).toBe(moving.riderSteer.offset);
    expect(groupRideDrawing(moving, 0, SIMULATION_STEP_SECONDS).steeredLateral).toBe(
      moving.steeredBefore,
    );
    expect(groupRideDrawing(moving, 0, SIMULATION_STEP_SECONDS / 2).steeredLateral).toBeCloseTo(
      (moving.steeredBefore + moving.riderSteer.offset) / 2,
      9,
    );
  });
});

describe('a rider back in the line before the drawn line has room for them', () => {
  // They take the last wheel 5 cm back: in the line by the rules, and drawn level with the last bot.
  const CLOSE = rideLine({ seconds: 190, latchGapMetres: 0.05 });
  const own = episodes(CLOSE).find((episode) => episode.id === GROUP_RIDE_RIDER_ID) as Episode;

  it('stays in the pull-off lane until every bot is drawn a bike length from them, then comes across', () => {
    const lane = (at: number): number => (CLOSE[at] as LineFrame).session.riderSteer.lane;
    const nearest = (at: number): number => {
      const drawn = drawnAt((CLOSE[at] as LineFrame).session);
      const rider = of(drawn, GROUP_RIDE_RIDER_ID);
      return Math.min(
        ...drawn.filter((each) => each !== rider).map((each) => Math.abs(each.along - rider.along)),
      );
    };
    // Back by the rules, and the last bot is drawn beside them: no room yet.
    expect((CLOSE[own.back] as LineFrame).session.role).toBe('last-wheel');
    expect(nearest(own.back)).toBeLessThan(BIKE_LENGTH_METRES);
    expect(lane(own.back)).toBe(GROUP_PULL_OFF_LANE);
    // The frame before they start across, the line has drawn them their bike length.
    let across = own.back;
    while (lane(across) === GROUP_PULL_OFF_LANE) across += 1;
    expect(across).toBeGreaterThan(own.back + 1);
    expect(nearest(across - 1)).toBeGreaterThanOrEqual(BIKE_LENGTH_METRES - 1e-6);
    expect(seconds(across - own.back)).toBeLessThan(RIDER_BACK_MOST_SECONDS);
    for (let at = across; at <= own.until; at += 1) expect(lane(at)).toBe(GROUP_LINE_LANE);
  });

  it('is never drawn inside a bot on the way', () => {
    for (const { session } of CLOSE.slice(own.from, own.until + 1)) {
      const drawn = drawnAt(session);
      const rider = of(drawn, GROUP_RIDE_RIDER_ID);
      for (const bot of drawn) {
        if (bot === rider) continue;
        expect(
          Math.abs(bot.along - rider.along) >= BIKE_LENGTH_METRES - 1e-6 ||
            Math.abs(bot.across - rider.across) >= PACK_ABREAST_METRES - 1e-6,
        ).toBe(true);
      }
    }
  });
});

describe('the measured drift back', () => {
  it('a bot dropping from first to last of six is drawn falling back at about 1 m/s', () => {
    const measured: number[] = [];
    for (const { id, from, back } of EPISODES) {
      if (id === GROUP_RIDE_RIDER_ID) continue;
      // Against the line's new front, from the frame it pulls off to the frame it has the last wheel.
      const behindFront = (at: number): number => {
        const { session } = FRAMES[at] as LineFrame;
        const drawn = drawnAt(session);
        const front = session.state.rotation.order[0] as string;
        return of(drawn, front).along - of(drawn, id).along;
      };
      const fell = behindFront(back) - behindFront(from);
      // The whole drawn line: a row ahead of the front to behind the last wheel.
      expect(fell).toBeGreaterThan(5 * BIKE_LENGTH_METRES);
      measured.push(fell / seconds(back - from));
    }
    expect(measured).toHaveLength(6);
    for (const speed of measured) {
      expect(speed).toBeGreaterThan(DRIFT_BAND_MPS[0]);
      expect(speed).toBeLessThan(DRIFT_BAND_MPS[1]);
    }
  });
});

describe('the drawing is the group’s state and nothing reads it back', () => {
  it('gives the same drawing for the same state, and leaves what it read as it was', () => {
    const { session } = FRAMES[(EPISODES[0] as Episode).from + 40] as LineFrame;
    const step = {
      ticks: 3,
      rider: { distanceM: session.rider.distanceM + 1.2, speedMps: session.rider.speedMps },
      riderStopped: false,
    };
    const kept = JSON.stringify([session, [...session.pack]]);
    const once = stepGroupRideSession(session, step);
    const again = stepGroupRideSession(session, step);
    expect(JSON.stringify([session, [...session.pack]])).toBe(kept);
    expect([...again.pack]).toStrictEqual([...once.pack]);
    expect(again.riderSteer).toStrictEqual(once.riderSteer);
    expect(groupRideDrawing(again, 12.5, 0.03)).toStrictEqual(groupRideDrawing(once, 12.5, 0.03));
  });

  it('rides the same ride whatever the drawing holds: the rules, the draft and the log never read it', () => {
    // The same rider beside two sessions; one has its drawing thrown away before every step.
    let drawn = (FRAMES[0] as LineFrame).session;
    let blind = drawn;
    for (let at = 1; at <= 1_200; at += 1) {
      const rider = (FRAMES[at] as LineFrame).session.rider;
      const step = { ticks: 1, rider, riderStopped: false };
      drawn = stepGroupRideSession(drawn, step);
      blind = stepGroupRideSession(
        {
          ...blind,
          pack: NO_PACK_LAYOUT,
          riderSteer: { lane: GROUP_PULL_OFF_LANE, offset: ASIDE },
          steeredBefore: ASIDE,
        },
        step,
      );
      expect(blind.state).toStrictEqual(drawn.state);
      expect(blind.riderDraft).toBe(drawn.riderDraft);
      expect(blind.groupSpeedMps).toBe(drawn.groupSpeedMps);
      expect(blind.role).toBe(drawn.role);
    }
    expect(blind.log).toStrictEqual(drawn.log);
    // The control: the two drawings did differ, so something was there to be read.
    expect(drawn.state.rotation.aside).not.toBeNull();
    expect([...blind.pack]).not.toStrictEqual([...drawn.pack]);
  });
});
