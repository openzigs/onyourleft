// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The page the HUD half of the browser gate drives — #266.
 *
 * It renders the **real** `game/hud/HudPanel.tsx`, through the **real**
 * `game/hud/fields.ts`, under the **real** `design/theme.css`, on the **real**
 * stage `GameView` gives it. Nothing here is a stand-in, for the reason
 * `harness.ts` and `game-harness.ts` both give: a layout measured against a
 * stylesheet of the harness's own would be a measurement of the harness.
 *
 * ## ⚠️ The ancestor chain changed in #423, and this page changed with it
 *
 * A reviewer who remembers `oyl-shell` → `oyl-main` → `oyl-game` here is
 * reading the old file. That chain was what bounded the panel's width — the
 * shell's reading measure — and it bounds nothing any more: while a ride runs
 * the HUD is laid over a stage that is `position: fixed; inset: 0`, so its
 * containing block is the VIEWPORT, whatever is above it in the document. Left
 * as it was, this page would have gone on measuring the stacked layout a rider
 * now only gets at 320×256, at a phone's width, and passing.
 *
 * So each panel is rendered on a stage of its own. ⚠️ **One thing about those
 * stages is this file's and not the product's**: `position: relative` and a
 * height of `100vh`, inline, where the product has `position: fixed`. Six fixed
 * stages would be six panels on top of one another. What the override keeps is
 * the only thing the HUD's layout reads — a containing block the size of the
 * viewport — and `ride.browser.spec.ts` measures the product's own fixed stage,
 * through the real `GameView`, so the substitution is not the only evidence.
 *
 * ## What it exists to catch, and why no other gate can
 *
 * `theme.css` sets a HUD value at 2.5 rem inside
 * `grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr))`. The `7rem` is a
 * **floor** rather than an `auto`, so the track never grows to fit its content,
 * and a single word has no break opportunity — so a word wider than the track
 * spills sideways over the field beside it and lands on that field's number.
 *
 * That shipped, and passed every gate this repository has:
 *
 * - `test:a11y` renders the panel into **jsdom**, which performs no layout and
 *   resolves no custom property (CLAUDE.md §4e). It cannot measure a pixel.
 * - `hud-value-size.test.ts` reads `theme.css` as a **file** and compares type
 *   sizes against constants copied out of a measurement somebody took by hand.
 *   That is a comparison against a previous reading, not against a browser.
 * - the browser gate had a map page and a renderer page and **no HUD page**.
 *
 * So the one thing this page adds to the repository is a **real Chromium doing
 * real layout over the shipping stylesheet**, read back from the browser rather
 * than computed here.
 *
 * ## The control panels, and why a green run would otherwise mean nothing
 *
 * ⚠️ Every panel is rendered **twice**. In the second copy the fields whose
 * value is a word have `oyl-hud__value--word` stripped off **and are moved into
 * the primary list**, so the same words are laid out at `.oyl-hud__value`'s
 * 2.5 rem in a track about 7 rem wide — which is what the HUD looked like
 * before #259.
 *
 * ⚠️ **The move is new in #423, and stripping the class alone stopped being a
 * control.** Every value that can be a word is a gap, and every gap is a
 * secondary reading now, set at 1.5 rem: without #259's rule `Matched` is 91 px
 * in a track that is 93 px or more at every viewport measured here. It would
 * spill only at the 5.5 rem floor, by under three pixels, in one word — which
 * is a control that goes green on a font with slightly narrower glyphs, and CI
 * is not this machine. `hud-value-size.test.ts` holds that case by arithmetic
 * at the floor. What THIS control is for is proving the apparatus can see an
 * overflow at all, so it reproduces the overflow #259 was actually filed on,
 * with a third of the word's width to spare.
 *
 * It is here because the obvious version of this gate cannot fail. A harness
 * that gave the panel a 1200 px container would find no overflow anywhere, and
 * a `scrollWidth <= clientWidth` assertion over it would be green forever while
 * measuring nothing. The control is the other half of the measurement: the spec
 * requires it to **overflow** in landscape, which is what says the apparatus can
 * see an overflow at all. A container too wide, a stylesheet that
 * did not load, a panel that rendered nothing — all three turn the control
 * green, and a green control is a red build.
 *
 * ⚠️ The class is stripped in the DOM rather than overridden in a stylesheet of
 * this page's own, deliberately: an override would have to name `2.5rem`, and
 * would then go on claiming to be "the size without the rule" after somebody
 * changed the size with the rule. Removing the class asks the shipping
 * stylesheet the question instead.
 *
 * ## The ninth field, and why it is here at its widest — #335
 *
 * The wind reading is the first field added to this panel since the gate
 * existed, and #335's own sketch says a ninth field *"is a layout change that
 * gate will have an opinion about"*. It is a magnitude and a unit like the
 * speed beside it, so it carries no `oyl-hud__value--word` and the control
 * panels are unaffected — but its **widest** value is one a rider can reach by
 * typing, which is why {@link STATE} carries the bound rather than an ordinary
 * breeze. @see the comment there.
 *
 * ## What this page does NOT prove
 *
 * That the HUD looks right. There is no reference image and ADR 0009 forbids
 * deriving one from another product. This is a **layout** check and nothing
 * more: it says no value spills out of its grid track at a phone's width. It
 * says nothing about colour (`contrast.a11y.test.ts` owns that), nothing about
 * the scene behind it, and nothing about a real phone — a 390 px viewport in a
 * headless Chromium is not a handlebar in the rain.
 */

