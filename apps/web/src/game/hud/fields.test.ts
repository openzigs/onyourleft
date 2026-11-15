// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #94's second and fourth acceptance criteria, as data.
 *
 * The rendering half is `HudPanel.test.tsx`; this is the model underneath it,
 * which is where the dropped-sensor rule actually lives. Splitting them that way
 * means the rule is asserted once against the data and once against the DOM —
 * and a change that satisfied one without the other would be caught.
 */

import { describe, expect, it } from 'vitest';

import {
  CALORIES_KEY,
  CLOCK_KEY,
  CRASHED_TEXT,
  DELIVERY_HOUSES_KEY,
  DELIVERY_NEXT_KEY,
  DELIVERY_SCORE_KEY,
  ELAPSED_TIME_KEY,
  GRADIENT_KEY,
  MOVING_TIME_KEY,
  NO_READING,
  POWER_QUALIFIERS,
  RIDE_CLOCK_LABEL,
  RIDE_TOTAL_KEYS,
  WATTS_PER_KILOGRAM_KEY,
  ZONE_KEY,
  gapAgainst,
  givesWayToTheRoom,
  hudReadings,
  isDeliveryReading,
  isEffortReading,
  isRideTotalReading,
  isRoomReading,
  profileReading,
  readingTier,
  trainerLine,
  type DeliveryHud,
  type HudInput,
} from './fields';
import { DRAFT_FULL_SCALE_PERCENT } from './draft-scale';
import { atStartLine } from '../simulation';
import { FRESH_WEEK, recordDelivery, recordMiss, startRound } from '../delivery/round';
import {
  MAX_SIMULATED_GRADE_PERCENT,
  SIMULATION_SETPOINT_INTERVAL_SECONDS,
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradePercent,
  joules,
  kilocalories,
  kilograms,
  metres,
  metresPerSecond,
  pacerGap,
  routeProfile,
  seconds,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';

function route(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 100; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index * 0.4),
    });
  }
  return routeProfile(points);
}

function baseInput(): HudInput {
  const profile = route();
  return {
    profile,
    state: atStartLine(profile),
    cadence: { value: 88, live: true },
    heartRate: { value: 152, live: true },
  };
}

/**
 * A 400 m x 200 m circuit, closed, so `loop: true` is honest — #287.
 *
 * `route()` above is a straight kilometre and can never be a loop, which is why
 * the clamped fraction survived this file for as long as it did: every
 * assertion here was made against the one shape the clamp is correct for.
 */
function circuit(): ReturnType<typeof routeProfile> {
  const metresPerDegree = 111_320;
  const halfHeight = 100 / metresPerDegree;
  const east = 400 / (metresPerDegree * Math.cos((51.5 * Math.PI) / 180));
  const corners: readonly (readonly [number, number])[] = [
    [51.5 - halfHeight, -0.12],
    [51.5 - halfHeight, -0.12 + east],
    [51.5 + halfHeight, -0.12 + east],
    [51.5 + halfHeight, -0.12],
    [51.5 - halfHeight, -0.12],
  ];
  const points: RoutePoint[] = [];
  for (let corner = 0; corner < corners.length - 1; corner += 1) {
    const [fromLatitude, fromLongitude] = corners[corner] as readonly [number, number];
    const [toLatitude, toLongitude] = corners[corner + 1] as readonly [number, number];
    for (let step = 0; step < 40; step += 1) {
      const fraction = step / 40;
      points.push({
        position: geographicPosition(
          degreesLatitude(fromLatitude + (toLatitude - fromLatitude) * fraction),
          degreesLongitude(fromLongitude + (toLongitude - fromLongitude) * fraction),
        ),
        elevation: altitudeMetres(10 + step * 0.1),
      });
    }
  }
  const [lastLatitude, lastLongitude] = corners[corners.length - 1] as readonly [number, number];
  points.push({
    position: geographicPosition(degreesLatitude(lastLatitude), degreesLongitude(lastLongitude)),
    elevation: altitudeMetres(10),
  });
  return routeProfile(points, { loop: true });
}

function loopInput(): HudInput {
  const profile = circuit();
  return {
    profile,
    state: atStartLine(profile),
    cadence: { value: 88, live: true },
    heartRate: { value: 152, live: true },
  };
}

function fieldNamed(input: HudInput, key: string): ReturnType<typeof hudReadings>[number] {
  const found = hudReadings(input).find((reading) => reading.key === key);
  if (found === undefined) {
    throw new Error(`no field ${key}`);
  }
  return found;
}

describe('a dropped sensor is not a zero reading', () => {
  it('shows a real zero as a number when the link is up', () => {
    const input = baseInput();
    const freewheeling: HudInput = {
      ...input,
      state: { ...input.state, input: { power: watts(0), live: true } },
    };

    const power = fieldNamed(freewheeling, 'power');

    expect(power.value).toBe('0');
    expect(power.stale).toBe(false);
  });

  it('shows a dropped sensor as a dash, never as a number', () => {
    const input = baseInput();
    const dropped: HudInput = {
      ...input,
      state: { ...input.state, input: { power: watts(0), live: false } },
    };

    const power = fieldNamed(dropped, 'power');

    expect(power.value).toBe(NO_READING);
    expect(power.stale).toBe(true);
  });

  it('renders the two differently — the criterion, stated directly', () => {
    const input = baseInput();
    const zero = fieldNamed(
      { ...input, state: { ...input.state, input: { power: watts(0), live: true } } },
      'power',
    );
    const lost = fieldNamed(
      { ...input, state: { ...input.state, input: { power: watts(0), live: false } } },
      'power',
    );

    expect(zero.value).not.toBe(lost.value);
    expect(zero.stale).not.toBe(lost.stale);
  });

  it('suppresses a stale sensor’s last known number rather than showing it', () => {
    // The dangerous case: the link dropped while the rider was at 250 W. Showing
    // 250 W is a claim we cannot support and is exactly what a rider paces off.
    const input = baseInput();
    const stale: HudInput = {
      ...input,
      state: { ...input.state, input: { power: watts(250), live: false } },
    };

    expect(fieldNamed(stale, 'power').value).toBe(NO_READING);
  });

  it('applies the same rule to cadence and heart rate', () => {
    const input: HudInput = {
      ...baseInput(),
      cadence: { value: 90, live: false },
      heartRate: { value: undefined, live: true },
    };

    expect(fieldNamed(input, 'cadence').value).toBe(NO_READING);
    expect(fieldNamed(input, 'cadence').stale).toBe(true);
    // A live strap that has not reported yet is not a dropped one: no number,
    // but nothing lost either.
    expect(fieldNamed(input, 'heartRate').value).toBe(NO_READING);
    expect(fieldNamed(input, 'heartRate').stale).toBe(false);
  });

  it('never marks a simulated value stale, because computation cannot drop out', () => {
    const input = baseInput();
    const dropped: HudInput = {
      ...input,
      state: { ...input.state, input: { power: watts(0), live: false } },
    };

    for (const key of ['speed', 'gradient', 'remaining']) {
      expect(fieldNamed(dropped, key).stale).toBe(false);
    }
  });
});

describe('the fields stay where the rider left them', () => {
  it('returns the same fields in the same order whatever is available', () => {
    const everything = hudReadings(baseInput()).map((reading) => reading.key);
    const nothing = hudReadings({
      ...baseInput(),
      cadence: { value: undefined, live: false },
      heartRate: { value: undefined, live: false },
    }).map((reading) => reading.key);

    expect(nothing).toEqual(everything);
  });

  it('keeps a field with nothing to show rather than removing it', () => {
    // Removing it would move every field after it — which is how a rider ends up
    // reading labels at threshold.
    const readings = hudReadings({
      ...baseInput(),
      cadence: { value: undefined, live: false },
    });

    expect(readings.some((reading) => reading.key === 'cadence')).toBe(true);
  });
});

