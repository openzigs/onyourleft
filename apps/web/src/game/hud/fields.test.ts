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

    expect(fieldNamed({ ...input, gap: behind, gapTo: 'bot' }, 'gap').label).toBe('Pacer');
    expect(fieldNamed({ ...input, gap: behind, gapTo: 'ghost' }, 'gap').label).toBe('Your best');
  });

  it('says behind or ahead in words rather than with a minus sign', () => {
    // A minus sign is one glyph wide at arm's length and is the first thing lost.
    const input = baseInput();
    const behind = pacerGap({
      botDistance: metres(200),
      riderDistance: metres(100),
      referenceSpeed: metresPerSecond(10),
    });
    const ahead = pacerGap({
      botDistance: metres(100),
      riderDistance: metres(200),
      referenceSpeed: metresPerSecond(10),
    });

    expect(fieldNamed({ ...input, gap: behind, gapTo: 'bot' }, 'gap').value).toContain('behind');
    expect(fieldNamed({ ...input, gap: ahead, gapTo: 'bot' }, 'gap').value).toContain('ahead');
    expect(fieldNamed({ ...input, gap: ahead, gapTo: 'bot' }, 'gap').value).not.toContain('-');
  });

  it('shows a dash rather than a nought for a stationary rider', () => {
    const input = baseInput();
    const stopped = pacerGap({
      botDistance: metres(200),
      riderDistance: metres(100),
      referenceSpeed: metresPerSecond(0),
    });

    expect(fieldNamed({ ...input, gap: stopped, gapTo: 'bot' }, 'gap').value).toBe(NO_READING);
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
      gapTo: 'bot',
      gap: pacerGap({
        botDistance: metres(500),
        riderDistance: metres(400),
        referenceSpeed: metresPerSecond(10),
      }),
    };

    expect(fieldNamed(withGap, 'gap').value).toContain('s ');
  });
});
