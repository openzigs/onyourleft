// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride HUD, laid out by a real engine at a phone's width — #266.
 *
 * The third page in the browser gate, and it is here for the same reason as the
 * other two: **jsdom performs no layout**. `test:a11y` renders this panel and
 * audits it on every run (CLAUDE.md §4e) and cannot measure a single pixel;
 * `hud-value-size.test.ts` reads `theme.css` as a file and compares type sizes
 * against constants somebody measured by hand once. Neither can answer the only
 * question that matters to a rider glancing at a bar-mounted phone: **does the
 * value fit in its slot.**
 *
 * What made that worth a page of its own is that the failure is invisible to
 * every other gate *and* visible to every rider. `theme.css` sets a HUD value at
 * 2.5 rem in a `repeat(auto-fit, minmax(7rem, 1fr))` track; the `7rem` is a
 * floor rather than an `auto`, so the track does not grow, and a single word has
 * no break opportunity. #259 put three words in that slot, and they spilled
 * across the field beside them onto its number.
 *
 * ## Which measurement decides
 *
 * Two, taken off the browser and compared here — neither computed here.
 *
 * - **`scrollWidth` against `clientWidth`**, which is what #266 asks for. It is
 *   the element's scrolling area, it is an integer, and it is what the control
 *   panels below are required to trip.
 * - **A `Range` over the value's own contents against its unrounded box.** The
 *   finer of the two: `scrollWidth` is rounded, so an overflow of half a pixel
 *   is invisible to it, and a track that is 117.9 px wide reports a
 *   `clientWidth` of 118.
 *
 * ⚠️ **`scrollWidth` alone would have been a gate that could not fail, and this
 * was measured rather than reasoned about.** Chromium reports
 * `scrollWidth === clientWidth` for an element that is not a scroll container
 * whenever nothing actually overflows — which is correct, and is also what a
 * page with no stylesheet, no panel or a 1200 px container reports. The first
 * probe run of this harness returned identical numbers for all sixteen value
 * elements at 390 px, and only the control panels in landscape told the two
 * situations apart. That is why the control exists; see the next section.
 *
 * ## Which orientation is the binding one
 *
 * ⚠️ **Landscape, and #266's own table says portrait — which is a fact about
 * the container rather than a disagreement about arithmetic.** That table
 * records a 114 px track at 390 px, which is a grid 358 px wide: the viewport
 * less `.oyl-main`'s padding and without `.oyl-hud`'s own. The product's real
 * chain — `AppShell`'s `.oyl-main` around `GameView`'s `.oyl-game` around the
 * panel, which is what `hud-harness.tsx` renders — leaves the grid 326 px, so
 * `auto-fit` resolves to **two** columns of **159 px** and every one of the
 * three words fits even at 2.5 rem. In landscape it resolves to **five**
 * columns of **118 px**, where `Matched` measures 151 px and `Finished`
 * 144.5 px.
 *
 * So the gate asserts no overflow at both orientations, because that is the
 * claim worth making, and it requires the **control** to overflow in landscape
 * only — asserting that the control overflows in portrait would be asserting a
 * failure the product does not have, and it would go red the day somebody fixed
 * nothing at all.
 *
 * ⚠️ **The landscape case is the worst case for the whole product, not only for
 * a phone on its side.** `.oyl-main` is capped at `68ch`, which resolves to
 * 686 px, so from that width up the layout stops changing: five columns of
 * 118 px, at 686 px and at 1280 px alike. Measured through this harness, with
 * the control panels' three words at 2.5 rem:
 *
 * | viewport | columns | track | words over |
 * |---|---|---|---|
 * | 320 × 568 | 2 | 124 px | 2 of 3 |
 * | 360 × 800 | 2 | 144 px | 1 of 3 |
 * | 390 × 844 | 2 | 159 px | none |
 * | 686 × 500 | 5 | 118 px | all 3 |
 * | 844 × 390 | 5 | 118 px | all 3 |
 * | 1280 × 720 | 5 | 118 px | all 3 |
 *
 * At 1.5 rem none of them overflows anywhere in that table, which is the same
 * claim `hud-value-size.test.ts` makes arithmetically and this file makes by
 * asking a browser.
 *
 * ## What it does not prove
 *
 * That the HUD looks right. There is no reference image, and ADR 0009 forbids
 * deriving one from another product. Nothing here is about colour
 * (`contrast.a11y.test.ts`), about the scene behind the panel, or about a real
 * phone: a 390 px viewport in a headless Chromium is not a handlebar in the
 * rain, and a font stack that resolves differently on a runner will measure
 * differently. The assertions are relative for exactly that reason — does this
 * content fit this box — so the numbers in the prose above are the observation
 * and never the gate.
 */