describe('the HUD shows the simulation’s numbers and not its own', () => {
  it('takes distance remaining from the state’s own odometer', () => {
    const input = baseInput();
    const along: HudInput = {
      ...input,
      state: { ...input.state, ride: { speed: metresPerSecond(0), distance: metres(400) } },
    };

    const total: number = input.profile.totalDistance;
    const expected = ((total - 400) / 1000).toFixed(2);
    expect(fieldNamed(along, 'remaining').value).toBe(expected);
  });

  it('counts down to the end of the lap on a loop, rather than sticking at zero — #296', () => {
    // ⚠️ **The same defect #287 fixed one field over, found by building the
    // first route a rider could actually make into a loop.** `To go` was
    // `max(0, totalDistance - odometer)`, and a rider's odometer keeps counting
    // past `totalDistance` while a loop's geometry wraps — so from the first
    // crossing of the line this field read `0.00` for the rest of the ride,
    // beside an elevation strip that was sweeping round again. Nothing caught
    // it because no route in the product was ever a loop.
    const input = loopInput();
    const total: number = input.profile.totalDistance;
    const secondLap: HudInput = {
      ...input,
      state: {
        ...input.state,
        ride: { speed: metresPerSecond(8), distance: metres(total + 100) },
      },
    };

    expect(fieldNamed(secondLap, 'remaining').value).toBe(((total - 100) / 1000).toFixed(2));
  });

  it('still counts down to the finish on a route that is not a loop', () => {
    // The other half: a point-to-point route really does end, and a rider who
    // has ridden past its end has finished. `distanceOnRoute` clamps there, so
    // one expression serves both and there is no second rule to drift.
    const input = baseInput();
    const total: number = input.profile.totalDistance;
    const past: HudInput = {
      ...input,
      state: { ...input.state, ride: { speed: metresPerSecond(0), distance: metres(total + 500) } },
    };

    expect(fieldNamed(past, 'remaining').value).toBe('0.00');
  });

  it('converts speed without recomputing it', () => {
    const input = baseInput();
    const moving: HudInput = {
      ...input,
      state: { ...input.state, ride: { speed: metresPerSecond(10), distance: metres(0) } },
    };

    expect(fieldNamed(moving, 'speed').value).toBe('36.0');
  });

  it('puts the position marker exactly where the odometer is', () => {
    const input = baseInput();
    const total: number = input.profile.totalDistance;
    const halfway: HudInput = {
      ...input,
      state: { ...input.state, ride: { speed: metresPerSecond(0), distance: metres(total / 2) } },
    };

    expect(profileReading(halfway.state, halfway.profile).position).toBeCloseTo(0.5, 6);
  });

  it('still reads the whole thing complete past the end of a route that is not a loop', () => {
    // #287's second criterion. Past the end of a point-to-point route the rider
    // HAS finished, and the clamp is the honest answer there — which is why the
    // wrap below is conditional on `profile.loop` rather than unconditional.
    const input = baseInput();
    const total: number = input.profile.totalDistance;
    const past: HudInput = {
      ...input,
      state: { ...input.state, ride: { speed: metresPerSecond(0), distance: metres(total * 3) } },
    };

    const reading = profileReading(past.state, past.profile);

    expect(past.profile.loop).toBe(false);
    expect(reading.position).toBe(1);
    expect(reading.text).toBe('100% complete');
    expect(reading.label).toBe('Route profile, 100 per cent complete');
  });

  it('wraps rather than reading 100% complete for the whole of lap two', () => {
    // #287's first criterion, and the defect itself: the clamped fraction pinned
    // this at 1 from the first crossing of the line to the end of the ride.
    const input = loopInput();
    const total: number = input.profile.totalDistance;
    const lapTwo: HudInput = {
      ...input,
      state: {
        ...input.state,
        ride: { speed: metresPerSecond(8), distance: metres(total * 1.25) },
      },
    };

    const reading = profileReading(lapTwo.state, lapTwo.profile);

    expect(reading.position).toBeCloseTo(0.25, 6);
    expect(reading.text).toBe('25% of lap 2');
    expect(reading.label).toBe('Route profile, 25 per cent of lap 2');
    expect(reading.text).not.toContain('complete');
  });

  it('is in the same place a quarter of the way round on every lap', () => {
    // The stronger form of the criterion above: not merely "less than 1" on lap
    // two, but the SAME reading the rider saw at the same point of lap one. A
    // fraction that decayed, or one that counted the whole ride against a
    // growing total, would satisfy "not 100 %" and still be wrong.
    const input = loopInput();
    const total: number = input.profile.totalDistance;
    const at = (distance: number): ReturnType<typeof profileReading> =>
      profileReading(
        { ...input.state, ride: { speed: metresPerSecond(8), distance: metres(distance) } },
        input.profile,
      );

    expect(at(total * 3.25).position).toBeCloseTo(at(total * 0.25).position, 6);
    expect(at(total * 3.25).text).toBe('25% of lap 4');
    expect(at(total * 0.25).text).toBe('25% of lap 1');
  });

  it('says the same thing in the picture and in the sentence, from one value', () => {
    // #94's third criterion, widened by #287's third: the marker's fraction, the
    // sentence beside it and the picture's accessible name are one value
    // formatted three times, so none of them can drift from the other two.
    const input = loopInput();
    const total: number = input.profile.totalDistance;

    for (const fraction of [0, 0.37, 0.99, 1, 1.6, 2.5]) {
      const reading = profileReading(
        { ...input.state, ride: { speed: metresPerSecond(8), distance: metres(total * fraction) } },
        input.profile,
      );
      const percent = String(Math.round(reading.position * 100));

      expect(reading.text.startsWith(`${percent}%`)).toBe(true);
      expect(reading.label.startsWith(`Route profile, ${percent} per cent`)).toBe(true);
    }
  });

  it('reads nothing at all off a route with no length', () => {
    const input = baseInput();
    const empty = { ...input.profile, totalDistance: metres(0) };
    const state = { ...input.state, ride: { speed: metresPerSecond(0), distance: metres(500) } };

    expect(profileReading(state, empty).position).toBe(0);
    expect(profileReading(state, empty).text).toBe('0% complete');
  });
});

describe('the gap to whatever the rider is chasing', () => {
  it('names the ghost differently from the pacer', () => {
    const input = baseInput();
    const behind = pacerGap({
      botDistance: metres(200),
      riderDistance: metres(100),
      referenceSpeed: metresPerSecond(10),
    });

    expect(fieldNamed({ ...input, chases: [{ to: 'bot', gap: behind }] }, 'gap-bot').label).toBe(
      'Pacer',
    );
    expect(
      fieldNamed({ ...input, chases: [{ to: 'ghost', gap: behind }] }, 'gap-ghost').label,
    ).toBe('Your best');
  });

  it('says the PACER is ahead when the pacer is ahead (#255)', () => {
    // ⚠️ The whole of #255's first defect. The sign in `pacer/gap.ts` is
    // positive when the BOT is ahead, and this field used to render that as the
    // word `behind` — true of the rider, and read under a label that names the
    // pacer. "Pacer — 12 s behind" reads most naturally as *the pacer is 12 s
    // behind you*, which is the opposite of what it means.
    const input = baseInput();
    const pacerInFront = pacerGap({
      botDistance: metres(200),
      riderDistance: metres(100),
      referenceSpeed: metresPerSecond(10),
    });

    const field = fieldNamed({ ...input, chases: [{ to: 'bot', gap: pacerInFront }] }, 'gap-bot');

    expect(field.value).toBe('10');
    expect(field.unit).toBe('s');
    expect(field.detail).toBe('ahead of you');
  });

  it('says the pacer is behind when the RIDER is ahead (#255)', () => {
    const input = baseInput();
    const riderInFront = pacerGap({
      botDistance: metres(100),
      riderDistance: metres(200),
      referenceSpeed: metresPerSecond(10),
    });

    const field = fieldNamed({ ...input, chases: [{ to: 'bot', gap: riderInFront }] }, 'gap-bot');

    expect(field.value).toBe('10');
    expect(field.unit).toBe('s');
    expect(field.detail).toBe('behind you');
  });

  it('carries the direction in a word rather than in a minus sign', () => {
    // A minus sign is one glyph wide at arm's length and is the first thing lost.
    const input = baseInput();
    const riderInFront = pacerGap({
      botDistance: metres(100),
      riderDistance: metres(200),
      referenceSpeed: metresPerSecond(10),
    });

    const field = fieldNamed({ ...input, chases: [{ to: 'bot', gap: riderInFront }] }, 'gap-bot');

    expect(`${field.value} ${field.unit} ${field.detail ?? ''}`).not.toContain('-');
  });

  it('reads level rather than nought seconds in some direction', () => {
    // ⚠️ Whichever side of level a sub-second gap falls, it rounds to `0` — and
    // "0 s ahead of you" is a direction claim the number does not support.
    // `pacer/gap.ts` §`botIsAhead` makes the same argument: level is the honest
    // answer and is not `behind`.
    const input = baseInput();
    const barelyAhead = pacerGap({
      botDistance: metres(104),
      riderDistance: metres(100),
      referenceSpeed: metresPerSecond(10),
    });
    const barelyBehind = pacerGap({
      botDistance: metres(96),
      riderDistance: metres(100),
      referenceSpeed: metresPerSecond(10),
    });

    for (const gap of [barelyAhead, barelyBehind]) {
      const field = fieldNamed({ ...input, chases: [{ to: 'bot', gap }] }, 'gap-bot');
      expect(field.value).toBe('Level');
      expect(field.unit).toBe('');
      expect(field.detail).toBeUndefined();
    }
  });

  it('shows a dash rather than a nought for a stationary rider', () => {
    const input = baseInput();
    const stopped = pacerGap({
      botDistance: metres(200),
      riderDistance: metres(100),
      referenceSpeed: metresPerSecond(0),
    });

    expect(fieldNamed({ ...input, chases: [{ to: 'bot', gap: stopped }] }, 'gap-bot').value).toBe(
      NO_READING,
    );
  });

  it('gives the pacer and the ghost a field each when the rider chose both (#253)', () => {
    // ⚠️ The second half of #253. `withGhost` and `withPacer` are independent
    // choices on the route picker, so a rider may make both — and the HUD had
    // one gap slot, which resolved to the bot. The ghost's gap was computed
    // nowhere and shown nowhere.
    const input = baseInput();
    const pacerAhead = pacerGap({
      botDistance: metres(200),
      riderDistance: metres(100),
      referenceSpeed: metresPerSecond(10),
    });
    const ghostBehind = pacerGap({
      botDistance: metres(50),
      riderDistance: metres(100),
      referenceSpeed: metresPerSecond(10),
    });

    const both: HudInput = {
      ...input,
      chases: [
        { to: 'bot', gap: pacerAhead },
        { to: 'ghost', gap: ghostBehind },
      ],
    };

    expect(fieldNamed(both, 'gap-bot').label).toBe('Pacer');
    expect(fieldNamed(both, 'gap-bot').detail).toBe('ahead of you');
    expect(fieldNamed(both, 'gap-ghost').label).toBe('Your best');
    expect(fieldNamed(both, 'gap-ghost').detail).toBe('behind you');
    // Each is its own number, rather than one gap under two labels.
    expect(fieldNamed(both, 'gap-bot').value).not.toBe(fieldNamed(both, 'gap-ghost').value);
  });

  it('shows one dashed field, under the pacer’s label, when nothing is chased', () => {
    // The field is still there: #94's fixed order means an unavailable reading
    // is dashed rather than removed, so nothing after it moves.
    const field = fieldNamed(baseInput(), 'gap');

    expect(field.label).toBe('Pacer');
    expect(field.value).toBe(NO_READING);
  });

  /**
   * #259 — the field once the race against the attempt is settled.
   *
   * ⚠️ Every case below hands the formatter the *same* gap and varies only
   * `outcome`, which is the property that matters: the result is carried in
   * rather than re-derived from a number that goes on changing. A formatter
   * that read the sign of the gap instead would give all three of these the
   * same answer.
   */
  describe('once the race against it is settled', () => {
    const stillAhead = pacerGap({
      botDistance: metres(200),
      riderDistance: metres(100),
      referenceSpeed: metresPerSecond(10),
    });

    it('says the rider beat it, rather than quoting a gap to a stopped rider', () => {
      const field = fieldNamed(
        { ...baseInput(), chases: [{ to: 'ghost', gap: stillAhead, outcome: 'beaten' }] },
        'gap-ghost',
      );

      expect(field.value).toBe('Beaten');
      expect(field.detail).toBe('by you');
      expect(field.unit).toBe('');
    });

    it('reads differently for a rider who did not beat it', () => {
      const field = fieldNamed(
        { ...baseInput(), chases: [{ to: 'ghost', gap: stillAhead, outcome: 'not-beaten' }] },
        'gap-ghost',
      );

      expect(field.value).toBe('Finished');
      expect(field.detail).toBe('ahead of you');
    });

    it('says matched on a dead heat', () => {
      const field = fieldNamed(
        { ...baseInput(), chases: [{ to: 'ghost', gap: stillAhead, outcome: 'level' }] },
        'gap-ghost',
      );

      expect(field.value).toBe('Matched');
      expect(field.detail).toBe('by you');
    });

    it('still reports the result for a rider who has stopped pedalling', () => {
      // A standstill makes the *gap* unknowable — `pacer/gap.ts` returns
      // `undefined` seconds rather than divide by zero — and the result is not
      // a gap. Dashing it here would hide something that is known.
      const stationary = pacerGap({
        botDistance: metres(200),
        riderDistance: metres(100),
        referenceSpeed: metresPerSecond(0),
      });

      const field = fieldNamed(
        { ...baseInput(), chases: [{ to: 'ghost', gap: stationary, outcome: 'beaten' }] },
        'gap-ghost',
      );

      expect(field.value).toBe('Beaten');
      expect(field.value).not.toBe(NO_READING);
    });

    it.each([
      ['beaten', 'Beaten', 'by you, with its draft'],
      ['level', 'Matched', 'by you, with its draft'],
      ['not-beaten', 'Finished', 'ahead of you, with its draft'],
    ] as const)(
      'says “with its draft” in words after a drafted %s attempt — #2425, ADR 0066 D-5.1',
      (outcome, value, detail) => {
        const field = fieldNamed(
          {
            ...baseInput(),
            chases: [{ to: 'ghost', gap: stillAhead, outcome, drafted: true }],
          },
          'gap-ghost',
        );
        expect(field.value).toBe(value);
        expect(field.detail).toBe(detail);
        // Not drafted reads exactly as before.
        const undrafted = fieldNamed(
          { ...baseInput(), chases: [{ to: 'ghost', gap: stillAhead, outcome, drafted: false }] },
          'gap-ghost',
        );
        expect(undrafted.detail).toBe(detail.replace(', with its draft', ''));
      },
    );

    it('leaves a live gap alone', () => {
      const field = fieldNamed(
        { ...baseInput(), chases: [{ to: 'ghost', gap: stillAhead }] },
        'gap-ghost',
      );

      expect(field.value).toBe('10');
      expect(field.detail).toBe('ahead of you');
    });

    /**
     * ⚠️ A **layout** flag, asserted in a test about formatting, because this
     * is the only place that produces it. `fields.ts` §`HudReading.word` is the
     * measurement: 2.5 rem inside a `minmax(7rem, 1fr)` grid track fits about
     * five characters, a single word cannot wrap, and all three of these are
     * longer than that. `HudPanel.test.tsx` is the other half — that the flag
     * reaches the element.
     */
    it.each(['beaten', 'level', 'not-beaten'] as const)(
      'marks the settled value (%s) as a word rather than a magnitude',
      (outcome) => {
        const field = fieldNamed(
          { ...baseInput(), chases: [{ to: 'ghost', gap: stillAhead, outcome }] },
          'gap-ghost',
        );

        expect(field.word).toBe(true);
        // The word is longer than the track fits at the size a number is set
        // in, which is the whole reason the flag exists. A shorter one would
        // not need it and this assertion says which case is which.
        expect(field.value.length).toBeGreaterThan(5);
      },
    );

    it('does not mark a number, a dash or a live gap', () => {
      const input = baseInput();
      const live = fieldNamed(
        { ...input, chases: [{ to: 'ghost', gap: stillAhead }] },
        'gap-ghost',
      );
      expect(live.word).toBeUndefined();
      expect(hudReadings(input).every((reading) => reading.word === undefined)).toBe(true);
    });
  });

  it('builds its gap input from the rider’s own state', () => {
    const input = baseInput();
    const state = {
      ...input.state,
      ride: { speed: metresPerSecond(8), distance: metres(150) },
      elapsed: seconds(30),
    };

    const built = gapAgainst(state, 220);

    expect(built.riderDistance).toBe(150);
    expect(built.referenceSpeed).toBe(8);
    expect(built.botDistance).toBe(220);
  });
});

