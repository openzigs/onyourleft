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
  NO_READING,
  gapAgainst,
  hudReadings,
  profileReading,
  trainerLine,
  type HudInput,
} from './fields';
import { atStartLine } from '../simulation';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
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
});
