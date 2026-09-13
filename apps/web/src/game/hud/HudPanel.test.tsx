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
 * The pixels themselves were measured in the repository's pinned Chromium and
 * the numbers are in `theme.css` beside the rule. Turning that measurement into
 * a gate needs a HUD page in the browser gate (§4f), which is its own issue.
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