/** A straight road north, `kilometres` long, for a countdown past 100 — #2130. */
function longInput(kilometres: number): HudInput {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= kilometres; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(10 + (index * 1000) / 111_320),
        degreesLongitude(0),
      ),
      elevation: altitudeMetres(10),
    });
  }
  const profile = routeProfile(points);
  return {
    profile,
    state: atStartLine(profile),
    cadence: { value: 88, live: true },
    heartRate: { value: 152, live: true },
  };
}

/** `To go` with `left` metres still to ride on `input`'s route. */
function toGoWith(input: HudInput, left: number, units: HudInput['units'] = 'metric') {
  const total: number = input.profile.totalDistance;
  return fieldNamed(
    {
      ...input,
      units,
      state: {
        ...input.state,
        ride: { speed: metresPerSecond(0), distance: metres(total - left) },
      },
    },
    'remaining',
  );
}

describe('a long countdown drops to one decimal from 100 — #2130', () => {
  // The owner's ruling of 2026-11-06: `139.82 km` filled its track on every
  // tablet and `km` wrapped under it. From 100 km (or 100 mi) to go the
  // countdown is one decimal, so it is never wider than `99.99`.
  const long = longInput(340);

  it('keeps two decimals at 99.99 km', () => {
    expect(toGoWith(long, 99_990).value).toBe('99.99');
  });

  it('shows one decimal at 100.0 km', () => {
    expect(toGoWith(long, 100_000).value).toBe('100.0');
  });

  it('shows one decimal at 199.9 km', () => {
    expect(toGoWith(long, 199_900).value).toBe('199.9');
  });

  it('never shows 100.00: 99.996 km rounds into the one-decimal range', () => {
    expect(toGoWith(long, 99_996).value).toBe('100.0');
  });

  it('is the same rule in miles: 99.99 mi, 100.0 mi and 199.9 mi', () => {
    const mile = 1609.344;
    expect(toGoWith(long, 99.99 * mile, 'imperial').value).toBe('99.99');
    expect(toGoWith(long, 100 * mile, 'imperial').value).toBe('100.0');
    expect(toGoWith(long, 199.9 * mile, 'imperial')).toMatchObject({ value: '199.9', unit: 'mi' });
  });
});

describe('the HUD follows the rider\u2019s units (#238)', () => {
  // ⚠️ This is the screen the issue is named for. It converted and labelled
  // inline — `(state.ride.speed as number) * 3.6, 'km/h'` and
  // `remaining / 1000, 'km'` — so a preference wired only into `format.ts`'s
  // constants would have changed most of the product and left the one screen a
  // rider stares at for an hour unchanged.

  function riding(units: HudInput['units']): HudInput {
    const input = baseInput();
    return {
      ...input,
      units,
      state: { ...input.state, ride: { speed: metresPerSecond(10), distance: metres(400) } },
    };
  }

  it('reads speed in mph, digits and label together', () => {
    const speed = fieldNamed(riding('imperial'), 'speed');
    expect(speed.value).toBe('22.4');
    expect(speed.unit).toBe('mph');
  });

  it('reads distance still to go in miles', () => {
    const input = riding('imperial');
    const total: number = input.profile.totalDistance;
    const togo = fieldNamed(input, 'remaining');

    expect(togo.unit).toBe('mi');
    expect(togo.value).toBe(((total - 400) / 1609.344).toFixed(2));
  });

  it('is metric when nothing says otherwise, which is what a caller with no preference gets', () => {
    const speed = fieldNamed(riding(undefined), 'speed');
    expect(speed.value).toBe('36.0');
    expect(speed.unit).toBe('km/h');
  });

  it('changes the number as well as the label', () => {
    // The cheapest wrong implementation relabels without converting. It would
    // pass a test that asserted `unit` alone.
    expect(fieldNamed(riding('imperial'), 'speed').value).not.toBe(
      fieldNamed(riding('metric'), 'speed').value,
    );
    expect(fieldNamed(riding('imperial'), 'remaining').value).not.toBe(
      fieldNamed(riding('metric'), 'remaining').value,
    );
  });

  it('leaves cadence, heart rate, power and gradient alone in both systems', () => {
    for (const key of ['cadence', 'heartRate', 'power', 'gradient']) {
      expect(fieldNamed(riding('imperial'), key)).toEqual(fieldNamed(riding('metric'), key));
    }
  });

  it('keeps the gap in seconds, which is not a unit a rider chooses', () => {
    const input = riding('imperial');
    const withGap: HudInput = {
      ...input,
      chases: [
        {
          to: 'bot',
          gap: pacerGap({
            botDistance: metres(500),
            riderDistance: metres(400),
            referenceSpeed: metresPerSecond(10),
          }),
        },
      ],
    };

    // The magnitude and its unit, unconverted: a gap is a time, and a rider who
    // reads miles does not read a different second.
    expect(fieldNamed(withGap, 'gap-bot').unit).toBe('s');
    expect(fieldNamed(withGap, 'gap-bot').value).toBe('10');
  });
});

/**
 * #335 — the wind, on the screen a rider is actually looking at.
 *
 * `game/wind.test.ts` proves the simulation carries the number out. This is
 * the other half: what a rider is shown, and — the criterion that is easiest
 * to get wrong — what a rider who set **no** wind is shown, which is nothing
 * at all rather than a nought.
 */
