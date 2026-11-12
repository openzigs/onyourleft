// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Delivery's belt in the pinned Chromium — #1814, resting on the owner's
 * ruling DL6b (epic #1803, ADR 0059 D-3). `delivery-harness.ts` says what
 * each page function draws.
 *
 * 1. **At most three calls, whatever the count**: a real view's frame
 *    carrying 1 and 20 of each piece costs the same number of calls more than
 *    the same frame with no round, read at WebGL's own draw entry points; the
 *    controls are that the belt drew 1 and 20 of each, and that a round with
 *    nothing in view adds nothing. The same for the belt alone in each world's
 *    materials, by three's own count.
 * 2. **A marker leaves its house**: a parcel thrown by `throw.ts` delivers to
 *    the first of two houses, and on the next frame the view's belt draws the
 *    second's marker and not the first's, read off its instances.
 * 3. **One instanced call, three shapes**: one obstacle of each kind,
 *    square-on, paints only where its own shape is, so the kinds sharing a
 *    call do not draw over each other.
 * 4. **The owner's photograph**: a real frame with a parcel, a marker and
 *    each obstacle, attached to the run.
 * 5. **An obstacle in the rider's own lane is not behind their back** (#2396):
 *    each kind standing in the lane the rider is steered into, from 60 m to
 *    2 m ahead, on the owner's 16 : 10 tablet and an upright phone; at three
 *    distances in four, of the whole approach and of its last 30 m, some of
 *    what it and its hazard marker draw stands clear above the rider's top.
 *    With no marker (`three-renderer.ts` §`obstacleHazardMarker`) every case
 *    is red: the obstacle sits on the helmet, then behind the rider.
 * 6. **The camera stays out of a parked car** (#2396): the rider back in the
 *    car's lane just past it, the camera 4.5 m behind still beside it, the
 *    eye where `delivery/camera-clear.ts` puts it; the car covers at most a
 *    fifth of the road under the rider. With the eye behind the rider, a
 *    flat block of the car's paint covers 65 % to 98 % of it.
 * 7. **The owner's photographs** of #2396: a bin in the rider's lane, and a
 *    parked car being passed, before and after.
 *
 * ⚠️ An ordinary ride's village frame is `realistic-town.browser.spec.ts`',
 * which this change does not touch: no view builds the belt until a frame
 * carries a round.
 */

import { expect, test, type Page } from '@playwright/test';

async function open(page: Page): Promise<void> {
  const response = await page.goto('/delivery.html');
  expect(
    response?.status(),
    'delivery.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylDelivery?.ready === true);
}

/** DL6b's "instanced so the raise stays small": the most calls the belt may add. */
const MOST_DELIVERY_CALLS = 3;

/**
 * #2396's approach: from `obstacles.ts` §`OBSTACLE_SIGHT_METRES`, where the
 * obstacle is spoken, to 2 m in front of the rider, every 2 m.
 */
const APPROACH: readonly number[] = Array.from({ length: 30 }, (_, index) => 60 - 2 * index);

/**
 * The last of the approach, metres: **30**, the stretch the rider steers in.
 * At `obstacles.ts` §`AVOIDABLE_FASTEST_METRES_PER_SECOND` it is 2.5 s, a
 * lane change (`lanes.ts` §`LANE_CHANGE_SECONDS`, 0.4 s) and a reaction.
 * Held on its own because the whole approach can pass while this fails: on
 * the tablet a bin with no marker stands clear of the rider from 60 m to
 * about 18 m, then is behind their back for the last 15 m, which is
 * three-quarters of the approach and none of the part that counts.
 */
const STEERING_WINDOW_METRES = 30;

/**
 * How far above the rider's top an obstacle's pixels must stand to count as
 * clear of the rider: **4 %** of the frame's height. #2396's own number:
 * nearer the helmet than that, a speck reads as part of the rider.
 */
const CLEAR_SHARE = 0.04;

/** The fewest such pixels that count as the obstacle being seen there. */
const CLEAR_PIXELS = 4;

/** #2396's "for most of the approach": three distances in four, of the whole and of its last 30 m. */
const MOST_OF_THE_APPROACH = 0.75;

/** The owner's tablet, 16 : 10, and a phone held upright. */
const IN_LANE_FRAMES = [
  { name: 'a 16 : 10 tablet', width: 1280, height: 800 },
  { name: 'an upright phone', width: 390, height: 844 },
] as const;

/**
 * #2396: where the camera's eye is, metres past a parked car's middle, while
 * the rider 4.5 m ahead is back in the car's lane and clear of it: from half
 * a metre behind the car's back (the near plane's reach) to its front, every
 * half metre. The car is 4.4 m long.
 */
const EYE_BESIDE_CAR: readonly number[] = Array.from(
  { length: 10 },
  (_, index) => -2.7 + 0.5 * index,
);

/**
 * The most of the road under the rider — the middle third of the frame's
 * bottom quarter — a car the camera is beside may cover: **a fifth**. #2396's
 * own number, from its measurement: with the eye moved off the car its side
 * reaches 10 % of that strip on the tablet and none on a phone; with the eye
 * behind the rider, inside the car, a flat block of its paint covers 65 % to
 * 98 %, the frame the owner saw.
 */
const MOST_CAR_IN_THE_BOTTOM = 0.2;

/** Each kind in the right-hand lane, the racing line's home, and a bin on the centre line. */
const IN_LANE_CASES = [
  { kind: 'bin', lane: 1.75 },
  { kind: 'trolley', lane: 1.75 },
  { kind: 'cone', lane: 1.75 },
  { kind: 'bin', lane: 0 },
] as const;

test.describe('Delivery’s belt — #1814', () => {
  test('adds the same calls to a real view’s frame for one of each piece as for twenty, and no more than three', async ({
    page,
  }) => {
    await open(page);
    const one = await page.evaluate(() => window.__oylDelivery?.viewCalls(1));
    const twenty = await page.evaluate(() => window.__oylDelivery?.viewCalls(20));
    console.log(`#1814 view calls: one ${JSON.stringify(one)}, twenty ${JSON.stringify(twenty)}`);
    // The controls: the belt drew what it was handed, and a round with nothing in view adds nothing.
    expect(one?.drawn).toEqual({ parcels: 1, markers: 1, obstacles: 1 });
    expect(twenty?.drawn).toEqual({ parcels: 20, markers: 20, obstacles: 20 });
    expect(one?.empty).toBe(one?.without);
    expect(twenty?.empty).toBe(twenty?.without);
    const added = (one?.with ?? 0) - (one?.without ?? 0);
    expect(added).toBeGreaterThan(0);
    expect(added).toBeLessThanOrEqual(MOST_DELIVERY_CALLS);
    expect((twenty?.with ?? 0) - (twenty?.without ?? 0)).toBe(added);
  });

  for (const world of ['stylised', 'realistic'] as const) {
    test(`draws in the same three calls for one of each and for twenty in the ${world} world’s materials`, async ({
      page,
    }) => {
      await open(page);
      const counted = await page.evaluate(
        (w) =>
          [1, 20].map((count) => {
            const harness = window.__oylDelivery;
            if (harness === undefined) throw new Error('no harness');
            return harness.probeCalls(w, count);
          }),
        world,
      );
      console.log(`#1814 ${world} belt calls: ${JSON.stringify(counted)}`);
      const [one, twenty] = counted;
      expect(one?.drawn).toEqual({ parcels: 1, markers: 1, obstacles: 1 });
      expect(twenty?.drawn).toEqual({ parcels: 20, markers: 20, obstacles: 20 });
      expect(one?.hidden).toBe(0);
      expect(twenty?.hidden).toBe(0);
      expect(one?.shown).toBe(MOST_DELIVERY_CALLS);
      expect(twenty?.shown).toBe(one?.shown);
    });

    test(`draws each obstacle kind’s own shape only, in one instanced call, in the ${world} world’s materials`, async ({
      page,
    }) => {
      await open(page);
      const read = await page.evaluate((w) => window.__oylDelivery?.kinds(w), world);
      console.log(`#1814 ${world} kinds: ${JSON.stringify(read)}`);
      // Points: in the bin above the cone's tip; low in the middle; on the trolley's upright.
      expect(read?.bin).toEqual([true, true, true]);
      expect(read?.trolley).toEqual([false, false, true]);
      expect(read?.cone).toEqual([false, true, false]);
      // #2362: a parked car's body, and the road under it between its wheels.
      expect(read?.['parked-car']).toEqual([true, false, true]);
    });
  }

  test('draws a level’s rain in one call, and none under prefers-reduced-motion — #2366', async ({
    page,
  }) => {
    await open(page);
    const moving = await page.evaluate(() => window.__oylDelivery?.rainCalls());
    console.log(`#2366 rain calls: ${JSON.stringify(moving)}`);
    // The rain is drawn, in one call and no more.
    expect(moving?.rainShown).toBe(true);
    expect((moving?.rain ?? 0) - (moving?.clear ?? 0)).toBe(1);
    // Reduced motion: no falling rain, and no call for it.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const still = await page.evaluate(() => window.__oylDelivery?.rainCalls());
    console.log(`#2366 rain calls, reduced motion: ${JSON.stringify(still)}`);
    expect(still?.rainShown).toBe(false);
    expect(still?.rain).toBe(still?.clear);
  });

  test('draws a level’s dusk darker and warmer than clear daylight, and its rain greyer, read back from a real frame — #2508', async ({
    page,
  }) => {
    await open(page);
    const read = await page.evaluate(() => window.__oylDelivery?.weatherLook());
    console.log(`#2508 weather look: ${JSON.stringify(read)}`);
    const clear = read?.clear;
    const dusk = read?.dusk;
    const rain = read?.rain;
    expect(clear).toBeDefined();
    // Dusk: well under three-quarters of clear daylight's luma, and warmer —
    // more red against its blue than the day has.
    expect(dusk?.luma ?? Infinity).toBeLessThan((clear?.luma ?? 0) * 0.75);
    expect((dusk?.red ?? 0) / (dusk?.blue ?? 1)).toBeGreaterThan(
      ((clear?.red ?? 0) / (clear?.blue ?? 1)) * 1.1,
    );
    // Rain: darker than clear, and greyer — its channels closer together.
    const spread = (look: typeof clear): number =>
      Math.max(look?.red ?? 0, look?.green ?? 0, look?.blue ?? 0) -
      Math.min(look?.red ?? 0, look?.green ?? 0, look?.blue ?? 0);
    expect(rain?.luma ?? Infinity).toBeLessThan(clear?.luma ?? 0);
    expect(spread(rain)).toBeLessThan(spread(clear));
  });

  test('shades the scenery at dusk as the ground, lights the rain with the scene, and lays none by the camera, read back from real frames — PR #2522', async ({
    page,
  }) => {
    await open(page);
    const back = await page.evaluate(() => window.__oylDelivery?.weatherReadback());
    console.log(`PR #2522 weather readback: ${JSON.stringify(back)}`);
    const clear = back?.clear;
    const dusk = back?.dusk;
    const rain = back?.rain;
    const both = back?.['rain-dusk'];
    if (clear === undefined || dusk === undefined || rain === undefined || both === undefined) {
      throw new Error('a weather drew no frame to read back');
    }
    // Clear daylight: the scenery is its own colour.
    expect(clear.sceneryShade).toEqual([1, 1, 1]);
    // Dusk: each channel of the scenery goes down within 5 % of the ground's own darkening.
    for (const channel of [0, 1, 2] as const) {
      const ground = dusk.ground[channel] / clear.ground[channel];
      expect(Math.abs(dusk.sceneryShade[channel] / ground - 1)).toBeLessThan(0.05);
      expect(Math.abs(both.sceneryShade[channel] / ground - 1)).toBeLessThan(0.05);
    }
    // The rain: lit by the scene, greyer in daytime rain than its paint, dimmer and warm at dusk.
    const paint = [0xb4, 0xc4, 0xd2].map((channel) => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    const luma = (colour: readonly number[] | undefined): number =>
      0.2126 * (colour?.[0] ?? Infinity) +
      0.7152 * (colour?.[1] ?? Infinity) +
      0.0722 * (colour?.[2] ?? Infinity);
    expect(luma(rain.rainColour)).toBeLessThan(luma(paint) * 0.8);
    expect(luma(both.rainColour)).toBeLessThan(luma(rain.rainColour) * 0.75);
    const warmth = (colour: readonly number[] | undefined): number =>
      (colour?.[0] ?? 0) / (colour?.[2] ?? Infinity);
    expect(warmth(both.rainColour)).toBeGreaterThan(warmth(rain.rainColour) * 1.2);
    // No streak stands nearer the camera than 2.5 m.
    for (const frame of [rain, both]) {
      expect(frame.rainClearance ?? 0).toBeGreaterThanOrEqual(2.5);
    }
  });

  for (const weather of ['clear', 'dusk', 'rain', 'rain-dusk'] as const) {
    test(`photographs a level in ${weather} on the tablet for the owner — #2508`, async ({
      page,
    }, testInfo) => {
      await open(page);
      await page.evaluate((w) => window.__oylDelivery?.weatherShowcase(w), weather);
      const shot = await page.locator(`#delivery-weather-${weather}`).screenshot();
      await testInfo.attach(`delivery-weather-${weather}`, {
        body: shot,
        contentType: 'image/png',
      });
      expect(shot.subarray(1, 4).toString('ascii')).toBe('PNG');
      expect(shot.byteLength).toBeGreaterThan(5000);
    });
  }

  test('takes a marker off its house on the frame after a parcel is delivered there, read from what the view drew', async ({
    page,
  }) => {
    await open(page);
    const reading = await page.evaluate(() => window.__oylDelivery?.markerLeaves());
    console.log(`#1814 marker: ${JSON.stringify(reading)}`);
    expect(reading?.delivered).toBe(true);
    expect(reading?.before).toEqual({ markers: 2, first: true, second: true });
    expect(reading?.after).toEqual({ markers: 1, first: false, second: true });
  });

  test('photographs the parked cars for the owner — #2362, round 5', async ({ page }, testInfo) => {
    await open(page);
    await page.evaluate(() => window.__oylDelivery?.carsShowcase());
    const shot = await page.locator('#delivery-cars').screenshot();
    await testInfo.attach('delivery-cars', { body: shot, contentType: 'image/png' });
    expect(shot.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(shot.byteLength).toBeGreaterThan(5000);
  });
  for (const { name, width, height } of IN_LANE_FRAMES) {
    for (const { kind, lane } of IN_LANE_CASES) {
      test(`#2396: a ${kind} standing in the rider’s own lane (${String(lane)} m) is clear of the rider for most of its approach, on ${name}`, async ({
        page,
      }) => {
        await open(page);
        const reading = await page.evaluate(
          (asked) =>
            window.__oylDelivery?.inLane(
              asked.kind,
              asked.lane,
              asked.aheads,
              asked.clearShare,
              asked.width,
              asked.height,
            ),
          { kind, lane, aheads: APPROACH, clearShare: CLEAR_SHARE, width, height },
        );
        if (reading === undefined) throw new Error('no harness');
        const isClear = (sample: { readonly clear: number }): boolean =>
          sample.clear >= CLEAR_PIXELS;
        const clear = reading.samples.filter(isClear);
        const steering = reading.samples.filter((sample) => sample.ahead <= STEERING_WINDOW_METRES);
        console.log(
          `#2396 ${kind} in lane ${String(lane)} on ${name}: rider's top ${(100 * reading.riderTop).toFixed(1)} %, ` +
            `clear at ${String(clear.length)} of ${String(reading.samples.length)}: ` +
            reading.samples
              .map(
                (sample) =>
                  `${String(sample.ahead)} m ${String(sample.clear)}/${String(sample.drawn)}`,
              )
              .join(', '),
        );
        // The control: the obstacle is drawn, ahead of the rider, at every distance.
        for (const sample of reading.samples) {
          expect(sample.drawn, `drawn ${String(sample.ahead)} m ahead`).toBeGreaterThan(0);
        }
        expect(clear.length / reading.samples.length, 'the whole approach').toBeGreaterThanOrEqual(
          MOST_OF_THE_APPROACH,
        );
        expect(
          steering.filter(isClear).length / steering.length,
          `the last ${String(STEERING_WINDOW_METRES)} m`,
        ).toBeGreaterThanOrEqual(MOST_OF_THE_APPROACH);
      });
    }
  }

  for (const { name, width, height } of IN_LANE_FRAMES) {
    test(`#2396: the camera stays out of a parked car the rider has just passed, on ${name}`, async ({
      page,
    }) => {
      await open(page);
      const samples = await page.evaluate(
        (asked) => window.__oylDelivery?.pastParkedCar(asked.eyes, asked.width, asked.height),
        { eyes: EYE_BESIDE_CAR, width, height },
      );
      if (samples === undefined) throw new Error('no harness');
      console.log(
        `#2396 past a parked car on ${name}: ` +
          samples
            .map(
              (sample) =>
                `eye ${sample.eyeAhead.toFixed(1)} m at ${sample.eyeLateral.toFixed(2)} m, ` +
                `${(100 * sample.underRiderCovered).toFixed(1)} %`,
            )
            .join('; '),
      );
      expect(samples).toHaveLength(EYE_BESIDE_CAR.length);
      for (const sample of samples) {
        expect(sample.underRiderCovered, `eye ${String(sample.eyeAhead)} m`).toBeLessThanOrEqual(
          MOST_CAR_IN_THE_BOTTOM,
        );
      }
    });
  }

  test('photographs a Delivery frame for the owner', async ({ page }, testInfo) => {
    await open(page);
    await page.evaluate(() => window.__oylDelivery?.showcase());
    const shot = await page.locator('#delivery-showcase').screenshot();
    await testInfo.attach('delivery-showcase', { body: shot, contentType: 'image/png' });
    // A PNG, and not a flat fill: a one-colour frame compresses to a few hundred bytes.
    expect(shot.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(shot.byteLength).toBeGreaterThan(5000);
  });

  for (const ahead of [25, 8]) {
    test(`#2396: photographs a bin ${String(ahead)} m ahead in the rider’s own lane for the owner`, async ({
      page,
    }, testInfo) => {
      await open(page);
      await page.evaluate((at) => window.__oylDelivery?.inLaneShowcase(at), ahead);
      const shot = await page.locator('#delivery-in-lane').screenshot();
      await testInfo.attach(`delivery-in-lane-${String(ahead)}m`, {
        body: shot,
        contentType: 'image/png',
      });
      expect(shot.subarray(1, 4).toString('ascii')).toBe('PNG');
      expect(shot.byteLength).toBeGreaterThan(5000);
    });
  }

  for (const behind of [true, false]) {
    const when = behind ? 'before' : 'after';
    test(`#2396: photographs a parked car being passed for the owner, the camera as it was ${when} the fix`, async ({
      page,
    }, testInfo) => {
      await open(page);
      await page.evaluate((b) => window.__oylDelivery?.pastCarShowcase(-1.2, b), behind);
      const shot = await page.locator('#delivery-past-car').screenshot();
      await testInfo.attach(`delivery-past-car-${when}`, { body: shot, contentType: 'image/png' });
      expect(shot.subarray(1, 4).toString('ascii')).toBe('PNG');
      expect(shot.byteLength).toBeGreaterThan(5000);
    });
  }
});