import { StrictMode, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradeAt,
  metres,
  metresPerSecond,
  pacerGap,
  routeProfile,
  seconds,
  watts,
  MAXIMUM_WIND_SPEED_METRES_PER_SECOND,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';

import type { GhostOutcome } from '../src/game/ghost-outcome';
import type { ChasedGap } from '../src/game/hud/fields';
import { HudPanel } from '../src/game/hud/HudPanel';
import type { GameState } from '../src/game/simulation';

// The shipping stylesheet, which is the whole point — see this file's header.
import '../src/design/theme.css';

/** One measured value element. Serialisable, so it survives `page.evaluate`. */
export interface ValueMeasurement {
  /** Which panel it came from — the outcome, and whether this is the control copy. */
  readonly panel: string;
  readonly control: boolean;
  /** The field's label, so a failure names the field a rider would be looking at. */
  readonly label: string;
  /** Everything inside the value element, whitespace-collapsed. */
  readonly text: string;
  /** Whether the element still carries `oyl-hud__value--word`. */
  readonly word: boolean;
  /**
   * The element's content box, and the width of what is laid out inside it.
   *
   * All four read off the browser, none computed here. `clientWidth` and
   * `scrollWidth` are integers; `boxWidth` is the same box unrounded, which is
   * what `contentWidth` has to be compared against — a track of 117.9 px
   * reports a `clientWidth` of 118, and comparing a fractional content width
   * against a rounded box is how a half-pixel becomes a red build.
   *
   * `hud.browser.spec.ts` §"Which measurement decides" says which of the two
   * comparisons the gate rests on, and what each one alone would miss.
   */
  readonly clientWidth: number;
  readonly scrollWidth: number;
  readonly boxWidth: number;
  readonly contentWidth: number;
  /** The grid track the field sits in — the width the value has to fit. */
  readonly trackWidth: number;
}

/**
 * The plan view's box, and the box of the road drawn inside it — #285.
 *
 * ⚠️ **Only a browser can answer either.** The panel's height comes from
 * `theme.css` (`8rem`) inside `.oyl-hud`'s flex column, and the road's box comes
 * from `preserveAspectRatio` resolving a 100×100 viewBox into that. jsdom
 * performs no layout and lays out no SVG at all, so both are zero there and the
 * jsdom suite cannot tell a drawn route from a collapsed one.
 */
export interface PlanMeasurement {
  /** The `<svg>`'s own border box. */
  readonly width: number;
  readonly height: number;
  /** The union of the drawn road's boxes, in the same screen pixels. */
  readonly roadWidth: number;
  readonly roadHeight: number;
  /** How many `<path>` elements the road was drawn as. */
  readonly roads: number;
}

/** What the spec reads back. */
export interface HudMeasurement {
  readonly viewport: { readonly width: number; readonly height: number };
  /** How many columns the `auto-fit` grid resolved to at this width. */
  readonly columns: number;
  readonly values: readonly ValueMeasurement[];
  /** `undefined` when the panel has no plan view at all, which is a failure. */
  readonly plan: PlanMeasurement | undefined;
}

declare global {
  interface Window {
    /** Set once the panels are rendered AND the fonts are loaded. */
    __oylHudHarness?: { readonly ready: boolean; readonly errors: readonly string[] };
    /**
     * The measurement, taken **when it is called**.
     *
     * A function rather than a published object, because this gate's whole
     * subject is what happens at a given width: a value measured at load and
     * read after `setViewportSize` would be a measurement of the wrong layout,
     * reported as though it were the right one.
     */
    __oylHudMeasure?: () => HudMeasurement;
  }
}

const errors: string[] = [];

/**
 * A route about 40 km long with a rolling profile.
 *
 * Long enough that "To go" reads as a real number of kilometres rather than as
 * the two digits a short fixture would give — the field's width is part of what
 * is being measured, and a fixture chosen to be narrow would measure a HUD
 * nobody rides.
 */
function route(): RouteProfile {
  const points: RoutePoint[] = [];
  const spacing = 100;
  const count = 400;
  for (let index = 0; index <= count; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * spacing) / 111_320),
        degreesLongitude(-0.12),
      ),
      // A rolling route rather than a ramp, so the gradient at the rider's
      // position is a real number with a sign rather than a constant.
      elevation: altitudeMetres(60 + 40 * Math.sin((index / count) * 6 * Math.PI)),
    });
  }
  return routeProfile(points);
}