describe('what the wind is doing to the rider (#335)', () => {
  /** A ride mid-route, with whatever headwind the simulation is reporting. */
  function riding(headwind: number | undefined, units?: HudInput['units']): HudInput {
    const input = baseInput();
    return {
      ...input,
      ...(units === undefined ? {} : { units }),
      state: {
        ...input.state,
        ride: { speed: metresPerSecond(10), distance: metres(400) },
        ...(headwind === undefined ? {} : { headwindMetresPerSecond: headwind }),
      },
    };
  }

  function windField(headwind: number | undefined, units?: HudInput['units']) {
    return hudReadings(riding(headwind, units)).find((reading) => reading.key === 'wind');
  }

  it('shows nothing at all for a ride in still air', () => {
    // ⚠️ The criterion in its literal form. Not a dash and not a zero: a dash
    // is what a dropped sensor gets and a zero is what a crosswind gets, and
    // "no wind was set" is neither of those.
    expect(windField(undefined)).toBeUndefined();
    expect(hudReadings(riding(undefined)).some((reading) => reading.value === NO_READING)).toBe(
      true,
    );
  });

  it('shows a headwind as a magnitude and the word for it', () => {
    const wind = windField(6);

    // 6 m/s is 21.6 km/h. Whole units: the rider typed a round number and a
    // cosine happened to it, so the tenth is a digit nobody chose.
    expect(wind?.value).toBe('22');
    expect(wind?.unit).toBe('km/h');
    expect(wind?.detail).toBe('headwind');
    expect(wind?.stale).toBe(false);
  });

  it('shows a tailwind with the same magnitude and a different word', () => {
    const tail = windField(-6);

    // ⚠️ The sign is in the word rather than in a minus glyph — `gapReading`'s
    // rule, for its reason: a minus sign is one glyph wide at arm's length and
    // is the first thing lost.
    expect(tail?.value).toBe('22');
    expect(tail?.value).not.toContain('-');
    expect(tail?.detail).toBe('tailwind');
  });

  it('calls a wind whose component rounds to nothing a crosswind, not a headwind', () => {
    // A westerly on a northward road. `0 km/h headwind` would claim a
    // direction the digits do not support while the true one could be either —
    // the argument `gapReading`'s `LEVEL` branch makes about a gap.
    const across = windField(0.02);

    expect(across?.value).toBe('0');
    expect(across?.detail).toBe('crosswind');
  });

  it('judges that on the DISPLAYED magnitude rather than on an exact zero', () => {
    // The cheap implementation compares the headwind to 0 and calls anything
    // else a headwind, which puts `0 km/h headwind` on the screen for every
    // heading within a couple of degrees of square to the wind.
    expect(windField(0.0001)?.detail).toBe('crosswind');
    expect(windField(-0.0001)?.detail).toBe('crosswind');
    // And a component that survives the rounding is still named.
    expect(windField(0.2)?.detail).toBe('headwind');
  });

  it('reads the simulation’s own number rather than resolving the wind itself', () => {
    // #94's fourth criterion. The profile is in `HudInput` and `headwindOnRoute`
    // is one import away, so the separately-computed value is reachable — this
    // is a headwind no route and no wind in this file could produce, and the
    // field shows it.
    expect(windField(11.11)?.value).toBe('40');
  });

  it('is in the rider’s own units, digits and label together', () => {
    const imperial = windField(6, 'imperial');

    // 6 m/s is 13.4 mph. The label alone would pass a relabel-without-convert.
    expect(imperial?.value).toBe('13');
    expect(imperial?.unit).toBe('mph');
    expect(imperial?.value).not.toBe(windField(6, 'metric')?.value);
  });

  it('comes last, so a ride with a wind agrees with one without about every other field', () => {
    // ⚠️ #94's fixed order. The wind is the one field whose presence depends on
    // a choice, so it goes after the gaps and every other field keeps the index
    // it has always had.
    const still = hudReadings(riding(undefined)).map((reading) => reading.key);
    const windy = hudReadings(riding(6)).map((reading) => reading.key);

    expect(windy).toEqual([...still, 'wind']);
  });
});

describe('the trainer status line — #373', () => {
  it('carries a running workout’s heart-rate hold in the trainer line’s place — #1240', () => {
    expect(trainerLine({ hold: 'Hold 130–140 bpm: 160 W' })).toBe('Hold 130–140 bpm: 160 W');
  });

  it('says simulating, with the gradient to a tenth and the write count', () => {
    expect(trainerLine({ gradePercent: -3.42, writes: 17 })).toBe(
      'Trainer: simulating -3.4% (17 sent)',
    );
  });

  /**
   * ⚠️ **The count is the half that catches #362**, where a gradient was
   * computed and never sent. A line that dropped it would read as evidence of
   * something that had not happened.
   */
  it('keeps a zero count visible rather than tidying it away', () => {
    expect(trainerLine({ gradePercent: 4, writes: 0 })).toContain('(0 sent)');
  });

  /**
   * `simulating`, never `holding`. `game/gradient.ts`
   * §`GradientSessionState.asked` is explicit that the two are different
   * claims: the write resolves on the machine's indication, so a screen saying
   * "holding" would be about a second ahead of the trainer.
   */
  it('does not claim the trainer is holding the gradient', () => {
    expect(trainerLine({ gradePercent: 7.5, writes: 3 })).not.toContain('olding');
  });

  /**
   * #1120. Without anchor positioning the upright layout gives up 7 rem of the
   * trainer line's width (`theme.css` §"#1111 UPRIGHT, WITHOUT ANCHOR
   * POSITIONING"), so at 360 px the line has 214 px of the actions panel's 326,
   * and its 6–7 px margin over the leaning rider (360×752, sounds and a side
   * camera, the CI runner's fonts) rests on the line wrapping to TWO lines: a
   * third puts the actions panel about 19 px into the rider's box.
   *
   * ⚠️ **An estimate, not a measurement** — no Vitest suite here lays out text.
   * The width per character is the one the CI runner measured for
   * `Trainer: simulating 0.9% (1 sent)`, 262 px over 33 characters, and the
   * wrap is greedy at word boundaries as a browser's is. The browser gate
   * (`ride.browser.spec.ts`, `withoutAnchors`) is the measurement; this is what
   * fails on save when somebody lengthens the sentence.
   *
   * The longest sentence is the steepest grade a trainer is sent, negative, and
   * 99 999 writes — over 27 hours at one write a second.
   */
  it('wraps to at most two lines in the space the upright layout leaves it without anchors — #1120', () => {
    const PIXELS_PER_CHARACTER = 262 / 33;
    const LINE_PIXELS = 326 - 7 * 16;
    const MOST_WRITES = 99_999;
    expect(MOST_WRITES * SIMULATION_SETPOINT_INTERVAL_SECONDS).toBeGreaterThan(24 * 60 * 60);

    const longest = trainerLine({
      gradePercent: -MAX_SIMULATED_GRADE_PERCENT,
      writes: MOST_WRITES,
    });
    const lines: string[] = [];
    for (const word of longest.split(' ')) {
      const last = lines.at(-1);
      const joined = last === undefined ? word : `${last} ${word}`;
      if (last !== undefined && joined.length * PIXELS_PER_CHARACTER <= LINE_PIXELS) {
        lines[lines.length - 1] = joined;
      } else {
        lines.push(word);
      }
    }

    expect(longest.length * PIXELS_PER_CHARACTER).toBeLessThan(2 * LINE_PIXELS);
    expect(lines.length).toBeLessThanOrEqual(2);
  });
});

/**
 * #423 — the HUD is a hierarchy. `fields.ts` §`ReadingTier` records the
 * decision; this pins the three properties of it that something else rests on.
 */
describe('which readings are drawn large (#423)', () => {
  /** A ride with every optional field present: two gaps and a wind. */
  function everyField(): HudInput {
    const base = baseInput();
    const gap = pacerGap({
      botDistance: metres(200),
      riderDistance: metres(100),
      referenceSpeed: metresPerSecond(10),
    });
    return {
      ...base,
      state: { ...base.state, headwindMetresPerSecond: metresPerSecond(4) },
      chases: [
        { to: 'bot', gap },
        { to: 'ghost', gap },
      ],
    };
  }

  it('draws power, cadence, heart rate and — since #2071 — the gradient large, and nothing else', () => {
    const tiers = hudReadings(everyField()).map((each) => [each.key, readingTier(each)]);

    expect(tiers.filter(([, tier]) => tier === 'primary').map(([key]) => key)).toEqual([
      'power',
      'cadence',
      'heartRate',
      // #2071: the owner's "the grade is hard to see". @see ReadingTier
      'gradient',
    ]);
    // Non-vacuity: the fixture really does carry the fields a secondary tier
    // would be wrong about — both gaps and the wind.
    expect(tiers.filter(([, tier]) => tier === 'secondary').map(([key]) => key)).toEqual([
      'speed',
      'remaining',
      // #1111: secondary, beside the distance to go. @see ReadingTier
      'movingTime',
      // #2072: and the elapsed time beside it (this ride has no clock).
      'elapsedTime',
      // #2076: the ride so far, after the times and before every gap.
      'distance',
      'climbed',
      'averagePower',
      // #2434: and the calorie estimate, the ride so far's last.
      'calories',
      // #2077: the rider's W/kg (this ride has no threshold, so no zone).
      'wattsPerKilogram',
      'gap-bot',
      'gap-ghost',
      'wind',
    ]);
  });

  it('keeps the primary readings first, so splitting the list moves nothing', () => {
    // ⚠️ `HudPanel` renders the two tiers as two lists. That is only a
    // re-grouping — and #94's *"found by position"* only survives it — while
    // every primary reading precedes every secondary one in the order
    // `hudReadings` already returns. A primary key added further down the list
    // would silently reorder the screen.
    const tiers = hudReadings(everyField()).map(readingTier);
    const firstSecondary = tiers.indexOf('secondary');

    expect(firstSecondary).toBeGreaterThan(0);
    expect(tiers.slice(firstSecondary)).not.toContain('primary');
  });

  it('draws a field nobody has classified small', () => {
    // The cheap direction to be wrong in: a secondary reading costs the road
    // less than a primary one does.
    expect(
      readingTier({ key: 'something-new', label: 'New', value: '1', unit: '', stale: false }),
    ).toBe('secondary');
  });
});

