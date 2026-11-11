// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * What the HUD does with a value that is a **word** — #259.
 *
 * ⚠️ **Not `*.a11y.test.tsx`, and that is deliberate.** Everything this panel
 * owes a screen reader is in `HudPanel.a11y.test.tsx` and belongs inside the
 * `test:a11y` gate (§4e). This is a *layout* concern, and putting it in that
 * file would widen a gate whose whole value is that its name says what broke.
 *
 * ## What it can assert, and the half it cannot
 *
 * `theme.css` gives a HUD value 2.5 rem inside a `repeat(auto-fit,
 * minmax(7rem, 1fr))` grid track, and a track does not grow past its content
 * the way a flex item does. A single word has no break opportunity, so a word
 * wider than the track spills sideways onto the next field's number. `fields.ts`
 * §`HudReading.word` carries the measurements.
 *
 * ⚠️ **jsdom does no layout, so nothing here can measure a pixel.** What it can
 * pin is the wiring: the flag reaches the element, on the readings that need it
 * and not on the ones that do not. A `word: true` that `HudPanel` never read
 * would be exactly the shape #237, #253 and #259 are all instances of — built,
 * exported, tested and consumed by nobody — so the assertion is about the
 * rendered element rather than about the reading.
 *
 * `hud-value-size.test.ts` is the other end of the same wire — that the class
 * this file finds on the element names a rule that actually sets it smaller. It
 * is a separate file because it reads `theme.css` as a file, and under jsdom
 * `import.meta.url` is an `http://` URL that `fileURLToPath` refuses.
 *
 * The pixels themselves are measured on every run since #266, by
 * `apps/web/browser/hud.browser.spec.ts` — this paragraph used to say that
 * needed its own issue, and it did, and it landed. What is asserted here is
 * still the wiring rather than the width: a browser gate cannot tell a value
 * that fits from a value that was never marked, and this can.
 */

import { act, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { auditAccessibility, formatViolations, tabbableElements } from '../../a11y/audit';
import { HudCore, TOTALS_STRIP_NAME } from './HudCore';
import { HudPanel } from './HudPanel';
import { atStartLine } from '../simulation';
import { simulatedRideSentences } from '../simulated-rider';
import { FRESH_WEEK, startRound } from '../delivery/round';
import { hudOf, startRace } from './lap-race-testing';
import { northCorridor, northRoute } from './street-map-testing';
import { mount, queryAll, type Mounted } from '../../testing/mount';
import { workoutGraphText, type WorkoutGraphInput } from '../../workout/workout-graph';
import { rideTotals } from '../../recording/totals';
import type { StreamChannelValue } from '@onyourleft/store';
import { NO_READING } from './fields';
import { NO_CALORIES_NO_READINGS, NO_CALORIES_SET_INPUTS_SHORT } from '../../detail/CaloriesFact';
import {
  altitudeMetres,
  beatsPerMinute,
  degreesLatitude,
  degreesLongitude,
  expandWorkout,
  geographicPosition,
  gradePercent,
  joules,
  metres,
  metresPerSecond,
  pacerGap,
  POWER_ZONE_LOWER_FRACTIONS,
  routeProfile,
  seconds,
  thresholdShare,
  unixSeconds,
  watts,
  type RecordedSeries,
  type RoutePoint,
} from '@onyourleft/domain';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function route(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 60; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index <= 30 ? index : 60 - index),
    });
  }
  return routeProfile(points);
}

/** The gap handed in throughout: the attempt ten seconds up the road. */
const GAP = pacerGap({
  botDistance: metres(200),
  riderDistance: metres(100),
  referenceSpeed: metresPerSecond(10),
});

/** The classes on the value element of the field with the given label. */
function valueClasses(label: string): string {
  const fields = queryAll(mounted?.container ?? document, '.oyl-hud__field');
  const field = fields.find((each) => each.querySelector('dt')?.textContent === label);
  if (field === undefined) {
    throw new Error(`no HUD field labelled ${label}`);
  }
  return field.querySelector('dd')?.className ?? '';
}

describe('a value that is a word rather than a number (#259)', () => {
  const profile = route();
  const base = {
    profile,
    state: atStartLine(profile),
    cadence: { value: 88, live: true },
    heartRate: { value: 150, live: true },
    onPause: () => undefined,
    onEnd: () => undefined,
    paused: false,
    announcement: '',
  };

  it.each(['beaten', 'level', 'not-beaten'] as const)(
    'marks the settled result (%s) so it is set small enough to fit its track',
    async (outcome) => {
      mounted = await mount(
        <HudPanel {...base} chases={[{ to: 'ghost', gap: GAP, outcome }]} />, //
      );

      expect(valueClasses('Your best')).toContain('oyl-hud__value--word');
    },
  );

  it('leaves a live gap as a number, which is what fits at 2.5 rem', async () => {
    mounted = await mount(<HudPanel {...base} chases={[{ to: 'ghost', gap: GAP }]} />);

    // Two assertions rather than one: the field is there, and it is NOT marked.
    // `not.toContain` alone would pass against a panel that rendered no fields.
    expect(valueClasses('Your best')).toBe('oyl-hud__value');
  });

  it('leaves every other field on the panel a number too', async () => {
    mounted = await mount(<HudPanel {...base} chases={[{ to: 'ghost', gap: GAP }]} />);

    const marked = queryAll(mounted.container, '.oyl-hud__value--word');
    expect(marked).toHaveLength(0);
  });
});

/**
 * The trainer status line, which #373 moved **into** this panel.
 *
 * ⚠️ **jsdom does no layout, so nothing here is a claim about where it is on
 * the screen** — `apps/web/browser/ride.browser.spec.ts` measures that, in the
 * pinned Chromium, in both orientations. What this pins is the wiring and the
 * words: that the prop reaches an element inside `.oyl-hud` rather than
 * anywhere else, that it is above the controls, and that an absent reading
 * renders nothing rather than a nought.
 *
 * It is the assertion that would have caught the regression #373 reports if it
 * had existed: `trainer-wiring.test.tsx` checks the sentence is somewhere in
 * the container, which was true of the placement that put it off screen.
 */