const PROFILE = route();

/** Where the rider is. Five kilometres in, so every field has something to say. */
const RIDDEN = metres(5_000);

/**
 * The ride, mid-ride and with every channel reporting.
 *
 * Ordinary values rather than extreme ones: a three-digit power, a speed with a
 * decimal, a two-decimal countdown — what the HUD shows for most of most rides.
 * Picking the widest number each field could ever hold would turn this gate
 * into an assertion about arithmetic nobody will see; picking a narrow one
 * would let a real overflow through.
 */
const STATE: GameState = {
  ride: { speed: metresPerSecond(12.5), distance: RIDDEN },
  elapsed: seconds(1_200),
  ridden: seconds(1_200),
  grade: gradeAt(PROFILE, RIDDEN),
  input: { power: watts(342), live: true },
  // ⚠️ **The one field here that is deliberately extreme, against the rule
  // stated above it** — #335. Every other value is an ordinary one because the
  // widest number a field could ever hold is arithmetic nobody will see; the
  // wind is different, because the widest one is a number a rider can *type*.
  // `MAXIMUM_WIND_SPEED_METRES_PER_SECOND` is the bound `route/wind.ts`
  // enforces, so this is the widest wind reading the product can ever produce
  // — 144 km/h, five glyphs where the speed beside it has four. Read from the
  // constant rather than written out, so the harness cannot drift from the
  // bound it is measuring.
  headwindMetresPerSecond: MAXIMUM_WIND_SPEED_METRES_PER_SECOND,
};

/** The bot, up the road — a live gap, which is the field's other shape. */
const BOT_GAP: ChasedGap = {
  to: 'bot',
  gap: pacerGap({
    botDistance: metres(5_120),
    riderDistance: RIDDEN,
    referenceSpeed: metresPerSecond(12.5),
  }),
};

/** The three settled outcomes — the words #259 put in the slot a number had. */
const OUTCOMES: readonly GhostOutcome[] = ['beaten', 'level', 'not-beaten'];

function ghostChase(outcome: GhostOutcome): ChasedGap {
  return {
    to: 'ghost',
    gap: pacerGap({
      botDistance: metres(5_400),
      riderDistance: RIDDEN,
      referenceSpeed: metresPerSecond(12.5),
    }),
    outcome,
  };
}