describe('the room on the HUD — #783', () => {
  const chosen = (seconds: number, wattsPerKilogram?: number) => {
    const start = atStartLine(route());
    const moving = {
      ...start,
      ride: { ...start.ride, distance: metres(100), speed: metresPerSecond(10) },
    };
    return {
      label: 'Rider 4',
      gap: pacerGap(gapAgainst(moving, 100 + seconds * 10)),
      ...(wattsPerKilogram === undefined ? {} : { wattsPerKilogram }),
    };
  };

  it('adds nothing to a ride with no room, so every field keeps its place', () => {
    expect(hudReadings(baseInput()).map((reading) => reading.key)).not.toContain('room-nearby');
  });

  it('shows a count near and the gap to ONE chosen rider, after the gaps and before the wind', () => {
    const readings = hudReadings({ ...baseInput(), room: { nearby: 3, chosen: chosen(12) } });
    const keys = readings.map((reading) => reading.key);
    expect(keys.indexOf('room-rider')).toBe(keys.indexOf('gap') + 1);
    expect(readings.find((r) => r.key === 'room-nearby')).toMatchObject({
      label: 'Nearby',
      value: '3',
      unit: 'riders',
    });
    expect(readings.find((r) => r.key === 'room-rider')).toMatchObject({
      label: 'Rider 4',
      value: '12',
      unit: 's',
      detail: 'ahead of you',
    });
  });

  it('shows a dash until the rider chooses somebody to follow', () => {
    const readings = hudReadings({ ...baseInput(), room: { nearby: 0 } });
    expect(readings.find((r) => r.key === 'room-rider')).toMatchObject({
      label: 'Following',
      value: NO_READING,
    });
    expect(readings.find((r) => r.key === 'room-nearby')?.value).toBe('0');
  });

  it('puts W/kg beside another rider’s name, and never watts (ruling Q17)', () => {
    const reading = hudReadings({
      ...baseInput(),
      room: { nearby: 1, chosen: chosen(-8, 3.24) },
    }).find((r) => r.key === 'room-rider');
    expect(reading?.detail).toBe('behind you, 3.2 W/kg');
    const text = `${reading?.value ?? ''} ${reading?.unit ?? ''} ${reading?.detail ?? ''}`;
    expect(text).not.toMatch(/\d\s*W(?!\/kg)\b/);
  });

  it('shows this rider’s draft as a share of drag, Off in a room without drafting, and a dash before a frame — #787', () => {
    const draft = (value: number | 'off' | undefined) =>
      hudReadings({ ...baseInput(), room: { nearby: 1, draft: value, draftShown: true } }).find(
        (r) => r.key === 'room-draft',
      );
    expect(draft(34)).toMatchObject({ label: 'Draft', value: '34', unit: '% of drag' });
    expect(draft(0)).toMatchObject({ value: '0', unit: '% of drag' });
    expect(draft('off')).toMatchObject({ label: 'Draft', value: 'Off', unit: '', word: true });
    expect(draft(undefined)).toMatchObject({ label: 'Draft', value: NO_READING, unit: '' });
    // Never watts, in any state: a share of drag is the whole reading (ADR 0038 D-5).
    for (const each of [34, 0, 'off', undefined] as const) {
      const reading = draft(each);
      const text = `${reading?.label ?? ''} ${reading?.value ?? ''} ${reading?.unit ?? ''} ${reading?.detail ?? ''}`;
      expect(text).not.toMatch(/\bW\b|watt/i);
    }
  });

  it('has no draft on a ride with no room — absent, not 0 %', () => {
    expect(hudReadings(baseInput()).map((reading) => reading.key)).not.toContain('room-draft');
  });

  it('has no draft field in a room unless the ride says the rider’s setting shows it — ADR 0038 D-5', () => {
    const keys = (draftShown: boolean | undefined) =>
      hudReadings({
        ...baseInput(),
        room: { nearby: 1, draft: 34, ...(draftShown === undefined ? {} : { draftShown }) },
      }).map((reading) => reading.key);
    expect(keys(undefined)).not.toContain('room-draft');
    expect(keys(false)).not.toContain('room-draft');
    expect(keys(true)).toContain('room-draft');
    // The room's other fields are there either way, at the same indexes.
    expect(keys(false)).toEqual(keys(true).filter((key) => key !== 'room-draft'));
  });

  it('shows a solo ride’s draft as a room’s is drawn, rounded, where the room’s fields would be — #2425', () => {
    const solo = (percent: number) =>
      hudReadings({ ...baseInput(), soloDraft: percent }).find((r) => r.key === 'solo-draft');
    // #2425, #2130: the solo field's unit is the `%` alone, so it stays on
    // its number's line in the tier's narrowest track.
    expect(solo(33.6)).toMatchObject({ label: 'Draft', value: '34', unit: '%' });
    // #2472: and a screen reader hears what it is a share of; a room's field draws it.
    expect(solo(33.6)?.unitSaid).toBe('of drag');
    expect(solo(33.6)?.detail).toBe('at most 59 %');
    expect(solo(33.6)?.gauge).toBeCloseTo(34 / 59, 12);
    expect(solo(0)).toMatchObject({ value: '0' });
    // Absent with no solo draft handed in, and every other field where it was.
    const without = hudReadings(baseInput()).map((r) => r.key);
    const withIt = hudReadings({ ...baseInput(), soloDraft: 12 }).map((r) => r.key);
    expect(without).not.toContain('solo-draft');
    expect(withIt).not.toContain('room-draft');
    expect(withIt.filter((key) => key !== 'solo-draft')).toEqual(without);
  });

  it('gauges the draft toward the model’s most, and says that is the full scale — #327', () => {
    const draft = (value: number | 'off' | undefined) =>
      hudReadings({ ...baseInput(), room: { nearby: 1, draft: value, draftShown: true } }).find(
        (r) => r.key === 'room-draft',
      );
    expect(DRAFT_FULL_SCALE_PERCENT).toBe(59);
    expect(draft(34)?.detail).toBe('at most 59 %');
    expect(draft(34)?.gauge).toBeCloseTo(34 / 59, 12);
    expect(draft(0)?.gauge).toBe(0);
    // At the model's most the bar is full, and past it (it cannot be) never overfull.
    expect(draft(59)?.gauge).toBe(1);
    expect(draft(80)?.gauge).toBe(1);
    // No gauge where there is nothing to measure.
    expect(draft('off')?.gauge).toBeUndefined();
    expect(draft(undefined)?.gauge).toBeUndefined();
    // …and no other field carries one.
    const others = hudReadings({
      ...baseInput(),
      room: { nearby: 1, draft: 34, draftShown: true },
    }).filter((r) => r.key !== 'room-draft');
    expect(others.every((r) => r.gauge === undefined)).toBe(true);
  });
});

describe('the ride’s moving time — #1111', () => {
  const movingTime = (input: HudInput) =>
    hudReadings(input).find((reading) => reading.key === MOVING_TIME_KEY);

  it('shows the recorder’s moving time as h:mm:ss from the first second', () => {
    expect(movingTime({ ...baseInput(), movingSeconds: 65 })).toEqual({
      key: MOVING_TIME_KEY,
      label: 'Moving',
      value: '0:01:05',
      unit: '',
      stale: false,
    });
    expect(movingTime({ ...baseInput(), movingSeconds: 3725 })?.value).toBe('1:02:05');
  });

  it('is the figure it is handed and nothing the simulation counted — no second clock', () => {
    // The simulation has been riding for ten minutes; the recorder says 65 s
    // moving (a pause, an auto-pause). The HUD quotes the recorder.
    const base = baseInput();
    const input: HudInput = {
      ...base,
      state: { ...base.state, elapsed: seconds(600) },
      movingSeconds: 65,
    };
    expect(movingTime(input)?.value).toBe('0:01:05');
  });

  it('shows a dash, and no sensor lost, where nothing is being recorded', () => {
    for (const movingSeconds of [undefined, Number.NaN]) {
      expect(movingTime({ ...baseInput(), movingSeconds })).toEqual({
        key: MOVING_TIME_KEY,
        label: 'Moving',
        value: NO_READING,
        unit: '',
        stale: false,
      });
    }
  });

  it('is set at the word size past ten hours, and at the number size up to then', () => {
    // 9:59:59 is the widest figure the layout is measured at (`theme.css`
    // never breaks a time), so it is a number; one second later it is a digit
    // wider and takes #259's smaller size.
    expect(movingTime({ ...baseInput(), movingSeconds: 35_999 })?.word).toBeUndefined();
    const ten = movingTime({ ...baseInput(), movingSeconds: 36_000 });
    expect(ten?.value).toBe('10:00:00');
    expect(ten?.word).toBe(true);
    expect(movingTime({ ...baseInput(), movingSeconds: 360_000 })?.word).toBe(true);
    expect(movingTime({ ...baseInput(), movingSeconds: undefined })?.word).toBeUndefined();
  });

  it('is always present, beside the distance to go, in the secondary tier', () => {
    const keys = hudReadings(baseInput()).map((reading) => reading.key);
    expect(keys.indexOf(MOVING_TIME_KEY)).toBe(keys.indexOf('remaining') + 1);
    const field = movingTime({ ...baseInput(), movingSeconds: 1 });
    expect(field === undefined ? undefined : readingTier(field)).toBe('secondary');
  });
});

/**
 * #2072: the elapsed time and the time of day beside the moving time.
 * `HudPanel.test.tsx` reads them off the rendered HUD and
 * `trainer-wiring.test.tsx` over the real recorder; this is the model.
 */
describe('the ride’s elapsed time and the time of day — #2072', () => {
  const field = (input: HudInput, key: string) =>
    hudReadings(input).find((reading) => reading.key === key);

  it('shows the recorder’s elapsed time as h:mm:ss, labelled Elapsed, beside Moving', () => {
    expect(field({ ...baseInput(), elapsedSeconds: 125 }, ELAPSED_TIME_KEY)).toEqual({
      key: ELAPSED_TIME_KEY,
      label: 'Elapsed',
      value: '0:02:05',
      unit: '',
      stale: false,
    });
    const keys = hudReadings(baseInput()).map((reading) => reading.key);
    expect(keys.indexOf(ELAPSED_TIME_KEY)).toBe(keys.indexOf(MOVING_TIME_KEY) + 1);
  });

  it('is its own figure, never the moving time, nor anything the simulation counted', () => {
    // A minute paused: the recorder says 65 s moving and 125 s elapsed, and
    // the simulation has been running for ten minutes.
    const base = baseInput();
    const input: HudInput = {
      ...base,
      state: { ...base.state, elapsed: seconds(600) },
      movingSeconds: 65,
      elapsedSeconds: 125,
    };
    expect(field(input, MOVING_TIME_KEY)?.value).toBe('0:01:05');
    expect(field(input, ELAPSED_TIME_KEY)?.value).toBe('0:02:05');
  });

  it('shows a dash for a figure that is not a number, and the word size past ten hours', () => {
    expect(field({ ...baseInput(), elapsedSeconds: Number.NaN }, ELAPSED_TIME_KEY)?.value).toBe(
      NO_READING,
    );
    expect(field({ ...baseInput(), elapsedSeconds: 35_999 }, ELAPSED_TIME_KEY)?.word).toBe(
      undefined,
    );
    expect(field({ ...baseInput(), elapsedSeconds: 36_000 }, ELAPSED_TIME_KEY)?.word).toBe(true);
  });

  // #2382: where nothing records, the ride's own clock — never a dash, and
  // never under the recorder's label.
  it('shows the ride’s own clock, labelled Ride, where nothing is recorded — #2382', () => {
    const base = baseInput();
    const ride: HudInput = { ...base, state: { ...base.state, elapsed: seconds(1) } };
    expect(field(ride, ELAPSED_TIME_KEY)).toEqual({
      key: ELAPSED_TIME_KEY,
      label: RIDE_CLOCK_LABEL,
      value: '0:00:01',
      unit: '',
      stale: false,
    });
    expect(RIDE_CLOCK_LABEL).not.toBe('Elapsed');
    // The moving time is never given the fallback: the recorder's, or a dash.
    expect(field(ride, MOVING_TIME_KEY)?.value).toBe(NO_READING);
    // Past ten hours, the word size, as the recorder's figure is.
    const long: HudInput = { ...base, state: { ...base.state, elapsed: seconds(36_000) } };
    expect(field(long, ELAPSED_TIME_KEY)?.word).toBe(true);
  });

  it('shows the recorder’s figure, labelled Elapsed, the moment a recording runs — #2382', () => {
    const base = baseInput();
    const input: HudInput = {
      ...base,
      state: { ...base.state, elapsed: seconds(600) },
      elapsedSeconds: 0,
    };
    expect(field(input, ELAPSED_TIME_KEY)).toMatchObject({ label: 'Elapsed', value: '0:00:00' });
  });

  it('shows the time of day it is handed as HH:MM, labelled Clock, after the elapsed time', () => {
    const input: HudInput = { ...baseInput(), timeOfDay: new Date(2026, 10, 4, 7, 5, 59) };
    expect(field(input, CLOCK_KEY)).toEqual({
      key: CLOCK_KEY,
      label: 'Clock',
      value: '07:05',
      unit: '',
      stale: false,
    });
    const keys = hudReadings(input).map((reading) => reading.key);
    expect(keys.indexOf(CLOCK_KEY)).toBe(keys.indexOf(ELAPSED_TIME_KEY) + 1);
    const clock = field(input, CLOCK_KEY);
    expect(clock === undefined ? undefined : readingTier(clock)).toBe('secondary');
  });

  it('has no clock field at all when no time is handed in — the demo', () => {
    expect(field(baseInput(), CLOCK_KEY)).toBeUndefined();
  });
});

