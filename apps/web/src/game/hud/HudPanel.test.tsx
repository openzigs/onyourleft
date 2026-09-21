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

import { afterEach, describe, expect, it } from 'vitest';

import { HudPanel } from './HudPanel';
import { atStartLine } from '../simulation';
import { mount, queryAll, type Mounted } from '../../testing/mount';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  metresPerSecond,
  pacerGap,
  routeProfile,
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

    expect(labelsIn('.oyl-hud__fields--primary')).toEqual(['Power', 'Cadence', 'Heart rate']);
    expect(labelsIn('.oyl-hud__fields--secondary')).toEqual([
      'Speed',
      'Gradient',
      'To go',
      'Pacer',
    ]);
    // Document order is the order a screen reader meets them in, and it is
    // the order `hudReadings` returns: primary first.
    expect(labelsIn('.oyl-hud')).toEqual([
      ...labelsIn('.oyl-hud__fields--primary'),
      ...labelsIn('.oyl-hud__fields--secondary'),
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
});