import { expect, test, type Page } from '@playwright/test';

import { HARNESS_ORIGIN } from '../playwright.config';

/** What `hud-harness.tsx` publishes. Mirrored rather than imported — see below. */
interface ValueMeasurement {
  readonly panel: string;
  readonly control: boolean;
  readonly label: string;
  readonly text: string;
  readonly word: boolean;
  readonly clientWidth: number;
  readonly scrollWidth: number;
  readonly boxWidth: number;
  readonly contentWidth: number;
  readonly trackWidth: number;
}

interface HudMeasurement {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly columns: number;
  readonly values: readonly ValueMeasurement[];
  /** #285 — the plan view's box and the road drawn in it. */
  readonly plan: PlanMeasurement | undefined;
}

/** @see hud-harness.tsx §`PlanMeasurement` */
interface PlanMeasurement {
  readonly width: number;
  readonly height: number;
  readonly roadWidth: number;
  readonly roadHeight: number;
  readonly roads: number;
}

/**
 * A phone, both ways up.
 *
 * 390 × 844 is the viewport of the phone #94's HUD was written for, and the one
 * #266 measured. A rider clamps the phone either way, so both are ridden and
 * both are checked. @see the header for which of the two can catch what.
 */
const VIEWPORTS = [
  { name: 'portrait', width: 390, height: 844, controlOverflows: false },
  { name: 'landscape', width: 844, height: 390, controlOverflows: true },
] as const;

/**
 * The widest a grid track may be before this gate is measuring nothing.
 *
 * The panel is supposed to be in a phone-width container: two columns of 159 px
 * in portrait, five of 118 px in landscape. A track wider than this means the
 * grid is not there at all — the stylesheet failed to load, or the class names
 * moved — at which point each field is a full-width block and every "it fits"
 * assertion below is true of a layout no rider will ever see.
 *
 * ⚠️ **It does not catch a container that is merely too wide, and that was
 * measured rather than assumed.** `auto-fit` answers extra width by adding
 * columns, not by widening tracks: a 1200 px container was tried here and left
 * the track at 119 px, so this assertion stayed green. What caught it was the
 * control panel below, whose words stopped overflowing — which is the division
 * of labour between the two, and the reason neither is redundant.
 */
const WIDEST_CREDIBLE_TRACK = 200;

/**
 * How much fractional slack the finer comparison allows, in CSS pixels.
 *
 * Half a pixel, and it is for the `Range` rectangle's own rounding rather than
 * for the layout: the block-level detail phrase inside a value is exactly as
 * wide as the content box, so the no-overflow case reads as equality and any
 * genuine spill is tens of pixels. Nothing a rider can see lives in here.
 */
const SUBPIXEL_SLACK = 0.5;

/** The three settled outcome words #259 put in a slot sized for a number. */
const OUTCOME_WORDS = ['Beaten', 'Matched', 'Finished'] as const;