describe('the lap in progress — #1312', () => {
  const onLap = (lap: number): HudInput => {
    const input = loopInput();
    const total: number = input.profile.totalDistance;
    return {
      ...input,
      state: {
        ...input.state,
        ride: { speed: metresPerSecond(8), distance: metres(total * (lap - 1) + 100) },
      },
    };
  };
  const strip = (input: HudInput) => profileReading(input.state, input.profile, input.lapSeconds);

  it('says the lap’s time beside which lap the rider is on, in the strip’s own sentence', () => {
    const first = strip({ ...onLap(1), lapSeconds: 65 });
    expect(first.text).toMatch(/^\d+% of lap 1 · 1:05$/);
    expect(first.label).toMatch(/^Route profile, \d+ per cent of lap 1, lap time 1:05$/);
    expect(strip({ ...onLap(3), lapSeconds: 7 }).text).toMatch(/of lap 3 · 0:07$/);
    // An hour-long lap keeps its hour.
    expect(strip({ ...onLap(2), lapSeconds: 3_725 }).text).toMatch(/of lap 2 · 1:02:05$/);
  });

  it('states no lap time, and never a nought, when nothing is being recorded', () => {
    const reading = strip(onLap(2));
    expect(reading.text).toMatch(/^\d+% of lap 2$/);
    expect(reading.label).toMatch(/^Route profile, \d+ per cent of lap 2$/);
  });

  it('states none on a route that is not a loop: there is no lap to be on', () => {
    const reading = strip({ ...baseInput(), lapSeconds: 65 });
    expect(reading.text).toBe('0% complete');
    expect(reading.label).toBe('Route profile, 0 per cent complete');
  });

  it('adds no field: a ride on a loop has the readings every other ride has, in their places', () => {
    const looped = hudReadings({ ...onLap(2), lapSeconds: 65 }).map((reading) => reading.key);
    expect(looped).toEqual(hudReadings(baseInput()).map((reading) => reading.key));
  });
});

/**
 * What a phone draws OUTSIDE the secondary grid: the moving time beside the
 * controls upright, or in the primary panel's clock row on its side (#1111),
 * and the elapsed time and the clock in that row (#2072, `theme.css`
 * §"THE CLOCK ROW") — and, since #2076, what a phone does not draw at all:
 * the ride so far, hidden by clip on a phone's overlay (`theme.css`
 * §"THE RIDE SO FAR").
 */
const LIFTED_ON_A_PHONE: ReadonlySet<string> = new Set([
  MOVING_TIME_KEY,
  ELAPSED_TIME_KEY,
  CLOCK_KEY,
  ...RIDE_TOTAL_KEYS,
  // #2077: and the rider's effort, given way where the ride so far is.
  WATTS_PER_KILOGRAM_KEY,
  ZONE_KEY,
]);

describe('what gives way to a room’s readings on a phone — #1356', () => {
  const gap = pacerGap({
    botDistance: metres(200),
    riderDistance: metres(100),
    referenceSpeed: metresPerSecond(10),
  });
  const base = baseInput();
  const widestRoomRide: HudInput = {
    ...base,
    state: { ...base.state, headwindMetresPerSecond: metresPerSecond(4) },
    chases: [
      { to: 'bot', gap },
      { to: 'ghost', gap },
    ],
    room: { nearby: 3, draft: 34, draftShown: true },
  };

  it('names the room’s three readings, and the pacer’s, the ghost’s and the wind as what gives way', () => {
    const readings = hudReadings(widestRoomRide);
    expect(readings.filter(isRoomReading).map((each) => each.key)).toEqual([
      'room-rider',
      'room-nearby',
      'room-draft',
    ]);
    expect(readings.filter(givesWayToTheRoom).map((each) => each.key)).toEqual([
      'gap-bot',
      'gap-ghost',
      'wind',
    ]);
  });

  it('leaves a phone six secondary cells beside the moving time, the room’s readings among them', () => {
    // A phone's secondary tier is three tracks wide, and two rows of it are
    // all the height there is (`theme.css` §"A ROOM RIDE ON A PHONE").
    const shown = hudReadings(widestRoomRide)
      .filter((each) => readingTier(each) === 'secondary')
      .filter((each) => !givesWayToTheRoom(each) && !LIFTED_ON_A_PHONE.has(each.key))
      .map((each) => each.key);
    // #2071: the gradient is primary; on the phones that draw it in this
    // panel it takes the first cell, which `theme.css` holds for it, so the
    // panel has as many cells as before (§"THE GRADIENT, PRIMARY").
    expect(shown).toEqual(['speed', 'remaining', 'room-rider', 'room-nearby', 'room-draft']);
  });

  it('gives way with the dashed field that stands in for a pacer, on a room ride with nobody chased', () => {
    const readings = hudReadings({ ...base, room: { nearby: 0 } });
    expect(readings.filter(givesWayToTheRoom).map((each) => each.key)).toEqual(['gap']);
  });

  it('names nothing on a ride with no room as the room’s', () => {
    const solo: HudInput = { ...widestRoomRide, room: undefined };
    expect(hudReadings(solo).filter(isRoomReading)).toEqual([]);
  });
});