/**
 * The panels, in the markup `AppShell` and `GameView` actually put them in.
 *
 * ⚠️ `oyl-shell` → `oyl-main` → `oyl-game` is not decoration. `.oyl-main`
 * carries `padding: var(--oyl-space-lg) var(--oyl-space-md)`, so it is what
 * decides how much width the HUD's grid has — and therefore how many columns
 * `auto-fit` resolves to and how wide a track is. A panel measured at the bare
 * viewport width would be measured in a container the product never gives it,
 * and the answer would be wrong in the direction that matters: narrower tracks,
 * failures a rider would never see.
 *
 * ⚠️ **And that is not hypothetical — it is where #266's own table came from.**
 * The issue records a 114 px track at 390 px, which is a grid 358 px wide: the
 * viewport less `.oyl-main`'s padding and **without** `.oyl-hud`'s own. Through
 * the real chain the grid is 326 px, `auto-fit` resolves to **two** columns
 * rather than three, and the track is **159 px** — in which all three words fit
 * even at 2.5 rem. So the portrait half of that table describes a container the
 * product does not build, and the orientation that actually broke is landscape,
 * where five columns give a 118 px track and `Matched` measures 151 px.
 * `hud.browser.spec.ts` §"Which orientation is the binding one" carries the
 * consequence for what the gate can claim.
 */
/**
 * The one piece of geometry here that is this file's — see the header.
 *
 * `position: relative` puts the stage in the flow, so six of them stack; the
 * height is the viewport's, which is what `inset: 0` gives the product's. The
 * HUD inside is `position: absolute; inset: 0` against this box exactly as it
 * is against the product's.
 */
const STAGE_IN_FLOW = { position: 'relative', inset: 'auto', height: '100vh' } as const;

function Harness(): JSX.Element {
  return (
    <div>
      {OUTCOMES.flatMap((outcome) =>
        [false, true].map((control) => (
          <section
            key={`${outcome}-${String(control)}`}
            // The product's own stage classes, so the product's own overlay
            // rules apply. @see STAGE_IN_FLOW
            className="oyl-game oyl-game--riding"
            style={STAGE_IN_FLOW}
            data-oyl-panel={outcome}
            data-oyl-control={control ? 'true' : 'false'}
          >
            <HudPanel
              profile={PROFILE}
              state={STATE}
              cadence={{ value: 92, live: true }}
              heartRate={{ value: 168, live: true }}
              chases={[BOT_GAP, ghostChase(outcome)]}
              paused={false}
              onPause={() => undefined}
              onEnd={() => undefined}
            />
          </section>
        )),
      )}
    </div>
  );
}

/**
 * Strip `oyl-hud__value--word` from every value in a control panel.
 *
 * After the render rather than through a prop, because the prop does not exist:
 * `HudPanel` decides the class from the reading, which is the wiring
 * `HudPanel.test.tsx` pins. A prop added so this page could ask for the old
 * behaviour would be shipping code shaped by a harness.
 */
function undoWordRule(root: ParentNode): void {
  for (const panel of root.querySelectorAll('[data-oyl-control="true"]')) {
    const primary = panel.querySelector('.oyl-hud__fields--primary');
    if (primary === null) {
      throw new Error('hud harness: a control panel rendered no primary list');
    }
    for (const value of panel.querySelectorAll('.oyl-hud__value--word')) {
      value.classList.remove('oyl-hud__value--word');
      // ⚠️ Into the primary list — see "The control panels" in the header for
      // why stripping the class is no longer enough on its own. React never
      // re-renders this page, so it never moves the node back.
      const field = value.closest('.oyl-hud__field');
      if (field !== null) {
        primary.append(field);
      }
    }
  }
}