async function measure(
  page: Page,
  viewport: { readonly width: number; readonly height: number },
): Promise<HudMeasurement> {
  // The viewport is set BEFORE the page is loaded and the measurement is taken
  // when it is asked for, not at load: a number measured at one width and read
  // at another is the defect this gate is about, arriving inside the gate.
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  const response = await page.goto(`${HARNESS_ORIGIN}/hud.html`);
  // ⚠️ The status is checked rather than assumed, and that is CLAUDE.md §4f's
  // own warning being acted on: a page missing from
  // `vite.browser.config.ts`'s `build.rollupOptions.input` is simply not built,
  // and the symptom is a 404 at run time rather than a build error. Without
  // this, the run dies sixty seconds later on `waitForFunction` with no
  // mention of the config — measured by deleting the entry, which is what sent
  // the first reader of that failure to `playwright.config.ts`.
  if (response === null || !response.ok()) {
    throw new Error(
      `hud.html did not load (${String(response?.status())}). Is it named in ` +
        `vite.browser.config.ts's build.rollupOptions.input?`,
    );
  }
  // Waiting on the harness having *published*, rather than on a timer or on
  // `ready` alone. It publishes after React has flushed AND
  // `document.fonts.ready` has settled, which is what makes the measurement one
  // of laid-out text rather than of an empty container — and it publishes
  // `ready: false` with what went wrong when either of those throws.
  await page.waitForFunction(() => window.__oylHudHarness !== undefined);
  const published = await page.evaluate(() => window.__oylHudHarness);
  if (published === undefined || !published.ready) {
    // ⚠️ The harness's own error list, read rather than merely published. A
    // field nothing consumes is a no-op that still passes, and waiting on
    // `ready === true` instead would turn a harness that threw into a sixty
    // second timeout naming `waitForFunction` and nothing else.
    throw new Error(`the HUD harness did not become ready: ${published?.errors.join('; ') ?? ''}`);
  }
  const measured = await page.evaluate(() => window.__oylHudMeasure?.());
  if (measured === undefined) {
    throw new Error('the HUD harness published no measurement');
  }
  return measured;
}

/** Whether a value spills out of its box, by the integer measurement #266 names. */
function overflows(value: ValueMeasurement): boolean {
  return value.scrollWidth > value.clientWidth;
}

/** The same question at sub-pixel resolution. @see the header */
function overflowsFinely(value: ValueMeasurement): boolean {
  return value.contentWidth > value.boxWidth + SUBPIXEL_SLACK;
}

/** A failure that names the field and the numbers rather than saying `false`. */
function describeValue(value: ValueMeasurement): string {
  return `${value.panel}/${value.label} "${value.text}": ${String(value.scrollWidth)} in ${String(
    value.clientWidth,
  )} (content ${value.contentWidth.toFixed(1)} in ${value.boxWidth.toFixed(1)})`;
}

function shipping(measured: HudMeasurement): readonly ValueMeasurement[] {
  return measured.values.filter((value) => !value.control);
}

function control(measured: HudMeasurement): readonly ValueMeasurement[] {
  return measured.values.filter((value) => value.control);
}

for (const viewport of VIEWPORTS) {
  test.describe(`the ride HUD at ${viewport.name}`, () => {
    test('is laid out in a container the size a phone gives it', async ({ page }) => {
      const measured = await measure(page, viewport);

      // Everything else in this file is of the form "nothing overflowed", which
      // is what an empty page, a missing stylesheet and a desktop-width
      // container all report. This is the assertion that says the layout under
      // measurement is the tight one.
      expect(measured.viewport.width).toBe(viewport.width);
      expect(measured.columns).toBeGreaterThan(1);
      expect(measured.values.length).toBeGreaterThan(0);
      const widest = Math.max(...measured.values.map((value) => value.trackWidth));
      expect(widest).toBeLessThanOrEqual(WIDEST_CREDIBLE_TRACK);
    });

    test('shows all three settled outcome words', async ({ page }) => {
      const measured = await measure(page, viewport);

      // #266's first criterion asks for every field populated *including* the
      // three words, and a page that stopped rendering them would satisfy every
      // overflow assertion here by having nothing left to overflow.
      const words = shipping(measured)
        .filter((value) => value.label === 'Your best')
        .map((value) => value.text);
      for (const word of OUTCOME_WORDS) {
        expect(words.some((text) => text.startsWith(word))).toBe(true);
      }
      // And that they are the values #259's rule is on, which is what makes the
      // control panels a control rather than a second copy of the same thing.
      expect(
        shipping(measured)
          .filter((value) => OUTCOME_WORDS.some((word) => value.text.startsWith(word)))
          .every((value) => value.word),
      ).toBe(true);
      expect(control(measured).every((value) => !value.word)).toBe(true);
    });

    test('fits every value inside its own grid track', async ({ page }) => {
      const measured = await measure(page, viewport);

      // The criterion, over every field of every panel rather than over the
      // three words: a number that outgrew its slot is the same defect.
      const spilled = shipping(measured).filter(
        (value) => overflows(value) || overflowsFinely(value),
      );
      expect(spilled.map(describeValue)).toEqual([]);
    });
  });
}