describe('a Delivery round on the HUD — #1812', () => {
  const base = baseInput();
  const round = recordMiss(recordDelivery(recordDelivery(startRound(8), 0), 1), 2);
  const delivery: DeliveryHud = {
    round,
    week: { day: 3, houses: 8, score: 11 },
    score: 2,
    next: { side: 'right', metres: 84.6 },
  };

  it('shows the houses left, with the delivered and missed counts, and the round’s score with its day', () => {
    const shown = hudReadings({ ...base, delivery }).filter(isDeliveryReading);
    expect(shown).toEqual([
      {
        key: DELIVERY_HOUSES_KEY,
        label: 'Houses',
        value: '5',
        unit: 'left',
        stale: false,
        detail: '2\u00a0delivered, 1\u00a0missed',
      },
      {
        key: DELIVERY_NEXT_KEY,
        label: 'Next house',
        value: '85',
        unit: 'm',
        stale: false,
        detail: 'on the right',
      },
      {
        key: DELIVERY_SCORE_KEY,
        label: 'Score',
        value: '2',
        unit: '',
        stale: false,
        detail: 'Day 3 of 7',
      },
    ]);
  });

  it('says “Crashed” under the score while a crash is drawn, and the day again after — #2454', () => {
    const detail = (crashed: boolean | undefined): string | undefined =>
      hudReadings({ ...base, delivery: { ...delivery, crashed } }).find(
        (each) => each.key === DELIVERY_SCORE_KEY,
      )?.detail;
    expect(detail(true)).toBe(CRASHED_TEXT);
    expect(CRASHED_TEXT).toBe('Crashed');
    expect(detail(false)).toBe('Day 3 of 7');
    expect(detail(undefined)).toBe('Day 3 of 7');
  });

  it('shows the round’s score it is handed, a crash in it, rather than the deliveries counted — #1816', () => {
    // Two delivered and one crash: the round's score is 1 (`obstacles.ts` §`scoreAfter`).
    const shown = hudReadings({ ...base, delivery: { ...delivery, score: 1 } });
    expect(shown.find((each) => each.key === DELIVERY_SCORE_KEY)?.value).toBe('1');
  });

  it('follows the round as a parcel lands', () => {
    const before = hudReadings({ ...base, delivery });
    const after = hudReadings({
      ...base,
      delivery: { ...delivery, round: recordDelivery(round, 5) },
    });
    const houses = (readings: typeof before) =>
      readings.find((each) => each.key === DELIVERY_HOUSES_KEY);
    expect([houses(before)?.value, houses(before)?.detail]).toEqual([
      '5',
      '2\u00a0delivered, 1\u00a0missed',
    ]);
    expect([houses(after)?.value, houses(after)?.detail]).toEqual([
      '4',
      '3\u00a0delivered, 1\u00a0missed',
    ]);
  });

  it('puts them last, after the wind, so every other field keeps its index, and in the secondary tier', () => {
    // A ride with a wind set, so its field — the one that was last — is on it.
    const windy: HudInput = { ...base, state: { ...base.state, headwindMetresPerSecond: 4 } };
    const ordinary = hudReadings(windy).map((each) => each.key);
    expect(ordinary.at(-1)).toBe('wind');
    const keys = hudReadings({ ...windy, delivery }).map((each) => each.key);
    expect(keys).toEqual([...ordinary, DELIVERY_HOUSES_KEY, DELIVERY_NEXT_KEY, DELIVERY_SCORE_KEY]);
    for (const each of hudReadings({ ...base, delivery }).filter(isDeliveryReading)) {
      expect(readingTier(each)).toBe('secondary');
    }
  });

  it('is absent from an ordinary ride, whose HUD is unchanged', () => {
    expect(hudReadings(base).filter(isDeliveryReading)).toEqual([]);
    expect(hudReadings({ ...base, delivery: undefined })).toEqual(hudReadings(base));
  });

  it('shows a fresh round on day one as nothing delivered yet', () => {
    const fresh = hudReadings({
      ...base,
      delivery: {
        round: startRound(FRESH_WEEK.houses),
        week: FRESH_WEEK,
        score: 0,
        next: { side: 'left', metres: 310 },
      },
    }).filter(isDeliveryReading);
    expect(fresh.map((each) => [each.value, each.detail])).toEqual([
      ['8', '0\u00a0delivered, 0\u00a0missed'],
      ['310', 'on the left'],
      ['0', 'Day 1 of 7'],
    ]);
  });

  it('leaves a phone six secondary cells beside the moving time, the round’s readings among them', () => {
    // `theme.css` §"A ROOM RIDE ON A PHONE": the pacer's dashed field gives way.
    const shown = hudReadings({ ...base, delivery })
      .filter((each) => readingTier(each) === 'secondary')
      .filter((each) => !givesWayToTheRoom(each) && !LIFTED_ON_A_PHONE.has(each.key))
      .map((each) => each.key);
    // #2071: the gradient is primary; on the phones that draw it in this
    // panel it takes the first cell, which `theme.css` holds for it, so the
    // panel has as many cells as before (§"THE GRADIENT, PRIMARY").
    expect(shown).toEqual([
      'speed',
      'remaining',
      DELIVERY_HOUSES_KEY,
      DELIVERY_NEXT_KEY,
      DELIVERY_SCORE_KEY,
    ]);
  });

  it('says how far the next house is in the rider’s units and which side it stands, and a dash once none is left — #2453', () => {
    const next = (hud: DeliveryHud, units?: 'metric' | 'imperial') =>
      hudReadings({ ...base, delivery: hud, ...(units === undefined ? {} : { units }) }).find(
        (each) => each.key === DELIVERY_NEXT_KEY,
      );
    expect(next(delivery)).toMatchObject({ label: 'Next house', value: '85', unit: 'm' });
    // #2513: nought is inside the house's window, so a word, never "0 m".
    expect(next({ ...delivery, next: { side: 'left', metres: 0 } })).toMatchObject({
      value: 'Throw now,',
      detail: 'on the left',
    });
    // 84.6 m is 277.6 ft: the rider's units, through `units/format.ts`.
    expect(next(delivery, 'imperial')).toMatchObject({ value: '278', unit: 'ft' });
    const none = next({ ...delivery, next: undefined });
    expect(none).toEqual({
      key: DELIVERY_NEXT_KEY,
      label: 'Next house',
      value: NO_READING,
      unit: 'm',
      stale: false,
    });
  });

  it('says “Throw now, on the right” inside the house’s window rather than counting to nought — #2513', () => {
    const next = (hud: DeliveryHud, units?: 'metric' | 'imperial') =>
      hudReadings({ ...base, delivery: hud, ...(units === undefined ? {} : { units }) }).find(
        (each) => each.key === DELIVERY_NEXT_KEY,
      );
    for (const units of ['metric', 'imperial'] as const) {
      // Inside the window: a word, set as one, with the side under it and no unit.
      expect(next({ ...delivery, next: { side: 'right', metres: 0 } }, units)).toEqual({
        key: DELIVERY_NEXT_KEY,
        label: 'Next house',
        value: 'Throw now,',
        unit: '',
        stale: false,
        word: true,
        detail: 'on the right',
      });
      expect(next({ ...delivery, next: { side: 'left', metres: 0 } }, units)?.detail).toBe(
        'on the left',
      );
    }
    // Short of the window, however near, it is still a distance to the throw point.
    expect(next({ ...delivery, next: { side: 'right', metres: 2 } })).toMatchObject({
      value: '2',
      unit: 'm',
      detail: 'on the right',
    });
    expect(next({ ...delivery, next: { side: 'right', metres: 2 } })?.word).toBeUndefined();
  });
});

/**
 * #2071: the gradient, readable at a glance — primary, signed, with a slope
 * glyph. `HudPanel.test.tsx` reads it off the rendered primary row; this is
 * the model.
 */
describe('the gradient, signed and primary — #2071', () => {
  const at = (grade: number) => {
    const base = baseInput();
    return hudReadings({ ...base, state: { ...base.state, grade: gradePercent(grade) } }).find(
      (reading) => reading.key === GRADIENT_KEY,
    );
  };

  it('signs a climb with a plus and a descent with a minus, one decimal, in per cent', () => {
    expect(at(4.5)).toEqual({
      key: GRADIENT_KEY,
      label: 'Gradient',
      value: '+4.5',
      unit: '%',
      stale: false,
      slope: 'up',
      grade: 4.5,
    });
    expect(at(-2)).toMatchObject({ value: '-2.0', unit: '%', slope: 'down' });
    expect(at(12.46)?.value).toBe('+12.5');
  });

  it('claims no direction the digits do not show: what rounds to nought is level, unsigned', () => {
    for (const grade of [0, 0.04, -0.04, -0]) {
      expect(at(grade)).toMatchObject({ value: '0.0', slope: 'level' });
    }
    expect(at(0.05)).toMatchObject({ value: '+0.1', slope: 'up' });
    // A half rounds away from zero on a descent as on a climb.
    expect(at(-0.05)).toMatchObject({ value: '-0.1', slope: 'down' });
    expect(at(2.25)?.value).toBe('+2.3');
    expect(at(-2.25)?.value).toBe('-2.3');
  });

  /**
   * #2291: the number `HudCore` bands the digits' colour by is the number the
   * digits SHOW, so the colour never disagrees with what a rider reads: 2.96
   * shows `+3.0`, a climb's first tenth, and is coloured as one.
   */
  it('carries the grade it shows, rounded as the digits are', () => {
    expect(at(2.96)).toMatchObject({ value: '+3.0', grade: 3 });
    expect(at(-2.96)).toMatchObject({ value: '-3.0', grade: -3 });
    expect(at(12.46)?.grade).toBe(12.5);
    // What shows as `0.0` is nought, not a negative zero.
    expect(Object.is(at(-0.04)?.grade, 0)).toBe(true);
  });

  it('is the fourth primary reading, after heart rate and before speed', () => {
    const readings = hudReadings(baseInput());
    expect(readings.slice(0, 5).map((reading) => reading.key)).toEqual([
      'power',
      'cadence',
      'heartRate',
      GRADIENT_KEY,
      'speed',
    ]);
    const gradient = readings.find((reading) => reading.key === GRADIENT_KEY);
    expect(gradient === undefined ? undefined : readingTier(gradient)).toBe('primary');
  });

  it('is never stale: it is the simulation’s, not a sensor’s', () => {
    const base = baseInput();
    const dropped: HudInput = {
      ...base,
      state: { ...base.state, grade: gradePercent(3), input: { ...base.state.input, live: false } },
    };
    expect(hudReadings(dropped).find((reading) => reading.key === GRADIENT_KEY)?.stale).toBe(false);
  });
});

/**
 * #2076: *Distance*, *Climbed* and *Avg power* — formats of the recorder's
 * figures and nothing else. That they ARE the recorder's, and equal the saved
 * ride's, is `ride/controller.test.ts` §"#2076".
 */
describe('the ride so far — #2076', () => {
  const totals = {
    distance: metres(12_345),
    climbed: metres(212.6),
    averagePower: watts(187),
  };
  const shown = (input: Partial<HudInput>) =>
    hudReadings({ ...baseInput(), ...input }).filter(isRideTotalReading);

  it('shows the three, and since #2434 Calories, after the times and before every gap, in this order', () => {
    const keys = hudReadings({ ...baseInput(), rideTotals: totals }).map((each) => each.key);
    const at = keys.indexOf('distance');
    expect(keys.slice(at, at + 4)).toEqual(['distance', 'climbed', 'averagePower', 'calories']);
    expect(keys[at - 1]).toBe(ELAPSED_TIME_KEY);
    expect([...RIDE_TOTAL_KEYS]).toEqual(['distance', 'climbed', 'averagePower', 'calories']);
    // Secondary, every one: a reading added here lands in the cheaper tier.
    expect(shown({ rideTotals: totals }).map(readingTier)).toEqual([
      'secondary',
      'secondary',
      'secondary',
      'secondary',
    ]);
  });

  it('formats the recorder’s figures in the rider’s units', () => {
    expect(shown({ rideTotals: totals })).toEqual([
      { key: 'distance', label: 'Distance', value: '12.3', unit: 'km', stale: false },
      { key: 'climbed', label: 'Climbed', value: '213', unit: 'm', stale: false },
      { key: 'averagePower', label: 'Avg power', value: '187', unit: 'W', stale: false },
      // #2434: these totals carry no estimate, and no work or heart rate.
      {
        key: 'calories',
        label: 'Calories',
        value: NO_READING,
        unit: 'kcal',
        detail: 'no power or heart rate',
        stale: false,
      },
    ]);
    expect(
      shown({ rideTotals: totals, units: 'imperial' }).map((each) => [each.value, each.unit]),
    ).toEqual([
      ['7.7', 'mi'],
      ['698', 'ft'],
      ['187', 'W'],
      [NO_READING, 'kcal'],
    ]);
  });

  it('shows a dash for each with nothing recorded, and never a zero', () => {
    expect(shown({}).map((each) => [each.value, each.stale])).toEqual([
      [NO_READING, false],
      [NO_READING, false],
      [NO_READING, false],
      [NO_READING, false],
    ]);
  });

  it('shows a dash for a climb nobody measured and a ride with no power, and the rest as they are', () => {
    const indoor = { distance: metres(5_000), climbed: undefined, averagePower: undefined };
    expect(shown({ rideTotals: indoor }).map((each) => each.value)).toEqual([
      '5.0',
      NO_READING,
      NO_READING,
      NO_READING,
    ]);
  });

  it('is never named a load metric', () => {
    for (const reading of shown({ rideTotals: totals })) {
      expect(reading.label).not.toMatch(/\b(NP|TSS|IF|CTL|ATL|TSB)\b/);
    }
  });
});