/** Whitespace-collapsed text, so a failure message is readable. */
function textOf(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The width of what is laid out inside an element, from the browser's own boxes.
 *
 * A `Range` over the element's contents, whose bounding rectangle is the union
 * of the boxes the browser laid the content out into. A second, finer opinion
 * on `scrollWidth`, which is an integer and therefore blind to an overflow of
 * less than a pixel.
 *
 * ⚠️ The union includes the `oyl-hud__detail` phrase, which is `display: block`
 * and therefore exactly as wide as the content box — so this is never *less*
 * than the box, and "no overflow" reads as equality rather than as a smaller
 * number. Measured: 159.0 against a 159 px box with the words fitting, 151.0
 * against a 118 px box with them not.
 */
function contentWidth(element: Element): number {
  const range = document.createRange();
  range.selectNodeContents(element);
  return range.getBoundingClientRect().width;
}

function measure(): HudMeasurement {
  const values: ValueMeasurement[] = [];
  for (const panel of document.querySelectorAll('[data-oyl-panel]')) {
    const control = panel.getAttribute('data-oyl-control') === 'true';
    const name = panel.getAttribute('data-oyl-panel') ?? '';
    for (const field of panel.querySelectorAll('.oyl-hud__field')) {
      const value = field.querySelector('.oyl-hud__value');
      if (value === null) {
        continue;
      }
      values.push({
        panel: name,
        control,
        label: textOf(field.querySelector('.oyl-hud__label') ?? field),
        text: textOf(value),
        word: value.classList.contains('oyl-hud__value--word'),
        clientWidth: value.clientWidth,
        scrollWidth: value.scrollWidth,
        boxWidth: value.getBoundingClientRect().width,
        contentWidth: contentWidth(value),
        trackWidth: field.clientWidth,
      });
    }
  }
  // Read off the resolved grid rather than counted from the fields: `auto-fit`
  // decides this, and counting the fields would report how many there are.
  // ⚠️ The SECONDARY list since #423: the primary one is three fixed tracks,
  // so its count says nothing about whether `auto-fit` resolved.
  const fields = document.querySelector('[data-oyl-control="false"] .oyl-hud__fields--secondary');
  const columns =
    fields === null
      ? 0
      : window.getComputedStyle(fields).gridTemplateColumns.split(/\s+/).filter(Boolean).length;
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    columns,
    values,
    plan: measurePlan(),
  };
}

/** The plan view of the first shipping panel. @see PlanMeasurement */
function measurePlan(): PlanMeasurement | undefined {
  const panel = document.querySelector('[data-oyl-control="false"]');
  const svg = panel?.querySelector('.oyl-hud__plan-svg');
  if (svg === undefined || svg === null) {
    return undefined;
  }
  const box = svg.getBoundingClientRect();
  const roads = [...svg.querySelectorAll('.oyl-hud__plan-line')];
  const boxes = roads.map((road) => road.getBoundingClientRect());
  const width =
    boxes.length === 0
      ? 0
      : Math.max(...boxes.map((r) => r.right)) - Math.min(...boxes.map((r) => r.left));
  const height =
    boxes.length === 0
      ? 0
      : Math.max(...boxes.map((r) => r.bottom)) - Math.min(...boxes.map((r) => r.top));
  return {
    width: box.width,
    height: box.height,
    roadWidth: width,
    roadHeight: height,
    roads: roads.length,
  };
}

async function run(): Promise<void> {
  const container = document.querySelector<HTMLDivElement>('#hud');
  if (container === null) {
    throw new Error('the harness page is missing its #hud container');
  }
  // `flushSync` so the tree is in the document before anything is stripped or
  // measured. `createRoot().render` is asynchronous, and a measurement taken
  // against an empty container is the vacuous pass this whole page exists to
  // rule out.
  flushSync(() => {
    createRoot(container).render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
  });
  undoWordRule(container);
  // ⚠️ Before anything is measured. Text is measured in whatever font is
  // resolved at the time, and a measurement taken before the font stack settles
  // is a measurement of a fallback. Nothing here loads a web font today —
  // `theme.css` asks for `system-ui` — which is exactly why waiting costs
  // nothing and why the day somebody adds one this page is already right.
  await document.fonts.ready;
  window.__oylHudMeasure = measure;
  window.__oylHudHarness = { ready: true, errors };
}

run().catch((error: unknown) => {
  errors.push(error instanceof Error ? error.message : String(error));
  window.__oylHudHarness = { ready: false, errors };
});
