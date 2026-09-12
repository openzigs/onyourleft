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

import { NO_READING, gapAgainst, hudReadings, profilePosition, type HudInput } from './fields';
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

    expect(profilePosition(halfway.state, halfway.profile)).toBeCloseTo(0.5, 6);
  });

  it('clamps the marker rather than running it off the end on a loop', () => {
    const input = baseInput();
    const total: number = input.profile.totalDistance;
    const past: HudInput = {
      ...input,
      state: { ...input.state, ride: { speed: metresPerSecond(0), distance: metres(total * 3) } },
    };

    expect(profilePosition(past.state, past.profile)).toBe(1);
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