/**
 * #2434: *Calories* in the ride so far — the owner's ruling of 2026-11-10: the
 * always-shown tier, so it is on the default HUD. The figure is the
 * recorder's (`recording/totals.ts` §`recordedRideCalories`), and that it
 * equals the saved ride's is `ride/controller.test.ts` §"#2434"; this is the
 * format, in the ride result card's words (`detail/CaloriesFact.tsx`).
 */
describe('the calorie estimate in the ride so far — #2434', () => {
  const calories = (rideTotals: HudInput['rideTotals']) =>
    hudReadings({ ...baseInput(), rideTotals }).find((each) => each.key === CALORIES_KEY);
  const ridden = { distance: metres(6000), climbed: undefined, averagePower: undefined };

  it('is drawn on the default HUD, in the ride so far, secondary, never stale', () => {
    const reading = calories(undefined);
    expect(reading).toBeDefined();
    expect(reading && isRideTotalReading(reading)).toBe(true);
    expect(reading && readingTier(reading)).toBe('secondary');
    expect(reading?.stale).toBe(false);
  });

  it('shows ≈ and whole kilocalories, with the basis as its phrase', () => {
    expect(
      calories({
        ...ridden,
        energy: joules(120_000),
        calories: { energy: kilocalories(143.4), basis: 'power' },
      }),
    ).toEqual({
      key: 'calories',
      label: 'Calories',
      value: '≈ 143',
      unit: 'kcal',
      detail: 'estimate from power',
      stale: false,
    });
    expect(
      calories({ ...ridden, calories: { energy: kilocalories(612.6), basis: 'heart-rate' } }),
    ).toMatchObject({ value: '≈ 613', detail: 'estimate from heart rate' });
  });

  it('is a dash and the card’s reason with no estimate, never 0 kcal', () => {
    // Nothing recorded yet, or a ride with neither channel.
    expect(calories(undefined)).toMatchObject({
      value: NO_READING,
      detail: 'no power or heart rate',
    });
    expect(calories({ ...ridden, recordedHeartRate: false })).toMatchObject({
      value: NO_READING,
      detail: 'no power or heart rate',
    });
    // A recording with heart rate and no estimate: the rider's details are not set.
    expect(calories({ ...ridden, recordedHeartRate: true })).toMatchObject({
      value: NO_READING,
      detail: 'set your details in Settings',
    });
    for (const each of [undefined, ridden, { ...ridden, recordedHeartRate: true }]) {
      expect(calories(each)?.value).not.toMatch(/\b0\b/);
    }
  });

  it('takes the reason from the recording, not the live strap', () => {
    // A strap that dropped: no live heart rate, a recording that has it.
    const dropped = {
      ...baseInput(),
      heartRate: { value: undefined, live: false, paired: true },
      rideTotals: { ...ridden, recordedHeartRate: true },
    };
    expect(hudReadings(dropped).find((each) => each.key === CALORIES_KEY)?.detail).toBe(
      'set your details in Settings',
    );
    // A strap live now, on a recording that has none yet.
    const live = {
      ...baseInput(),
      heartRate: { value: 140, live: true },
      rideTotals: { ...ridden, recordedHeartRate: false },
    };
    expect(hudReadings(live).find((each) => each.key === CALORIES_KEY)?.detail).toBe(
      'no power or heart rate',
    );
  });
});

/**
 * #2077: the rider's own W/kg and the zone indicator — formats of the weight
 * the physics rides, the rider's own threshold and the recorder's time in
 * zone. `GameView.test.tsx` §"#2077" holds the wiring.
 */
describe('the rider’s W/kg and power zone — #2077', () => {
  const riding = (power: number, live = true) => {
    const base = baseInput();
    return { ...base, state: { ...base.state, input: { power: watts(power), live } } };
  };
  const effort = (input: HudInput) => hudReadings(input).filter(isEffortReading);
  const zoneTime = {
    perZone: [0, 600, 0, 300, 100, 0, 0].map((spent) => seconds(spent)),
    covered: seconds(1000),
  };

  it('puts W/kg after the ride so far, then the zone, before every gap', () => {
    const keys = hudReadings({
      ...riding(300),
      riderMass: kilograms(75),
      thresholdPower: watts(250),
    }).map((each) => each.key);
    const at = keys.indexOf(CALORIES_KEY);
    expect(keys[at - 1]).toBe('averagePower');
    expect(keys.slice(at + 1, at + 3)).toEqual([WATTS_PER_KILOGRAM_KEY, ZONE_KEY]);
    expect(
      effort({ ...riding(300), riderMass: kilograms(75), thresholdPower: watts(250) }).map(
        readingTier,
      ),
    ).toEqual(['secondary', 'secondary']);
  });

  it('is the live power over the weight the physics rides, to one decimal', () => {
    const [wkg] = effort({ ...riding(342), riderMass: kilograms(72) });
    expect(wkg).toEqual({
      key: WATTS_PER_KILOGRAM_KEY,
      label: 'W/kg',
      value: '4.8',
      unit: '',
      stale: false,
    });
  });

  it('is a dash with no weight set — never a figure of the default weight', () => {
    const [wkg] = effort(riding(342));
    expect(wkg?.value).toBe(NO_READING);
    expect(wkg?.stale).toBe(false);
  });

  it('is a dash, marked lost, when the power reading drops', () => {
    const [wkg] = effort({ ...riding(342, false), riderMass: kilograms(72) });
    expect([wkg?.value, wkg?.stale]).toEqual([NO_READING, true]);
  });

  it('draws no zone indicator at all with no threshold set', () => {
    expect(effort({ ...riding(342), riderMass: kilograms(72) }).map((each) => each.key)).toEqual([
      WATTS_PER_KILOGRAM_KEY,
    ]);
  });

  it('names the zone of the rider’s own threshold by its number and its name', () => {
    const zone = effort({
      ...riding(342),
      thresholdPower: watts(250),
      powerZoneTime: zoneTime,
    }).find((each) => each.key === ZONE_KEY);
    // 342 W is 1.37 of 250 W: zone 6, from 1.21 to 1.51.
    expect(zone).toMatchObject({ label: 'Zone', value: '6', detail: 'Anaerobic', stale: false });
    expect(zone?.zone?.current).toBe(6);
    // This ride's time in each zone, as shares of the time power was read.
    expect(zone?.zone?.shares).toEqual([0, 0.6, 0, 0.3, 0.1, 0, 0]);
  });

  it('draws the zone at its edges as the Analysis screen classifies them', () => {
    const at = (power: number) =>
      effort({ ...riding(power), thresholdPower: watts(200) }).find((each) => each.key === ZONE_KEY)
        ?.value;
    // Zone 4 from 0.91 of threshold, inclusive; zone 5 from 1.06.
    expect(at(181)).toBe('3');
    expect(at(182)).toBe('4');
    expect(at(212)).toBe('5');
    expect(at(0)).toBe('1');
  });

  it('shows a dash and no name with the power reading lost, and an empty bar with nothing recorded', () => {
    const zone = effort({ ...riding(342, false), thresholdPower: watts(250) }).find(
      (each) => each.key === ZONE_KEY,
    );
    expect(zone?.value).toBe(NO_READING);
    expect(zone?.detail).toBeUndefined();
    expect(zone?.zone).toEqual({ current: undefined, shares: [] });
  });
});

/**
 * #2420: the power the rider chose to see — the 3 s average or the reading as
 * it arrives — on the power field, W/kg and the zone. `power-average.ts` makes
 * the average; `power-shown-wiring.test.tsx` holds the wiring, and that the
 * ride itself reads the raw reading in both.
 */
describe('power as a 3 s average or instant — #2420', () => {
  const riding = (power: number, live = true, paired = true): HudInput => {
    const base = baseInput();
    return { ...base, state: { ...base.state, input: { power: watts(power), live, paired } } };
  };
  const field = (input: HudInput, key: string) =>
    hudReadings(input).find((each) => each.key === key);

  it('shows the 3 s average, rounded, and says so after the label', () => {
    const power = field(
      { ...riding(312), shownPower: { view: 'average', average: 251.6 } },
      'power',
    );
    expect(power).toMatchObject({ label: 'Power', qualifier: '3 s', value: '252', unit: 'W' });
    expect(power?.stale).toBe(false);
  });

  it('shows the reading as it arrives in the instant view, and says so', () => {
    const power = field(
      { ...riding(312), shownPower: { view: 'instant', average: 251.6 } },
      'power',
    );
    expect(power).toMatchObject({ label: 'Power', qualifier: 'instant', value: '312' });
  });

  it('is the raw reading under its plain label where no choice is handed in (the demo)', () => {
    const power = field(riding(312), 'power');
    expect(power?.value).toBe('312');
    expect(power?.qualifier).toBeUndefined();
  });

  it('names each view in words', () => {
    expect(POWER_QUALIFIERS).toEqual({ average: '3 s', instant: 'instant' });
  });

  it('is a dash, marked lost, when the meter drops in either view — never the average', () => {
    for (const view of ['average', 'instant'] as const) {
      const power = field({ ...riding(0, false), shownPower: { view, average: 240 } }, 'power');
      expect([power?.value, power?.stale]).toEqual([NO_READING, true]);
    }
  });

  it('is a bare dash with nothing paired, in either view', () => {
    const power = field(
      { ...riding(0, false, false), shownPower: { view: 'average', average: undefined } },
      'power',
    );
    expect([power?.value, power?.stale]).toEqual([NO_READING, false]);
  });

  it('is the raw reading where the average has nothing yet', () => {
    const power = field(
      { ...riding(312), shownPower: { view: 'average', average: undefined } },
      'power',
    );
    expect(power?.value).toBe('312');
  });

  it('takes W/kg and the zone from the same power the field shows', () => {
    const effort = (view: 'average' | 'instant') =>
      hudReadings({
        ...riding(342),
        riderMass: kilograms(72),
        thresholdPower: watts(250),
        shownPower: { view, average: 200 },
      });
    const pick = (readings: ReturnType<typeof hudReadings>, key: string) =>
      readings.find((each) => each.key === key)?.value;
    // 200 W over 72 kg is 2.8 and zone 3 of 250 W; 342 W is 4.8 and zone 6.
    expect(pick(effort('average'), WATTS_PER_KILOGRAM_KEY)).toBe('2.8');
    expect(pick(effort('average'), ZONE_KEY)).toBe('3');
    expect(pick(effort('instant'), WATTS_PER_KILOGRAM_KEY)).toBe('4.8');
    expect(pick(effort('instant'), ZONE_KEY)).toBe('6');
  });
});