test.describe('the measurement can see an overflow at all', () => {
  /**
   * ⚠️ **The assertion that stops every other one in this file being vacuous.**
   * The control panels are the same panels with `oyl-hud__value--word` stripped
   * off their values, so the same words are laid out at the size
   * `.oyl-hud__value` gives them — the HUD as it was before #259, and as it
   * becomes again the moment that rule is deleted or widened.
   *
   * Landscape only, and the header says why: through the product's real
   * ancestor chain a portrait track is 159 px, and all three words fit inside
   * it even at 2.5 rem. Requiring an overflow there would require a defect that
   * does not exist.
   */
  test('finds the words spilling out of their track without #259’s rule', async ({ page }) => {
    const landscape = VIEWPORTS.find((viewport) => viewport.controlOverflows);
    if (landscape === undefined) {
      throw new Error('no viewport is recorded as one where the control overflows');
    }
    const measured = await measure(page, landscape);

    const spilled = control(measured).filter((value) => overflows(value));
    // Every one of the three, not merely one of them: a run where only the
    // widest tripped would mean the margin had moved under the other two.
    expect(spilled.map((value) => value.text.split(' ')[0]).sort()).toEqual(
      [...OUTCOME_WORDS].sort(),
    );
    // And the finer comparison agrees, so neither measurement is load-bearing
    // on its own.
    expect(control(measured).filter((value) => overflowsFinely(value)).length).toBe(spilled.length);
  });
});

/**
 * The route in plan, drawn by a browser that actually lays SVG out — #285.
 *
 * ⚠️ **Nothing in the jsdom suite can see any of this.** `plan.test.ts` asserts
 * the projection down to six decimal places and `PlanTrace.test.tsx` asserts the
 * attributes, and both would stay green against a panel that resolved to zero
 * pixels high — jsdom performs no layout and lays out no SVG. The two failures
 * below are the ones that only exist once a real engine has read `theme.css`:
 * a panel collapsed inside `.oyl-hud`'s flex column, and a viewBox that reached
 * the element but drew nothing.
 */
test.describe('the plan view is drawn at a size a rider can see', () => {
  /** Either orientation would do; the plan is a square box, not a grid track. */
  const PORTRAIT = VIEWPORTS[0];

  test('gives the panel real pixels rather than collapsing it', async ({ page }) => {
    const measured = await measure(page, PORTRAIT);

    const plan = measured.plan;
    expect(plan, 'the HUD has no plan view at all').toBeDefined();
    // ⚠️ A floor, and what it does and does not pin was MEASURED rather than
    // assumed. Deleting `height: 8rem` from `.oyl-hud__plan-svg` leaves this
    // green: an `<svg>` with a `viewBox` and `width: 100%` sizes itself from
    // the viewBox's own 1:1 ratio, so it does not collapse. What this catches
    // is the panel not being drawn at all — `display: none`, a zero height, or
    // the component gone from `HudPanel` — and all three were checked against
    // it. The stylesheet's number is the stylesheet's to change.
    expect(plan?.height ?? 0).toBeGreaterThan(64);
    expect(plan?.width ?? 0).toBeGreaterThan(64);
  });

  test('draws the road inside it, at the height the fit gives it', async ({ page }) => {
    const measured = await measure(page, PORTRAIT);
    const plan = measured.plan;

    expect(plan?.roads ?? 0).toBeGreaterThan(0);
    // The harness route runs due north, so its extent is vertical. The fit
    // leaves `PLAN_PADDING` of the 100-unit box at each end, so the road is
    // 88 % of the panel's height — a road drawn at a couple of pixels, or not
    // drawn at all, fails this while every attribute assertion stays green.
    expect(plan?.roadHeight ?? 0).toBeGreaterThan((plan?.height ?? 0) * 0.5);
    // And it is inside the panel rather than overflowing it, which is what a
    // `preserveAspectRatio` that stopped fitting would produce.
    expect(plan?.roadHeight ?? 0).toBeLessThanOrEqual((plan?.height ?? 0) + 1);
  });
});
