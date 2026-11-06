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

import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HudCore } from './HudCore';
import { HudPanel } from './HudPanel';
import { atStartLine } from '../simulation';
import { FRESH_WEEK, startRound } from '../delivery/round';
import { hudOf, startRace } from './lap-race-testing';
import { mount, queryAll, type Mounted } from '../../testing/mount';
import { workoutGraphText, type WorkoutGraphInput } from '../../workout/workout-graph';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  expandWorkout,
  geographicPosition,
  gradePercent,
  metres,
  metresPerSecond,
  pacerGap,
  routeProfile,
  seconds,
  thresholdShare,
  watts,
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
      'Elapsed',
      'Clock',
      // #2076: the ride so far, after the clock and before every gap.
      'Distance',
      'Climbed',
      'Avg power',
      // #2077: the rider's W/kg (no threshold here, so no zone).
      'W/kg',
      'Pacer',
    ]);
    // #2076: marked, so a phone's overlay can leave them out (`theme.css`
    // §"THE RIDE SO FAR").
    expect(labelsIn('.oyl-hud__field--total')).toEqual(['Distance', 'Climbed', 'Avg power']);
    // And *Avg power* by name, which the 4:3 tablet sets in its narrowest
    // track (`theme.css` §"THE RIDE SO FAR AT ARM'S LENGTH").
    expect(labelsIn('.oyl-hud__field--average-power')).toEqual(['Avg power']);
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
      'Elapsed',
      'Clock',
      'Distance',
      'Climbed',
      'Avg power',
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

  it('shows a dash for each where nothing is being recorded', async () => {
    mounted = await mount(<HudPanel {...base} />);

    expect(field('Moving').value).toBe('—');
    expect(field('Elapsed').value).toBe('—');
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
        delivery: { round: startRound(8), week: FRESH_WEEK, score: 0 },
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
      expect(secondaryLabels()).toEqual(['Moving', 'Elapsed', 'Clock', ...own]);
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