describe('the trainer status line (#373)', () => {
  const profile = route();
  const base = {
    profile,
    state: atStartLine(profile),
    cadence: { value: 88, live: true },
    heartRate: { value: 150, live: true },
    chases: [],
    onPause: () => undefined,
    onEnd: () => undefined,
    paused: false,
    announcement: '',
  };

  it('renders the sentence inside the HUD panel', async () => {
    mounted = await mount(<HudPanel {...base} trainer={{ gradePercent: -3.4, writes: 17 }} />);

    const panel = mounted.container.querySelector('.oyl-hud');
    const line = panel?.querySelector('.oyl-hud__trainer');
    expect(line?.textContent).toBe('Trainer: simulating -3.4% (17 sent)');
  });

  /**
   * ⚠️ The order is the property, not the presence. Above the controls means a
   * rider who reaches *Pause* has passed it — see `fields.ts` §`TrainerLine`.
   * `compareDocumentPosition` rather than an index, because the panel's
   * children are not a flat list of the two.
   */
  it('puts it before the ride controls', async () => {
    mounted = await mount(<HudPanel {...base} trainer={{ gradePercent: 0, writes: 1 }} />);

    const line = mounted.container.querySelector('.oyl-hud__trainer');
    const controls = mounted.container.querySelector('.oyl-hud__controls');
    expect(line).not.toBeNull();
    expect(controls).not.toBeNull();
    expect(
      (line?.compareDocumentPosition(controls as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);
  });

  /**
   * Absent rather than a nought, on `fields.ts` §`NO_READING`'s precedent: a
   * rider with no trainer is not told a gradient of zero was sent to one.
   */
  it('renders nothing at all when no gradient is being asked for', async () => {
    mounted = await mount(<HudPanel {...base} />);

    expect(mounted.container.querySelector('.oyl-hud__trainer')).toBeNull();
    // The control: the panel rendered, so the assertion above is about an
    // absent line rather than an absent panel.
    expect(mounted.container.querySelector('.oyl-hud')).not.toBeNull();
  });
});

/**
 * #423 — four panels where there was one.
 *
 * jsdom lays nothing out, so none of this says where a panel IS; that is
 * `browser/ride.browser.spec.ts`. What it says is what `theme.css` is given to
 * place, because a stylesheet that positions `.oyl-hud__actions` cannot help a
 * control that was rendered somewhere else.
 */
describe('the HUD is four panels (#423)', () => {
  const profile = route();
  const base = {
    profile,
    state: atStartLine(profile),
    cadence: { value: 88, live: true },
    heartRate: { value: 150, live: true },
    chases: [{ to: 'bot' as const, gap: GAP }],
    onPause: () => undefined,
    onEnd: () => undefined,
    paused: false,
    announcement: '',
  };

  function labelsIn(selector: string): (string | null)[] {
    return queryAll(mounted?.container ?? document, `${selector} dt`).map(
      (each) => each.textContent,
    );
  }

  it('renders the two tiers as two lists, in the order there was one', async () => {
    mounted = await mount(<HudPanel {...base} />);

    // #2071: the gradient is the fourth primary reading.
    expect(labelsIn('.oyl-hud__fields--primary')).toEqual([
      'Power',
      'Cadence',
      'Heart rate',
      'Gradient',
    ]);
    expect(labelsIn('.oyl-hud__fields--secondary')).toEqual([
      'Speed',
      'To go',
      'Moving',
      // #2072: the elapsed time and the clock, after the moving time.
      'Ride', // #2382: nothing recorded here, so the ride's own clock
      'Clock',
      // #2076: the ride so far, after the clock and before every gap.
      'Distance',
      'Climbed',
      'Avg power',
      // #2434: the calorie estimate, the ride so far's last.
      'Calories',
      // #2077: the rider's W/kg (no threshold here, so no zone).
      'W/kg',
      'Pacer',
    ]);
    // #2076: marked, so a phone's overlay can leave them out (`theme.css`
    // §"THE RIDE SO FAR").
    expect(labelsIn('.oyl-hud__field--total')).toEqual([
      'Distance',
      'Climbed',
      'Avg power',
      'Calories',
    ]);
    // And *Avg power* by name, which the 4:3 tablet sets in its narrowest
    // track (`theme.css` §"THE RIDE SO FAR AT ARM'S LENGTH").
    expect(labelsIn('.oyl-hud__field--average-power')).toEqual(['Avg power']);
    expect(labelsIn('.oyl-hud__field--distance')).toEqual(['Distance']);
    expect(labelsIn('.oyl-hud__field--climbed')).toEqual(['Climbed']);
    // #2434: and *Calories* by name (`theme.css` §"THE CALORIE ESTIMATE IN
    // THE RIDE SO FAR").
    expect(labelsIn('.oyl-hud__field--calories')).toEqual(['Calories']);
    // Document order is the order a screen reader meets them in, and it is
    // the order `hudReadings` returns: primary first.
    expect(labelsIn('.oyl-hud')).toEqual([
      ...labelsIn('.oyl-hud__fields--primary'),
      ...labelsIn('.oyl-hud__fields--secondary'),
    ]);
  });

  it('marks the room’s readings, and the ones that give way to them on a phone — #1356', async () => {
    mounted = await mount(<HudPanel {...base} room={{ nearby: 2, draft: 20, draftShown: true }} />);

    expect(labelsIn('.oyl-hud__field--room')).toEqual(['Following', 'Nearby', 'Draft']);
    expect(labelsIn('.oyl-hud__field--gives-way')).toEqual(['Pacer']);
    // Still in the secondary list, in #94's order, where a screen reader meets them.
    expect(labelsIn('.oyl-hud__fields--secondary')).toEqual([
      'Speed',
      'To go',
      'Moving',
      'Ride',
      'Clock',
      'Distance',
      'Climbed',
      'Avg power',
      'Calories',
      'W/kg',
      'Pacer',
      'Following',
      'Nearby',
      'Draft',
    ]);
  });

  it('paints every group as a panel, and not the container that spans the world', async () => {
    mounted = await mount(<HudPanel {...base} trainer={{ gradePercent: 1, writes: 1 }} />);

    const panels = queryAll(mounted.container, '.oyl-hud > .oyl-hud__panel');
    expect(panels.map((each) => each.className.replace('oyl-hud__panel ', ''))).toEqual([
      'oyl-hud__fields oyl-hud__fields--primary',
      'oyl-hud__fields oyl-hud__fields--secondary',
      'oyl-hud__route',
      'oyl-hud__actions',
    ]);
    expect(mounted.container.querySelector('.oyl-hud')?.classList.contains('oyl-hud__panel')).toBe(
      false,
    );
  });

  it('keeps the trainer line in the panel the ride controls are in', async () => {
    // ⚠️ #373's whole argument: being able to see the line follows from being
    // able to reach *Pause*. That is only true while they share a panel — two
    // panels are placed independently, and one of them can be clipped.
    mounted = await mount(<HudPanel {...base} trainer={{ gradePercent: 1, writes: 1 }} />);

    const actions = mounted.container.querySelector('.oyl-hud__actions');
    expect(actions?.querySelector('.oyl-hud__trainer')).not.toBeNull();
    expect(queryAll(actions ?? document, 'button').map((each) => each.textContent)).toEqual([
      'Pause',
      'End ride',
      // #1482: the touch lock, in the same row.
      'Lock',
    ]);
  });

  it('puts the strip and the plan view in one panel', async () => {
    mounted = await mount(<HudPanel {...base} />);

    const routePanel = mounted.container.querySelector('.oyl-hud__route');
    expect(routePanel?.querySelector('.oyl-hud__profile-svg')).not.toBeNull();
    expect(routePanel?.querySelector('.oyl-hud__plan-svg')).not.toBeNull();
  });

  it('renders a notice in its own slot, after everything else', async () => {
    mounted = await mount(<HudPanel {...base} notices={<p id="said">Trainer lost</p>} />);

    const slot = mounted.container.querySelector('.oyl-hud > .oyl-hud__notices');
    expect(slot?.querySelector('#said')?.textContent).toBe('Trainer lost');
    expect(mounted.container.querySelector('.oyl-hud')?.lastElementChild).toBe(slot);
  });

  it.each([
    ['nothing', undefined],
    ['a list of nothing', [undefined, undefined]],
    ['a false conditional', false],
  ])('renders no slot when it is handed %s', async (_, notices) => {
    // ⚠️ `GameView` builds its notices as an array of conditionals, so "nothing
    // to say" arrives as `[undefined, undefined]`. An empty grid item across
    // the middle of the stage is the one part of the screen the layout exists
    // to keep clear.
    mounted = await mount(<HudPanel {...base} notices={notices} />);

    expect(mounted.container.querySelector('.oyl-hud__notices')).toBeNull();
    expect(mounted.container.querySelector('.oyl-hud')).not.toBeNull();
  });

  describe('the lap that has just ended — #1312', () => {
    const lap = <p id="lap">Lap 2: 9:52 · 201 W.</p>;
    const standing = (expanded: boolean) => ({
      content: <p id="road">The road is not reaching your trainer</p>,
      expanded,
      onToggle: () => undefined,
    });

    it('takes the notice cell when nothing else has it', async () => {
      mounted = await mount(<HudPanel {...base} lapNotice={lap} />);

      const slot = mounted.container.querySelector('.oyl-hud > .oyl-hud__notices');
      expect(slot?.querySelector('#lap')?.textContent).toBe('Lap 2: 9:52 · 201 W.');
      expect(slot?.classList.contains('oyl-hud__notices--collapsed')).toBe(false);
    });

    it('gives way to a fault or a safety notice: the cell holds one notice well and two badly', async () => {
      mounted = await mount(
        <HudPanel
          {...base}
          notices={[
            <p key="fault" id="said">
              Trainer lost
            </p>,
          ]}
          lapNotice={lap}
        />,
      );

      expect(mounted.container.querySelector('#said')).not.toBeNull();
      expect(mounted.container.querySelector('#lap')).toBeNull();
    });

    it('gives way to a standing notice that is open, and not to one put away', async () => {
      mounted = await mount(<HudPanel {...base} standingNotice={standing(true)} lapNotice={lap} />);
      expect(mounted.container.querySelector('#lap')).toBeNull();
      mounted.unmount();

      mounted = await mount(
        <HudPanel {...base} standingNotice={standing(false)} lapNotice={lap} />,
      );
      expect(mounted.container.querySelector('#lap')).not.toBeNull();
      // The cell is open for the lap, and the road notice is still clipped in it.
      const slot = mounted.container.querySelector('.oyl-hud__notices');
      expect(slot?.classList.contains('oyl-hud__notices--collapsed')).toBe(false);
      expect(mounted.container.querySelector('#road')?.parentElement?.className).toBe(
        'oyl-visually-hidden',
      );
    });

    it('renders no slot when there is no lap to show', async () => {
      mounted = await mount(<HudPanel {...base} lapNotice={undefined} />);

      expect(mounted.container.querySelector('.oyl-hud__notices')).toBeNull();
    });
  });
});

/**
 * #1307: the running workout's graph on the HUD. ⚠️ jsdom does no layout:
 * that the strip covers no more of the rider than the route plan did is
 * measured in `browser/ride.browser.spec.ts`. What this pins is which of the
 * two is drawn, where, and from what.
 */
describe('the running workout’s graph on the HUD — #1307', () => {
  const profile = route();
  const base = {
    profile,
    state: atStartLine(profile),
    cadence: { value: 88, live: true },
    heartRate: { value: 150, live: true },
    onPause: () => undefined,
    onEnd: () => undefined,
    paused: false,
    announcement: '',
  };
  const workout: WorkoutGraphInput = {
    elapsedSeconds: 150,
    timeline: expandWorkout({
      name: 'test',
      blocks: [{ kind: 'steady', seconds: seconds(600), target: thresholdShare(0.6) }],
    }),
    holdingWatts: 150,
    thresholdWatts: 250,
    trace: [{ at: 150, target: 150, power: 152, heartRate: undefined, range: undefined }],
  };

  it('draws the route plan, and no graph, on a ride with no workout', async () => {
    mounted = await mount(<HudPanel {...base} />);
    expect(
      queryAll(mounted.container, '.oyl-hud__route [data-testid="oyl-hud-plan-here"]'),
    ).toHaveLength(1);
    expect(queryAll(mounted.container, '[data-oyl-workout-graph]')).toHaveLength(0);
  });

  it('draws the workout in the route plan’s place, at its size, inside the route panel', async () => {
    mounted = await mount(<HudPanel {...base} workout={workout} />);
    const graphs = queryAll(mounted.container, '.oyl-hud__route > [data-oyl-workout-graph="hud"]');
    expect(graphs).toHaveLength(1);
    const strip = graphs[0];
    // The route plan's own sizing rule, so the panel is the height it was.
    expect(strip?.classList.contains('oyl-hud__plan-svg')).toBe(true);
    expect(strip?.getAttribute('role')).toBe('img');
    expect(strip?.getAttribute('aria-label')).toBe(workoutGraphText(workout));
    expect(strip?.querySelector('.oyl-workout-strip__now')?.getAttribute('data-fraction')).toBe(
      '0.2500',
    );
    // One lane — power against the target, outside a hold — and one line of text.
    expect(strip?.getAttribute('data-oyl-lane')).toBe('power');
    expect(strip?.querySelector('p')?.textContent).toBe('Target 150 W · 7:30 left in block');
    // In its place, not beside it: one thing that size in the panel.
    expect(queryAll(mounted.container, '[data-testid="oyl-hud-plan-here"]')).toHaveLength(0);
    expect(queryAll(mounted.container, '.oyl-hud__plan-svg')).toHaveLength(1);
    // The strip has no key: the HUD has no room for a paragraph.
    expect(queryAll(mounted.container, '.oyl-workout-graph__key')).toHaveLength(0);
    // The elevation strip above it stays.
    expect(queryAll(mounted.container, '.oyl-hud__route .oyl-hud__profile-svg')).toHaveLength(1);
  });
});

/**
 * #2072 — the elapsed time and the time of day beside the moving time, read
 * off the rendered HUD.
 */
describe('the elapsed time and the clock beside the moving time — #2072', () => {
  const profile = route();
  const base = {
    profile,
    state: atStartLine(profile),
    cadence: { value: 88, live: true },
    heartRate: { value: 150, live: true },
    chases: [],
    onPause: () => undefined,
    onEnd: () => undefined,
    paused: false,
    announcement: '',
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  /** The `dd` under the `dt` reading `label`, and the classes of its field. */
  function field(label: string): { readonly value: string; readonly classes: string } {
    const row = queryAll(mounted?.container ?? document, '.oyl-hud__field').find(
      (each) => each.querySelector('dt')?.textContent === label,
    );
    return {
      value: row?.querySelector('dd')?.textContent ?? '',
      classes: row?.className ?? '',
    };
  }

  it('shows the device’s time of day, HH:MM, and moves it when the minute turns', async () => {
    vi.useFakeTimers();
    // 07:05:30 local, so the next minute is thirty seconds away.
    vi.setSystemTime(new Date(2026, 10, 4, 7, 5, 30));
    mounted = await mount(<HudPanel {...base} movingSeconds={65} elapsedSeconds={125} />);

    expect(field('Clock').value).toBe('07:05');
    expect(field('Clock').classes).toContain('oyl-hud__field--clock');

    await act(async () => {
      vi.advanceTimersByTime(29_000);
      await Promise.resolve();
    });
    expect(field('Clock').value).toBe('07:05');

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
    });
    expect(field('Clock').value).toBe('07:06');
  });

  it('labels the two ride times Elapsed and Moving, each its own figure', async () => {
    mounted = await mount(<HudPanel {...base} movingSeconds={65} elapsedSeconds={125} />);

    expect(field('Moving').value).toBe('0:01:05');
    expect(field('Elapsed').value).toBe('0:02:05');
    expect(field('Elapsed').classes).toContain('oyl-hud__field--elapsed');
    // In the secondary list, after Moving and before the clock — where a
    // screen reader meets them, whatever the layout draws.
    const labels = queryAll(mounted.container, '.oyl-hud__fields--secondary dt').map(
      (each) => each.textContent,
    );
    expect(labels.indexOf('Elapsed')).toBe(labels.indexOf('Moving') + 1);
    expect(labels.indexOf('Clock')).toBe(labels.indexOf('Elapsed') + 1);
  });

  it('shows a dash for the moving time and the ride’s own clock where nothing is being recorded — #2382', async () => {
    mounted = await mount(<HudPanel {...base} state={{ ...base.state, elapsed: seconds(754) }} />);

    expect(field('Moving').value).toBe('—');
    // #2382: not a dash, and not *Elapsed*: the ride's clock, under its own
    // label, in the elapsed field's place.
    expect(field('Ride').value).toBe('0:12:34');
    expect(field('Ride').classes).toContain('oyl-hud__field--elapsed');
    expect(queryAll(mounted.container, 'dt').map((each) => each.textContent)).not.toContain(
      'Elapsed',
    );
  });

  it('leaves the demo’s HUD with neither: no clock handed in, and its elapsed time left out', async () => {
    mounted = await mount(
      <HudCore
        {...base}
        movingSeconds={65}
        elapsedSeconds={125}
        units="metric"
        touchLock={false}
        labels={{ resume: 'Play', end: 'Stop' }}
        routeFigure={null}
        withoutElapsed
      />,
    );

    expect(field('Moving').value).toBe('0:01:05');
    expect(queryAll(mounted.container, '.oyl-hud__field--elapsed')).toEqual([]);
    expect(queryAll(mounted.container, '.oyl-hud__field--clock')).toEqual([]);
  });
});

/**
 * #2071 — the gradient, read off the rendered PRIMARY row: signed, with its
 * unit, and a slope glyph that follows the sign.
 */
describe('the gradient on the primary row — #2071', () => {
  const profile = route();
  const at = (grade: number) => ({
    profile,
    state: { ...atStartLine(profile), grade: gradePercent(grade) },
    cadence: { value: 88, live: true },
    heartRate: { value: 150, live: true },
    chases: [],
    onPause: () => undefined,
    onEnd: () => undefined,
    paused: false,
    announcement: '',
  });

  /** The gradient's field in the primary list, as a rider and a screen reader meet it. */
  function primaryGradient(): Element | undefined {
    return queryAll(
      mounted?.container ?? document,
      '.oyl-hud__fields--primary .oyl-hud__field',
    ).find((each) => each.querySelector('dt')?.textContent === 'Gradient');
  }

  it('reads +4.5 % on a climb and -2.0 % on a descent', async () => {
    mounted = await mount(<HudPanel {...at(4.5)} />);
    expect(primaryGradient()?.querySelector('dd')?.textContent).toBe('+4.5 %');
    expect(
      primaryGradient()?.querySelector('[data-oyl-slope]')?.getAttribute('data-oyl-slope'),
    ).toBe('up');
    mounted.unmount();

    mounted = await mount(<HudPanel {...at(-2)} />);
    expect(primaryGradient()?.querySelector('dd')?.textContent).toBe('-2.0 %');
    expect(
      primaryGradient()?.querySelector('[data-oyl-slope]')?.getAttribute('data-oyl-slope'),
    ).toBe('down');
  });

  /** How far the drawn stroke climbs from left to right, in its box's units (y runs down). */
  function rise(): number {
    const line = primaryGradient()?.querySelector('.oyl-hud__slope line');
    return Number(line?.getAttribute('y1')) - Number(line?.getAttribute('y2'));
  }

  it('draws a glyph whose angle follows the sign: rising, falling, flat', async () => {
    mounted = await mount(<HudPanel {...at(4.5)} />);
    expect(rise()).toBeGreaterThan(0);
    mounted.unmount();
    mounted = await mount(<HudPanel {...at(-2)} />);
    expect(rise()).toBeLessThan(0);
    mounted.unmount();
    mounted = await mount(<HudPanel {...at(0)} />);
    expect(rise()).toBe(0);
  });

  it('sets the sign apart so the stylesheet can size it, and hides the glyph from a screen reader', async () => {
    mounted = await mount(<HudPanel {...at(4.5)} />);
    const value = primaryGradient()?.querySelector('dd');
    expect(value?.querySelector('.oyl-hud__sign')?.textContent).toBe('+');
    expect(value?.querySelector('.oyl-hud__slope')?.getAttribute('aria-hidden')).toBe('true');
    // A descent's minus is set apart too.
    mounted.unmount();
    mounted = await mount(<HudPanel {...at(-3.2)} />);
    expect(primaryGradient()?.querySelector('.oyl-hud__sign')?.textContent).toBe('-');
    // Level road: no sign at all, and a flat glyph.
    mounted.unmount();
    mounted = await mount(<HudPanel {...at(0.02)} />);
    expect(primaryGradient()?.querySelector('dd')?.textContent).toBe('0.0 %');
    expect(primaryGradient()?.querySelector('.oyl-hud__sign')).toBeNull();
    expect(
      primaryGradient()?.querySelector('[data-oyl-slope]')?.getAttribute('data-oyl-slope'),
    ).toBe('level');
  });

  it('names the primary panel for its four readings', async () => {
    mounted = await mount(<HudPanel {...at(1)} />);
    expect(
      mounted.container.querySelector('.oyl-hud__fields--primary')?.getAttribute('aria-label'),
    ).toBe('Power, cadence, heart rate and gradient');
  });
});

/**
 * #2291 — the gradient's digits in their grade band's colour, and a slope
 * glyph steeper for a steeper band, read off the rendered primary row. The
 * class is the wire; `hud-value-size.test.ts` holds the rule each class
 * names, and `ride.browser.spec.ts` reads the colour and size Chromium paints.
 */
describe('the gradient in its band’s colour — #2291', () => {
  const profile = route();
  const at = (grade: number) => ({
    profile,
    state: { ...atStartLine(profile), grade: gradePercent(grade) },
    cadence: { value: 88, live: true },
    heartRate: { value: 150, live: true },
    chases: [],
    onPause: () => undefined,
    onEnd: () => undefined,
    paused: false,
    announcement: '',
  });

  function primaryGradient(): Element | undefined {
    return queryAll(
      mounted?.container ?? document,
      '.oyl-hud__fields--primary .oyl-hud__field',
    ).find((each) => each.querySelector('dt')?.textContent === 'Gradient');
  }

  async function bandAt(grade: number): Promise<string | null | undefined> {
    mounted?.unmount();
    mounted = await mount(<HudPanel {...at(grade)} />);
    const field = primaryGradient();
    const band = field?.getAttribute('data-grade-band');
    expect(field?.classList.contains(`oyl-hud__field--grade-${band ?? ''}`)).toBe(true);
    return band;
  }

  it('bands the field by the grade it shows, through the road ahead’s five bands', async () => {
    expect(await bandAt(-6)).toBe('descent');
    expect(await bandAt(-2)).toBe('flat');
    expect(await bandAt(0)).toBe('flat');
    expect(await bandAt(4.5)).toBe('climb');
    expect(await bandAt(7)).toBe('steep');
    expect(await bandAt(12)).toBe('wall');
    // 2.96 SHOWS +3.0, and is coloured as the climb it says it is.
    expect(await bandAt(2.96)).toBe('climb');
  });

  it('sets the digits apart from the sign, so the sign keeps its ink', async () => {
    mounted = await mount(<HudPanel {...at(4.5)} />);
    const value = primaryGradient()?.querySelector('dd');
    expect(value?.querySelector('.oyl-hud__digits')?.textContent).toBe('4.5');
    expect(value?.querySelector('.oyl-hud__digits .oyl-hud__sign')).toBeNull();
    // What a screen reader reads is the value as it was.
    expect(value?.textContent).toBe('+4.5 %');
    mounted.unmount();
    mounted = await mount(<HudPanel {...at(0)} />);
    expect(primaryGradient()?.querySelector('.oyl-hud__digits')?.textContent).toBe('0.0');
  });

  it('colours no other reading', async () => {
    mounted = await mount(<HudPanel {...at(4.5)} />);
    expect(queryAll(mounted.container, '.oyl-hud__digits')).toHaveLength(1);
    expect(queryAll(mounted.container, '[data-grade-band]')).toHaveLength(1);
  });

  /** How far the drawn stroke climbs from left to right, in its box's units. */
  async function riseAt(grade: number): Promise<number> {
    mounted?.unmount();
    mounted = await mount(<HudPanel {...at(grade)} />);
    const line = primaryGradient()?.querySelector('.oyl-hud__slope line');
    return Number(line?.getAttribute('y1')) - Number(line?.getAttribute('y2'));
  }

  it('draws the glyph steeper for a steeper band, so the band is a shape as well', async () => {
    const flat = await riseAt(1.5);
    const climbing = await riseAt(4.5);
    const steep = await riseAt(7);
    const wall = await riseAt(12);
    expect(flat).toBeGreaterThan(0);
    expect(climbing).toBeGreaterThan(flat);
    expect(steep).toBeGreaterThan(climbing);
    expect(wall).toBeGreaterThan(steep);
    // A descent falls, and further than a flat stretch that dips.
    expect(await riseAt(-6)).toBeLessThan(await riseAt(-1.5));
    expect(await riseAt(-1.5)).toBeLessThan(0);
  });
});

/** #2077: the zone indicator as the HUD draws it — the swatch and the bar. */
describe('the zone indicator on the HUD — #2077', () => {
  const profile = route();
  const state = atStartLine(profile);
  const base = {
    profile,
    state: { ...state, input: { power: watts(342), live: true } },
    cadence: { value: 88, live: true },
    heartRate: { value: 150, live: true },
    onPause: () => undefined,
    onEnd: () => undefined,
    paused: false,
    announcement: '',
    thresholdPower: watts(250),
    powerZoneTime: {
      perZone: [0, 600, 0, 300, 100, 0, 0].map((spent) => seconds(spent)),
      covered: seconds(1000),
    },
  };

  it('draws the number beside its zone’s swatch, the name under it, and the time in each zone', async () => {
    mounted = await mount(<HudPanel {...base} />);
    const field = mounted.container.querySelector(
      '.oyl-hud__field--effort:has(.oyl-hud__zone-bar)',
    );
    expect(field?.querySelector('dt')?.textContent).toBe('Zone');
    // The number and the name, in words — never the colour alone.
    expect(field?.querySelector('dd')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      '6 Anaerobic',
    );
    const swatch = field?.querySelector('.oyl-hud__zone-swatch');
    expect(swatch?.classList).toContain('oyl-hud__zone-swatch--6');
    expect(swatch?.getAttribute('aria-hidden')).toBe('true');
    const bar = field?.querySelector('.oyl-hud__zone-bar');
    expect(bar?.getAttribute('aria-hidden')).toBe('true');
    expect(bar?.getAttribute('data-oyl-zone-shares')).toBe(
      '0.000,0.600,0.000,0.300,0.100,0.000,0.000',
    );
    // A segment only for a zone the ride has spent time in, each its own zone's.
    expect(
      queryAll(bar ?? document, '.oyl-hud__zone-bar-part').map((part) => [
        part.getAttribute('class'),
        part.getAttribute('width'),
      ]),
    ).toEqual([
      ['oyl-hud__zone-bar-part oyl-hud__zone-bar-part--2', '60'],
      ['oyl-hud__zone-bar-part oyl-hud__zone-bar-part--4', '30'],
      ['oyl-hud__zone-bar-part oyl-hud__zone-bar-part--5', '10'],
    ]);
  });

  it('draws no swatch with the power reading lost', async () => {
    mounted = await mount(
      <HudPanel {...base} state={{ ...state, input: { power: watts(342), live: false } }} />,
    );
    expect(mounted.container.querySelector('.oyl-hud__zone-swatch')).toBeNull();
  });
});

/**
 * #2384: the zone strip — every zone a segment, the zone the indicator says
 * lit, across every boundary of the rider's threshold, read off the HUD the
 * ride mounts.
 */
describe('the zone strip on the HUD — #2384', () => {
  const profile = route();
  const state = atStartLine(profile);
  const threshold = 250;
  const base = {
    profile,
    state,
    cadence: { value: 88, live: true },
    heartRate: { value: 150, live: true },
    onPause: () => undefined,
    onEnd: () => undefined,
    paused: false,
    announcement: '',
    thresholdPower: watts(threshold),
  };

  /** The zone field's number, and what the strip lights and draws, at a power. */
  async function at(
    power: number,
    live = true,
  ): Promise<{ readonly says: string; readonly lit: string[]; readonly tall: string[] }> {
    mounted?.unmount();
    mounted = await mount(
      <HudPanel {...base} state={{ ...state, input: { power: watts(power), live } }} />,
    );
    const field = mounted.container.querySelector(
      '.oyl-hud__field--effort:has(.oyl-hud__zone-strip)',
    );
    const segments = queryAll(field ?? document, '.oyl-hud__zone-strip-segment');
    expect(segments).toHaveLength(7);
    const zoneOf = (each: Element): string =>
      /oyl-hud__zone-strip-segment--(\d)/.exec(each.getAttribute('class') ?? '')?.[1] ?? '?';
    return {
      // The number in the strip's own row, the zone field's reading.
      says: field?.querySelector('.oyl-hud__zone-now')?.textContent ?? '',
      lit: segments
        .filter((each) => each.classList.contains('oyl-hud__zone-strip-segment--lit'))
        .map(zoneOf),
      // The shape, not the colour: the lit segment is the strip's full height.
      tall: segments.filter((each) => each.getAttribute('height') === '10').map(zoneOf),
    };
  }

  it('lights the zone the zone field computes, on each side of every boundary', async () => {
    expect(await at(0)).toEqual({ says: '1', lit: ['1'], tall: ['1'] });
    // Each zone's floor, inclusive, and half a watt under it (the zone below).
    for (const [index, fraction] of POWER_ZONE_LOWER_FRACTIONS.entries()) {
      if (index === 0) continue;
      const floor = fraction * threshold;
      const below = String(index);
      const above = String(index + 1);
      expect(await at(floor - 0.5), `${String(floor - 0.5)} W`).toEqual({
        says: below,
        lit: [below],
        tall: [below],
      });
      expect(await at(floor), `${String(floor)} W`).toEqual({
        says: above,
        lit: [above],
        tall: [above],
      });
    }
    // And far above the top floor, still zone 7.
    expect(await at(2000)).toEqual({ says: '7', lit: ['7'], tall: ['7'] });
  });

  it('says the zone in words as its name, and leaves the field reading as it did', async () => {
    await at(342);
    const strip = mounted?.container.querySelector('.oyl-hud__zone-strip');
    expect(strip?.getAttribute('role')).toBe('img');
    expect(strip?.getAttribute('aria-label')).toBe('Zone 6 of 7: Anaerobic');
    expect(strip?.textContent).toBe('');
    expect(
      mounted?.container
        .querySelector('.oyl-hud__field--effort:has(.oyl-hud__zone-strip) dd')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim(),
    ).toBe('6 Anaerobic');
  });

  it('lights nothing, and says so, with the power reading lost', async () => {
    const seen = await at(342, false);
    expect(seen.lit).toEqual([]);
    expect(seen.tall).toEqual([]);
    expect(
      mounted?.container.querySelector('.oyl-hud__zone-strip')?.getAttribute('aria-label'),
    ).toBe('No zone: no power reading');
  });

  it('is not drawn at all with no threshold set, as the zone field is not', async () => {
    mounted = await mount(
      <HudPanel
        {...base}
        thresholdPower={undefined}
        state={{ ...state, input: { power: watts(342), live: true } }}
      />,
    );
    expect(mounted.container.querySelector('.oyl-hud__zone-strip')).toBeNull();
    expect(mounted.container.querySelector('.oyl-hud__zone-bar')).toBeNull();
  });
});

/** #2079: a race's standings, turned off by the rider, and the text size's class. */
describe('the rider’s HUD layout — #2079', () => {
  const profile = route();
  const base = {
    profile,
    state: atStartLine(profile),
    cadence: { value: 88, live: true },
    heartRate: { value: 150, live: true },
    onPause: () => undefined,
    onEnd: () => undefined,
    paused: false,
    announcement: '',
    room: { nearby: 2 },
    standings: {
      place: 1,
      of: 2,
      lines: [
        {
          riderId: 3,
          place: 1,
          who: 'You',
          gap: '',
          figure: '3.5 W/kg',
          flagged: false,
          you: true,
        },
        {
          riderId: 7,
          place: 2,
          who: 'Bea',
          gap: '+4 s',
          figure: '3.1 W/kg',
          flagged: false,
          you: false,
        },
      ],
    },
  };

  it('draws a race’s standings unless the rider turned them off', async () => {
    mounted = await mount(<HudPanel {...base} />);
    expect(mounted.container.querySelector('.oyl-hud__standings')).not.toBeNull();
    mounted.unmount();
    mounted = await mount(
      <HudPanel {...base} layout={{ hidden: ['standings'], textSize: 'normal' }} />,
    );
    expect(mounted.container.querySelector('.oyl-hud__standings')).toBeNull();
  });

  /**
   * PR #2235's review: with the readings turned off, a room's, a Delivery
   * round's and a lap race's own readings stay, beside the ride's three
   * times (`HudCore.tsx` §`keptWithReadingsHidden`). Each mode is drawn whole
   * first, so the readings it marks as its own are read rather than listed.
   */
  const secondaryLabels = (): (string | null)[] =>
    queryAll(mounted?.container ?? document, '.oyl-hud__fields--secondary dt').map(
      (each) => each.textContent,
    );
  const modes = [
    ['a room', '.oyl-hud__field--room', {}],
    [
      'a Delivery round',
      '.oyl-hud__field--delivery',
      {
        room: undefined,
        standings: undefined,
        delivery: { round: startRound(8), week: FRESH_WEEK, score: 0, next: undefined },
      },
    ],
    [
      'a lap race',
      '.oyl-hud__field--lap-race',
      { room: undefined, standings: undefined, lapRace: hudOf(startRace({ laps: 3 })) },
    ],
  ] as const;
  for (const [mode, marked, input] of modes) {
    it(`keeps ${mode}'s own readings, and the times, with the readings turned off`, async () => {
      mounted = await mount(<HudPanel {...base} {...input} />);
      const own = queryAll(mounted.container, `${marked} dt`).map((each) => each.textContent);
      expect(own.length).toBeGreaterThan(0);
      mounted.unmount();
      mounted = await mount(
        <HudPanel {...base} {...input} layout={{ hidden: ['readings'], textSize: 'normal' }} />,
      );
      expect(secondaryLabels()).toEqual(['Moving', 'Ride', 'Clock', ...own]);
    });
  }

  it('carries the text size as a class the stylesheet reads, and none at the normal size', async () => {
    mounted = await mount(<HudPanel {...base} layout={{ hidden: [], textSize: 'extra-large' }} />);
    expect(mounted.container.querySelector('.oyl-hud')?.className).toBe(
      'oyl-hud oyl-hud--text-extra-large',
    );
    mounted.unmount();
    mounted = await mount(<HudPanel {...base} />);
    expect(mounted.container.querySelector('.oyl-hud')?.className).toBe('oyl-hud');
  });
});

/** #2080: a loop's lap splits, where a race's standings are, and swapped with them. */
describe('the lap splits panel — #2080', () => {
  /** A level loop, out and back, so its two ends meet. */
  const loop = (() => {
    const points: RoutePoint[] = [];
    for (let index = 0; index <= 8; index += 1) {
      const out = index <= 4 ? index : 8 - index;
      points.push({
        position: geographicPosition(
          degreesLatitude(51.5 + (out * 100) / 111_320),
          degreesLongitude(-0.12),
        ),
        elevation: altitudeMetres(60),
      });
    }
    return routeProfile(points, { loop: true });
  })();
  const laps = [
    {
      startedAt: unixSeconds(1_800_000_000),
      elapsedTime: seconds(312),
      movingTime: seconds(312),
      distance: loop.totalDistance,
      averagePower: watts(205),
    },
    {
      startedAt: unixSeconds(1_800_000_312),
      elapsedTime: seconds(298),
      movingTime: seconds(298),
      distance: loop.totalDistance,
      averagePower: watts(231),
    },
  ];
  const standings = {
    place: 1,
    of: 2,
    lines: [
      { riderId: 3, place: 1, who: 'You', gap: '', figure: '3.5 W/kg', flagged: false, you: true },
      {
        riderId: 7,
        place: 2,
        who: 'Bea',
        gap: '+4 s',
        figure: '3.1 W/kg',
        flagged: false,
        you: false,
      },
    ],
  };
  const base = {
    state: atStartLine(loop),
    cadence: { value: 88, live: true },
    heartRate: { value: 150, live: true },
    onPause: () => undefined,
    onEnd: () => undefined,
    paused: false,
    announcement: '',
  };
  /** The panel's rows as read: each row's cells, its label first. */
  const rows = (): string[][] =>
    queryAll(mounted?.container ?? document, '.oyl-hud__laps-row').map((row) =>
      [...row.querySelectorAll('.oyl-hud__laps-label, .oyl-hud__laps-value')].map(
        (cell) => cell.textContent ?? '',
      ),
    );
  const button = (name: string): HTMLButtonElement | undefined =>
    queryAll(mounted?.container ?? document, 'button').find(
      (each): each is HTMLButtonElement => each.textContent === name,
    );

  it('draws the lap in progress, the last lap and the best on a loop', async () => {
    mounted = await mount(<HudPanel {...base} profile={loop} laps={laps} lapSeconds={75} />);
    expect(mounted.container.querySelector('.oyl-hud__laps')?.getAttribute('aria-label')).toBe(
      'Lap splits',
    );
    expect(rows()).toEqual([
      ['Now', '3', '1:15', '—'],
      ['Last', '2', '4:58', '231 W'],
      ['Best', '2', '4:58', '231 W'],
    ]);
    // What a screen reader hears, row by row: the column headings are drawn
    // `aria-hidden`, so each figure must say its own (PR #2248's review).
    expect(
      queryAll(mounted.container, '.oyl-hud__laps-row').map((row) =>
        (row.textContent ?? '').replace(/\s+/g, ' ').trim(),
      ),
    ).toEqual([
      'Now Lap 3 Time 1:15 Avg power —',
      'Last Lap 2 Time 4:58 Avg power 231 W',
      'Best Lap 2 Time 4:58 Avg power 231 W',
    ]);
    expect(
      mounted.container.querySelector('.oyl-hud__laps-head')?.getAttribute('aria-hidden'),
    ).toBe('true');
    // Not a live region: it changes every second.
    expect(mounted.container.querySelector('.oyl-hud__laps [aria-live]')).toBeNull();
    // With no race there is nothing to swap with.
    expect(button('Show standings')).toBeUndefined();
  });

  it('is not drawn on a point-to-point route', async () => {
    const profile = route();
    mounted = await mount(
      <HudPanel
        {...base}
        state={atStartLine(profile)}
        profile={profile}
        laps={laps}
        lapSeconds={75}
      />,
    );
    expect(mounted.container.querySelector('.oyl-hud__laps')).toBeNull();
  });

  it('swaps with a race’s standings, standings first, and keeps the focus on the swap', async () => {
    mounted = await mount(
      <HudPanel {...base} profile={loop} laps={laps} lapSeconds={75} standings={standings} />,
    );
    expect(mounted.container.querySelector('.oyl-hud__standings')).not.toBeNull();
    expect(mounted.container.querySelector('.oyl-hud__laps')).toBeNull();

    await act(async () => {
      button('Show laps')?.click();
      await Promise.resolve();
    });
    expect(mounted.container.querySelector('.oyl-hud__standings')).toBeNull();
    expect(rows()[1]).toEqual(['Last', '2', '4:58', '231 W']);
    expect(document.activeElement).toBe(button('Show standings'));

    await act(async () => {
      button('Show standings')?.click();
      await Promise.resolve();
    });
    expect(mounted.container.querySelector('.oyl-hud__laps')).toBeNull();
    expect(mounted.container.querySelector('.oyl-hud__standings')).not.toBeNull();
    expect(document.activeElement).toBe(button('Show laps'));
  });

  it('takes the standings’ place alone when the rider turned the standings off', async () => {
    mounted = await mount(
      <HudPanel
        {...base}
        profile={loop}
        laps={laps}
        lapSeconds={75}
        standings={standings}
        layout={{ hidden: ['standings'], textSize: 'normal' }}
      />,
    );
    expect(mounted.container.querySelector('.oyl-hud__standings')).toBeNull();
    expect(mounted.container.querySelector('.oyl-hud__laps')).not.toBeNull();
    expect(button('Show standings')).toBeUndefined();
  });

  /**
   * PR #2248's review: the panel was a `<table>` outside a scroll region, the
   * a11y gate's `table-in-scroll-region`, and no audited route rides a loop.
   * So the gate's own audit runs over the HUD here, with the splits drawn,
   * alone and in a race with the swap.
   */
  it('audits clean, alone and beside a race’s standings', async () => {
    // In the page's one `main`, under its one `h1`, as the shell draws a ride.
    const onAPage = (hud: JSX.Element): JSX.Element => (
      <main>
        <h1>Ride</h1>
        {hud}
      </main>
    );
    // A HUD panel adds no tab stop to a ride: the same HUD with no laps handed
    // to it draws no splits, and has exactly as many tab stops.
    mounted = await mount(onAPage(<HudPanel {...base} profile={loop} lapSeconds={75} />));
    expect(mounted.container.querySelector('.oyl-hud__laps')).toBeNull();
    const withoutSplits = tabbableElements(document).length;
    mounted.unmount();
    mounted = await mount(
      onAPage(<HudPanel {...base} profile={loop} laps={laps} lapSeconds={75} />),
    );
    expect(mounted.container.querySelector('.oyl-hud__laps')).not.toBeNull();
    expect(tabbableElements(document)).toHaveLength(withoutSplits);
    const alone = auditAccessibility(document);
    expect(alone, formatViolations(alone)).toEqual([]);
    mounted.unmount();
    mounted = await mount(
      onAPage(
        <HudPanel {...base} profile={loop} laps={laps} lapSeconds={75} standings={standings} />,
      ),
    );
    const standingsShown = auditAccessibility(document);
    expect(standingsShown, formatViolations(standingsShown)).toEqual([]);
    // The swap is one button either way round: swapping adds no tab stop
    // (the owner's ruling of 2026-11-06, #2034).
    const withStandings = tabbableElements(document).length;
    await act(async () => {
      button('Show laps')?.click();
      await Promise.resolve();
    });
    expect(mounted.container.querySelector('.oyl-hud__laps')).not.toBeNull();
    const splitsShown = auditAccessibility(document);
    expect(splitsShown, formatViolations(splitsShown)).toEqual([]);
    expect(tabbableElements(document)).toHaveLength(withStandings);
    expect(
      tabbableElements(document).filter((each) => each.classList.contains('oyl-hud__swap')),
    ).toHaveLength(1);
  });
});

/**
 * #2383: the focus arrangement, read off the rendered HUD — the readout in
 * place of the two tiers, its seven readings in their order, the same figures
 * the full HUD shows, and the full HUD kept on a ride with a mode of its own.
 */
describe('the focus readout — #2383', () => {
  const profile = route();
  const base = {
    profile,
    state: {
      ...atStartLine(profile),
      elapsed: seconds(30),
      input: { power: watts(250), live: true },
    },
    cadence: { value: 88, live: true },
    heartRate: { value: 150, live: true },
    onPause: () => undefined,
    onEnd: () => undefined,
    paused: false,
    announcement: '',
    elapsedSeconds: 754,
    movingSeconds: 700,
    rideTotals: { distance: metres(12_345), climbed: metres(80), averagePower: watts(212) },
  };
  const focus = { hidden: [], textSize: 'normal', arrangement: 'focus' } as const;
  const labelsIn = (selector: string): (string | null)[] =>
    queryAll(mounted?.container ?? document, `${selector} dt`).map((each) => each.textContent);
  const valueOf = (label: string): string => {
    const field = queryAll(mounted?.container ?? document, '.oyl-hud__field').find(
      (each) => each.querySelector('dt')?.textContent === label,
    );
    return field?.querySelector('dd')?.textContent ?? '';
  };

  it('draws one readout in place of the two tiers, its readings in their order', async () => {
    mounted = await mount(<HudPanel {...base} layout={focus} />);
    expect(mounted.container.querySelector('.oyl-hud')?.classList).toContain('oyl-hud--focus');
    expect(mounted.container.querySelector('.oyl-hud__fields--primary')).toBeNull();
    expect(mounted.container.querySelector('.oyl-hud__fields--secondary')).toBeNull();
    expect(labelsIn('.oyl-hud__focus-main')).toEqual(['Power', 'Cadence', 'Heart rate']);
    expect(labelsIn('.oyl-hud__focus-more')).toEqual(['Speed', 'Avg power', 'Distance', 'Elapsed']);
    // Every label in the HUD is one of the readout's: nothing else is drawn.
    expect(labelsIn('.oyl-hud')).toEqual([
      ...labelsIn('.oyl-hud__focus-main'),
      ...labelsIn('.oyl-hud__focus-more'),
    ]);
  });

  it('keeps the focus readout whole when the ride readings are hidden', async () => {
    mounted = await mount(<HudPanel {...base} layout={{ ...focus, hidden: ['readings'] }} />);
    expect(labelsIn('.oyl-hud__focus-more')).toEqual(['Speed', 'Avg power', 'Distance', 'Elapsed']);
  });

  it('shows the figures the full HUD shows, and no dash for a figure that exists', async () => {
    mounted = await mount(<HudPanel {...base} />);
    const full = [
      'Power',
      'Cadence',
      'Heart rate',
      'Speed',
      'Avg power',
      'Distance',
      'Elapsed',
    ].map(valueOf);
    mounted.unmount();
    mounted = await mount(<HudPanel {...base} layout={focus} />);
    const shown = [
      'Power',
      'Cadence',
      'Heart rate',
      'Speed',
      'Avg power',
      'Distance',
      'Elapsed',
    ].map(valueOf);
    expect(shown).toEqual(full);
    expect(valueOf('Power')).toBe('250 W');
    expect(valueOf('Avg power')).toBe('212 W');
    expect(valueOf('Distance')).toBe('12.3 km');
    expect(valueOf('Elapsed')).toBe('0:12:34');
    expect(shown.filter((value) => value.startsWith('—'))).toEqual([]);
  });

  it('shows the ride’s own clock where nothing records — #2382', async () => {
    mounted = await mount(
      <HudPanel {...base} elapsedSeconds={undefined} rideTotals={undefined} layout={focus} />,
    );
    expect(labelsIn('.oyl-hud__focus-more')).toEqual(['Speed', 'Avg power', 'Distance', 'Ride']);
    expect(valueOf('Ride')).toBe('0:00:30');
  });

  it('keeps the full HUD on a ride with a mode of its own', async () => {
    mounted = await mount(<HudPanel {...base} room={{ nearby: 2 }} layout={focus} />);
    expect(mounted.container.querySelector('.oyl-hud__focus')).toBeNull();
    expect(labelsIn('.oyl-hud__fields--primary')).toContain('Power');
    expect(mounted.container.querySelector('.oyl-hud')?.classList).not.toContain('oyl-hud--focus');
    mounted.unmount();
    mounted = await mount(
      <HudPanel
        {...base}
        delivery={{ round: startRound(8), week: FRESH_WEEK, score: 0, next: undefined }}
        layout={focus}
      />,
    );
    expect(mounted.container.querySelector('.oyl-hud__focus')).toBeNull();
    mounted.unmount();
    mounted = await mount(
      <HudPanel {...base} lapRace={hudOf(startRace({ laps: 3 }))} layout={focus} />,
    );
    expect(mounted.container.querySelector('.oyl-hud__focus')).toBeNull();
  });

  it('draws the full HUD with nothing chosen, and with full chosen', async () => {
    mounted = await mount(<HudPanel {...base} />);
    expect(mounted.container.querySelector('.oyl-hud__focus')).toBeNull();
    mounted.unmount();
    mounted = await mount(
      <HudPanel {...base} layout={{ hidden: [], textSize: 'normal', arrangement: 'full' }} />,
    );
    expect(mounted.container.querySelector('.oyl-hud__focus')).toBeNull();
    expect(labelsIn('.oyl-hud__fields--primary')).toContain('Power');
  });

  // Owner ruling of 2026-11-09 on PR #2406: the focus readout has no Moving
  // field, so the simulated mark's sentence about it goes with Focus on and
  // stays with Full. The sentences are the ones GameView hands in.
  const mark = simulatedRideSentences({ watts: 200, speedup: 8, startMetres: undefined });
  const markText = (): string | null | undefined =>
    mounted?.container.querySelector('.oyl-hud__simulated')?.textContent;

  it('leaves "Moving needs a recording." out of the simulated mark with Focus on', async () => {
    mounted = await mount(<HudPanel {...base} simulated={mark} layout={focus} />);
    expect(mounted.container.querySelector('.oyl-hud__focus')).not.toBeNull();
    expect(markText()).toBe('Simulated ride at 200 W, 8× real time. Not recorded or shared.');
    expect(mounted.container.textContent).not.toContain('Moving needs a recording.');
  });

  it('keeps "Moving needs a recording." in the simulated mark with Full', async () => {
    mounted = await mount(
      <HudPanel
        {...base}
        simulated={mark}
        layout={{ hidden: [], textSize: 'normal', arrangement: 'full' }}
      />,
    );
    expect(markText()).toBe(
      'Simulated ride at 200 W, 8× real time. Not recorded or shared. Moving needs a recording.',
    );
  });
});

/**
 * #2387: the totals strip, read off the rendered HUD — drawn only where the
 * rider chose it, on a ride with no mode of its own and never on the demo;
 * its readings the figures the tiers show beside it; and neither arrangement
 * changed by it.
 */
describe('the totals strip — #2387', () => {
  const profile = route();
  const base = {
    profile,
    state: {
      ...atStartLine(profile),
      elapsed: seconds(30),
      ride: { speed: metresPerSecond(8), distance: metres(400) },
      input: { power: watts(250), live: true },
    },
    cadence: { value: 88, live: true },
    heartRate: { value: 150, live: true },
    onPause: () => undefined,
    onEnd: () => undefined,
    paused: false,
    announcement: '',
    elapsedSeconds: 754,
    movingSeconds: 600,
    rideTotals: {
      distance: metres(6_000),
      climbed: metres(80),
      averagePower: watts(212),
      energy: joules(127_200),
    },
  };
  const strip = { hidden: [], textSize: 'normal', totalsStrip: true } as const;
  const labelsIn = (selector: string): (string | null)[] =>
    queryAll(mounted?.container ?? document, `${selector} dt`).map((each) => each.textContent);
  const valueIn = (selector: string, label: string): string => {
    const field = queryAll(mounted?.container ?? document, `${selector} .oyl-hud__field`).find(
      (each) => each.querySelector('dt')?.textContent === label,
    );
    return field?.querySelector('dd')?.textContent ?? '';
  };

  it('draws the strip, named, with its readings in their order, where the rider chose it', async () => {
    mounted = await mount(<HudPanel {...base} layout={strip} />);
    const list = mounted.container.querySelector('dl.oyl-hud__totals');
    expect(list?.getAttribute('aria-label')).toBe(TOTALS_STRIP_NAME);
    expect(mounted.container.querySelector('.oyl-hud')?.getAttribute('data-oyl-hud-totals')).toBe(
      'strip',
    );
    expect(labelsIn('.oyl-hud__totals')).toEqual([
      'Route',
      'To go',
      'Avg speed',
      'Energy',
      'Climbed',
    ]);
    // 6 km in 600 s moving is 10 m/s; 127.2 kJ of work.
    expect(valueIn('.oyl-hud__totals', 'Avg speed')).toBe('36.0 km/h');
    expect(valueIn('.oyl-hud__totals', 'Energy')).toBe('127 kJ');
  });

  it('shows To go and Climbed exactly as the tiers beside it do', async () => {
    // In either unit: `totals-strip.test.ts` holds the imperial figures.
    mounted = await mount(<HudPanel {...base} layout={strip} />);
    for (const label of ['To go', 'Climbed']) {
      expect(valueIn('.oyl-hud__totals', label), label).toBe(
        valueIn('.oyl-hud__fields--secondary', label),
      );
      expect(valueIn('.oyl-hud__totals', label), label).not.toBe('');
    }
  });

  it('keeps its readings when the ride readings are hidden', async () => {
    mounted = await mount(<HudPanel {...base} layout={{ ...strip, hidden: ['readings'] }} />);
    expect(labelsIn('.oyl-hud__totals')).toEqual([
      'Route',
      'To go',
      'Avg speed',
      'Energy',
      'Climbed',
    ]);
  });

  it('draws no strip with nothing chosen, or with the strip off', async () => {
    mounted = await mount(<HudPanel {...base} />);
    expect(mounted.container.querySelector('.oyl-hud__totals')).toBeNull();
    expect(mounted.container.querySelector('[data-oyl-hud-totals]')).toBeNull();
    mounted.unmount();
    mounted = await mount(<HudPanel {...base} layout={{ ...strip, totalsStrip: false }} />);
    expect(mounted.container.querySelector('.oyl-hud__totals')).toBeNull();
  });

  it('leaves either arrangement as it is', async () => {
    mounted = await mount(<HudPanel {...base} layout={{ ...strip, arrangement: 'focus' }} />);
    expect(labelsIn('.oyl-hud__focus-more')).toEqual(['Speed', 'Avg power', 'Distance', 'Elapsed']);
    expect(mounted.container.querySelector('.oyl-hud__totals')).not.toBeNull();
    mounted.unmount();
    mounted = await mount(<HudPanel {...base} layout={strip} />);
    expect(labelsIn('.oyl-hud__fields--primary')).toContain('Power');
    expect(labelsIn('.oyl-hud__fields--secondary')).toContain('To go');
  });

  it('draws no strip on a ride with a mode of its own', async () => {
    mounted = await mount(<HudPanel {...base} room={{ nearby: 2 }} layout={strip} />);
    expect(mounted.container.querySelector('.oyl-hud__totals')).toBeNull();
    mounted.unmount();
    mounted = await mount(
      <HudPanel
        {...base}
        delivery={{ round: startRound(8), week: FRESH_WEEK, score: 0, next: undefined }}
        layout={strip}
      />,
    );
    expect(mounted.container.querySelector('.oyl-hud__totals')).toBeNull();
    mounted.unmount();
    mounted = await mount(
      <HudPanel {...base} lapRace={hudOf(startRace({ laps: 3 }))} layout={strip} />,
    );
    expect(mounted.container.querySelector('.oyl-hud__totals')).toBeNull();
  });

  it('draws no strip on the demo, which records nothing', async () => {
    mounted = await mount(
      <HudCore
        {...base}
        layout={strip}
        units="metric"
        touchLock={false}
        labels={{ resume: 'Play', end: 'Stop' }}
        routeFigure={null}
        withoutTotals
      />,
    );
    expect(mounted.container.querySelector('.oyl-hud__totals')).toBeNull();
  });
});

/**
 * #2434: *Calories* on the HUD every ride shows — the owner's ruling of
 * 2026-11-10: in the always-shown "ride so far" tier with *Speed*, *To go*,
 * *Moving*, *Distance*, *Climbed* and *Avg power*, so a rider sees it without
 * changing a setting, and NOT in the optional totals strip. Read off the
 * rendered HUD with no layout given, which is `DEFAULT_HUD_LAYOUT`, over the
 * totals the controller works out (`recording/totals.ts` §`rideTotals`).
 */
describe('the calorie estimate on the default HUD — #2434', () => {
  const profile = route();
  const base = {
    profile,
    state: {
      ...atStartLine(profile),
      elapsed: seconds(30),
      ride: { speed: metresPerSecond(8), distance: metres(400) },
      input: { power: watts(250), live: true },
    },
    cadence: { value: 88, live: true },
    heartRate: { value: 150, live: true },
    onPause: () => undefined,
    onEnd: () => undefined,
    paused: false,
    announcement: '',
    elapsedSeconds: 754,
    movingSeconds: 600,
  };
  /** The recorder's totals after `count` seconds at `power`, with a strap's readings or not. */
  const ridden = (count: number, power: number | undefined, strap = false) => {
    const series: RecordedSeries<StreamChannelValue> = {
      startedAt: unixSeconds(1_800_000_000),
      sampleInterval: seconds(1),
      sampleCount: count,
      channels: {
        speed: Array.from({ length: count }, () => metresPerSecond(8)),
        ...(power === undefined
          ? {}
          : { power: Array.from({ length: count }, () => watts(power)) }),
        ...(strap ? { heartRate: Array.from({ length: count }, () => beatsPerMinute(140)) } : {}),
      },
      pauses: [],
    };
    return rideTotals(series, []);
  };
  const tier = '.oyl-hud__fields--secondary';
  const labelsIn = (selector: string): (string | null)[] =>
    queryAll(mounted?.container ?? document, `${selector} dt`).map((each) => each.textContent);
  const valueIn = (selector: string, label: string): string => {
    const field = queryAll(mounted?.container ?? document, `${selector} .oyl-hud__field`).find(
      (each) => each.querySelector('dt')?.textContent === label,
    );
    return field?.querySelector('dd')?.textContent ?? '';
  };

  it('is in the always-shown ride-so-far tier, after Avg power, and not in the totals strip', async () => {
    mounted = await mount(<HudPanel {...base} rideTotals={ridden(600, 200)} />);
    const labels = labelsIn(tier);
    for (const shown of ['Speed', 'To go', 'Moving', 'Distance', 'Climbed', 'Avg power']) {
      expect(labels).toContain(shown);
    }
    expect(labels.slice(labels.indexOf('Distance'), labels.indexOf('Distance') + 4)).toEqual([
      'Distance',
      'Climbed',
      'Avg power',
      'Calories',
    ]);
    // The default HUD draws no strip, and the rider changed no setting.
    expect(mounted.container.querySelector('.oyl-hud__totals')).toBeNull();
    // With the strip chosen, the tier keeps it and the strip does not gain it.
    mounted.unmount();
    mounted = await mount(
      <HudPanel
        {...base}
        rideTotals={ridden(600, 200)}
        layout={{ hidden: [], textSize: 'normal', totalsStrip: true }}
      />,
    );
    expect(labelsIn(tier)).toContain('Calories');
    expect(labelsIn('.oyl-hud__totals')).not.toContain('Calories');
    expect(labelsIn('.oyl-hud__totals')).toEqual([
      'Route',
      'To go',
      'Avg speed',
      'Energy',
      'Climbed',
    ]);
  });

  it('rises with the work — after 600 s at 200 W, 120 kJ, it reads ≈ 143 kcal', async () => {
    mounted = await mount(<HudPanel {...base} movingSeconds={300} rideTotals={ridden(300, 200)} />);
    // 60 kJ at the assumed 20 % efficiency: 60 000 / 4184 / 0.2 = 71.7 kcal.
    expect(valueIn(tier, 'Calories')).toBe('≈ 72 kcal estimate from power');
    mounted.unmount();
    mounted = await mount(<HudPanel {...base} rideTotals={ridden(600, 200)} />);
    // ⚠️ Not the issue's `≈ 120 kcal`, which is the 1 kJ = 1 kcal rule of
    // thumb (23.9 %): the owner's ruling on #2430's question 2 is 20 %.
    expect(valueIn(tier, 'Calories')).toBe('≈ 143 kcal estimate from power');
    // The basis is the phrase under the figure, the card's words.
    const field = queryAll(mounted.container, `${tier} .oyl-hud__field--calories`);
    expect(field.map((each) => each.querySelector('.oyl-hud__detail')?.textContent)).toEqual([
      ' estimate from power',
    ]);
  });

  it('reads a dash and why with no estimate, never 0 kcal, from what the ride recorded', async () => {
    mounted = await mount(<HudPanel {...base} rideTotals={ridden(600, undefined)} />);
    // A strap is live, but the recording has no heart rate: nothing to estimate from.
    expect(valueIn(tier, 'Calories')).toBe(`${NO_READING} kcal ${NO_CALORIES_NO_READINGS}`);
    expect(valueIn(tier, 'Calories')).not.toMatch(/\b0\b/);
    mounted.unmount();
    // A recording with heart rate and no rider details, with the strap now lost.
    mounted = await mount(
      <HudPanel
        {...base}
        heartRate={{ value: undefined, live: false }}
        rideTotals={ridden(600, undefined, true)}
      />,
    );
    expect(valueIn(tier, 'Calories')).toBe(`${NO_READING} kcal ${NO_CALORIES_SET_INPUTS_SHORT}`);
    // Before anything is recorded too.
    mounted.unmount();
    mounted = await mount(<HudPanel {...base} rideTotals={undefined} />);
    expect(valueIn(tier, 'Calories')).toBe(`${NO_READING} kcal ${NO_CALORIES_NO_READINGS}`);
  });

  it('never reports Sensor lost, with every sensor down', async () => {
    mounted = await mount(
      <HudPanel
        {...base}
        state={{ ...base.state, input: { power: watts(250), live: false } }}
        cadence={{ value: undefined, live: false }}
        heartRate={{ value: undefined, live: false }}
        rideTotals={ridden(600, 200)}
      />,
    );
    // The tiers say it of the live sensors; the estimate is not theirs.
    expect(mounted.container.textContent).toContain('Sensor lost');
    expect(valueIn(tier, 'Calories')).toBe('≈ 143 kcal estimate from power');
    const field = mounted.container.querySelector('.oyl-hud__field--calories');
    expect(field?.classList.contains('oyl-hud__field--stale')).toBe(false);
    expect(field?.textContent ?? 'no field').not.toContain('Sensor lost');
  });
});

/**
 * #2385: the compact route panel, read off the rendered HUD — the map alone
 * as a tile, the gradient on it the gradient field's own reading and
 * changing with it, the route panel still hidden when the rider hid it, and
 * the full panel kept while a workout's strip holds the map's place.
 */
describe('the compact route panel — #2385', () => {
  const profile = route();
  const at = (grade: number) => ({
    profile,
    state: { ...atStartLine(profile), grade: gradePercent(grade) },
    cadence: { value: 88, live: true },
    heartRate: { value: 150, live: true },
    chases: [],
    onPause: () => undefined,
    onEnd: () => undefined,
    paused: false,
    announcement: '',
  });
  const compact = { hidden: [], textSize: 'normal', route: 'compact' } as const;
  const panel = (): Element | null => mounted?.container.querySelector('.oyl-hud__route') ?? null;
  const inPanel = (selector: string): Element[] => queryAll(panel() ?? document, selector);
  const tileGrade = (): Element | null =>
    mounted?.container.querySelector('.oyl-hud__route .oyl-hud__tile-grade') ?? null;
  /** The gradient field's value, as the primary list draws it. */
  const field = (): string | null | undefined =>
    queryAll(mounted?.container ?? document, '.oyl-hud__fields--primary .oyl-hud__field')
      .find((each) => each.querySelector('dt')?.textContent === 'Gradient')
      ?.querySelector('dd')?.textContent;

  it('draws the map alone as a tile, with no elevation strip, when the rider chose it', async () => {
    mounted = await mount(<HudPanel {...at(4.5)} layout={compact} />);
    expect(panel()?.classList).toContain('oyl-hud__route--compact');
    expect(panel()?.getAttribute('data-oyl-route-view')).toBe('compact');
    // The map, inside the tile, and nothing of the full panel's strips.
    expect(inPanel('.oyl-hud__tile .oyl-hud__plan-svg')).toHaveLength(1);
    expect(inPanel('.oyl-hud__tile [data-testid="oyl-hud-plan-here"]')).toHaveLength(1);
    expect(inPanel('.oyl-hud__profile-svg')).toHaveLength(0);
    expect(inPanel('.oyl-hud__ahead-svg')).toHaveLength(0);
  });

  it('prints the gradient field’s own reading on the tile, in its band', async () => {
    mounted = await mount(<HudPanel {...at(4.5)} layout={compact} />);
    expect(field()).toBe('+4.5 %');
    // The same figure, sign, unit and glyph as the field.
    expect(tileGrade()?.textContent).toBe('Gradient +4.5 %');
    expect(tileGrade()?.getAttribute('data-oyl-tile-grade')).toBe('+4.5');
    expect(tileGrade()?.querySelector('.oyl-hud__digits')?.textContent).toBe('4.5');
    expect(tileGrade()?.querySelector('.oyl-hud__sign')?.textContent).toBe('+');
    expect(tileGrade()?.querySelector('[data-oyl-slope]')?.getAttribute('data-oyl-slope')).toBe(
      'up',
    );
    expect(tileGrade()?.classList).toContain('oyl-hud__tile-grade--climb');
  });

  it('changes with the gradient field, on the same render', async () => {
    mounted = await mount(<HudPanel {...at(4.5)} layout={compact} />);
    for (const [grade, shown, band] of [
      [-6.04, '-6.0', 'descent'],
      [0.02, '0.0', 'flat'],
      [12.36, '+12.4', 'wall'],
    ] as const) {
      await mounted.rerender(<HudPanel {...at(grade)} layout={compact} />);
      expect(field()).toBe(`${shown} %`);
      expect(tileGrade()?.getAttribute('data-oyl-tile-grade')).toBe(shown);
      expect(tileGrade()?.textContent).toBe(`Gradient ${shown} %`);
      expect(tileGrade()?.classList).toContain(`oyl-hud__tile-grade--${band}`);
    }
  });

  it('is said once: hidden beside the full HUD’s field, heard beside the focus readout', async () => {
    mounted = await mount(<HudPanel {...at(4.5)} layout={compact} />);
    expect(tileGrade()?.getAttribute('aria-hidden')).toBe('true');
    mounted.unmount();
    mounted = await mount(<HudPanel {...at(4.5)} layout={{ ...compact, arrangement: 'focus' }} />);
    // The focus readout has no gradient field: the tile's is the one there is.
    expect(field()).toBeUndefined();
    expect(tileGrade()?.hasAttribute('aria-hidden')).toBe(false);
    expect(tileGrade()?.textContent).toBe('Gradient +4.5 %');
  });

  it('draws the street map as the tile on a ride with a corridor', async () => {
    mounted = await mount(
      <HudPanel {...at(4.5)} profile={northRoute()} corridor={northCorridor()} layout={compact} />,
    );
    expect(inPanel('.oyl-hud__tile .oyl-hud__street-map')).toHaveLength(1);
    expect(tileGrade()?.getAttribute('data-oyl-tile-grade')).toBe('+4.5');
    // A sibling of the map's box, never inside it: a new gradient is not a
    // change to the map (#2380).
    expect(mounted.container.querySelector('.oyl-hud__street-map .oyl-hud__tile-grade')).toBeNull();
  });

  it('keeps the route panel hidden when the rider hid it, compact or not', async () => {
    mounted = await mount(<HudPanel {...at(4.5)} layout={{ ...compact, hidden: ['route'] }} />);
    expect(panel()).toBeNull();
    expect(tileGrade()).toBeNull();
    // The gradient is still the field's, in the primary list.
    expect(field()).toBe('+4.5 %');
    mounted.unmount();
    // With the recent graph shown the panel stays, for the graph alone.
    mounted = await mount(
      <HudPanel
        {...at(4.5)}
        layout={{ ...compact, hidden: ['route'] }}
        recent={{ samples: [{ power: 200, heartRate: 140 }], written: 1 }}
      />,
    );
    expect(inPanel('.oyl-hud__recent')).toHaveLength(1);
    expect(inPanel('.oyl-hud__tile')).toHaveLength(0);
    expect(inPanel('.oyl-hud__plan-svg')).toHaveLength(0);
    expect(tileGrade()).toBeNull();
  });

  it('keeps the recent graph under the tile when both are shown', async () => {
    mounted = await mount(
      <HudPanel
        {...at(4.5)}
        layout={compact}
        recent={{ samples: [{ power: 200, heartRate: 140 }], written: 1 }}
      />,
    );
    expect(inPanel('.oyl-hud__tile')).toHaveLength(1);
    expect(inPanel('.oyl-hud__recent')).toHaveLength(1);
  });

  it('draws the full panel by default, with full chosen, and while a workout runs', async () => {
    mounted = await mount(<HudPanel {...at(4.5)} />);
    expect(panel()?.getAttribute('data-oyl-route-view')).toBe('full');
    expect(inPanel('.oyl-hud__profile-svg')).toHaveLength(1);
    expect(tileGrade()).toBeNull();
    mounted.unmount();
    mounted = await mount(<HudPanel {...at(4.5)} layout={{ ...compact, route: 'full' }} />);
    expect(panel()?.classList).not.toContain('oyl-hud__route--compact');
    expect(tileGrade()).toBeNull();
    mounted.unmount();
    mounted = await mount(
      <HudPanel
        {...at(4.5)}
        layout={compact}
        workout={{
          elapsedSeconds: 150,
          timeline: expandWorkout({
            name: 'test',
            blocks: [{ kind: 'steady', seconds: seconds(600), target: thresholdShare(0.6) }],
          }),
          holdingWatts: 150,
          thresholdWatts: 250,
          trace: [],
        }}
      />,
    );
    // The workout's strip is in the map's place, so the panel is full.
    expect(panel()?.getAttribute('data-oyl-route-view')).toBe('full');
    expect(inPanel('[data-oyl-workout-graph="hud"]')).toHaveLength(1);
    expect(tileGrade()).toBeNull();
  });

  it('is not drawn by the HUD core alone, which is not told its figure is a map (the demo)', async () => {
    mounted = await mount(
      <HudCore
        {...at(4.5)}
        units="metric"
        labels={{ resume: 'Play', end: 'Stop' }}
        touchLock={false}
        layout={compact}
        routeFigure={null}
      />,
    );
    expect(panel()?.getAttribute('data-oyl-route-view')).toBe('full');
    expect(tileGrade()).toBeNull();
  });
});
