// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The page the shell half of the browser gate drives — #307's review.
 *
 * It renders the **real** `shell/AppShell.tsx`, with the **real** `ROUTES`
 * table, under the **real** `design/theme.css`. Nothing here is a stand-in, for
 * the reason `hud-harness.tsx` gives: a layout measured against a stylesheet of
 * the harness's own would be a measurement of the harness.
 *
 * ## What it exists to catch, and why no other gate could
 *
 * #307 added `position: sticky` to `.oyl-header` and `scroll-margin-top` to
 * `.oyl-main`, and the review measured what they cost: at 320×256 — the
 * viewport WCAG 2.2 SC 1.4.10 names — the header was **178 px of 256**, and the
 * `scroll-margin-top` that was supposed to clear it was 80 px, so "Skip to main
 * content" landed the `<h1>` entirely *behind* the header on a phone.
 *
 * Every gate this repository has was green throughout:
 *
 * - `test:a11y` renders every route into **jsdom**, which performs no layout
 *   and resolves no custom property (CLAUDE.md §4e). It cannot measure a pixel,
 *   so `position`, `z-index` and `scroll-margin-top` are invisible to it.
 * - `theme.a11y.test.ts` reads `theme.css` as a **file**. It can see that a
 *   declaration is present; it cannot see what the declaration does.
 * - the browser gate had a map page, a renderer page and a HUD page, and **no
 *   page that rendered the shell at all** — the chrome was the one surface a
 *   real engine never laid out.
 *
 * So the one thing this page adds is a **real Chromium doing real layout over
 * the shipping stylesheet and the shipping markup**, read back from the browser
 * rather than computed here.
 *
 * ## Why the shell is rendered with no ports
 *
 * Every `AppShellProps` member but `capabilities` is optional, and each view
 * handed `undefined` renders its own honest explanation rather than crashing —
 * which is the state the accessibility suite already audits every route in. The
 * measurements this page exists for are all of the **chrome**: the header, the
 * skip link, `main`'s box and the `h1` inside it. None of them depends on which
 * view is below, so wiring a store here would add a database to a layout gate
 * and change no number it reads.
 *
 * ## What this page does NOT prove
 *
 * That the shell looks right. There is no reference image and ADR 0009 forbids
 * deriving one from another product. This is a **layout** check and nothing
 * more: it says what fraction of a viewport the chrome takes and where a
 * fragment jump lands. It says nothing about colour — `contrast.a11y.test.ts`
 * owns that — and nothing about a real phone, because a 320 px viewport in a
 * headless Chromium is not a handlebar in the rain.
 */

import { StrictMode, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

import {
  browserCameraPort,
  canvasFrameGrabber,
  platformMediaDevices,
} from '../src/camera/browser-camera';
import { endpointDecision } from '../src/camera/analysis-endpoint';
import { riderAnalysisPort } from '../src/camera/analysis-transport';
import { CameraController } from '../src/camera/session';
import { sidePairingPort } from '../src/camera/side-link';
import { Button } from '../src/design/Button';
import { StatusMessage, type StatusTone } from '../src/design/StatusMessage';
import { AppShell } from '../src/shell/AppShell';
import { viewGroupsLoaded } from './views-loaded';
import type { CapabilityProbe } from '../src/support/bluetooth-support';

// The shipping stylesheet, which is the whole point — see this file's header.
import '../src/design/theme.css';

/**
 * A browser with no Bluetooth, which is what a headless Chromium is.
 *
 * The same probe `degradation.a11y.test.tsx` uses. It selects the honest
 * cannot-pair-here branch of the Devices screen, and it changes nothing about
 * the chrome this page measures.
 */
const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

/**
 * How much taller than any measured viewport the document is made.
 *
 * ⚠️ **This is the control, and without it most of the spec could not fail.** A
 * fragment jump — the skip link, `AppShell`'s focus move on a route change —
 * scrolls the target up by `scroll-margin-top`, and a page that is already
 * shorter than the viewport **cannot scroll at all**: the browser leaves
 * `scrollY` at 0, the `h1` stays where it was, and an assertion that it clears
 * the header passes while measuring nothing. That is exactly what the first run
 * of this harness did — `scrollY=0` and "visible" at every viewport from
 * 320×640 up, including the ones the defect was reported on.
 *
 * The shell handed no ports renders short views, so the document is extended
 * here. The real product does not need this: its views are lists of rides and
 * forms of settings, and `.oyl-shell` grows with them.
 *
 * ## ⚠️ Where it goes is load-bearing, and two obvious places are both wrong
 *
 * It is appended **inside `.oyl-main`**, at the end. Both of the other
 * candidates were tried, and each made a different assertion vacuous — which is
 * why they are written down instead of left as a preference.
 *
 * **Not `document.body`, after the shell.** `position: sticky` is confined to
 * its own containing block, so the header can only stay pinned while
 * `.oyl-shell` is on screen. A spacer after the shell makes the *document*
 * scrollable while leaving the shell one viewport tall, so scrolling down
 * carries the whole shell — header included — off the top. The header then
 * measures as covering **0 px**, and "persistent chrome is within budget" is
 * true of a page with no persistent chrome on it. That is not a hypothesis: the
 * chrome-budget test was written that way, passed, and then **passed again**
 * with `position: sticky` restored unconditionally, which is the exact defect it
 * exists to catch.
 *
 * **Not `.oyl-shell`, after the footer.** That fixes the above, and leaves
 * `.oyl-main` itself shorter than the viewport. A `focus()` on an element that
 * already fits on screen scrolls to the top of the document and stops, so
 * `scroll-margin-top` is never consulted — and the whole skip-link measurement
 * passes without the property it is about ever being applied. Measured: with the
 * spacer there, `scroll-margin-top: 5rem` — the value #307 shipped and the
 * review blocked on — left every assertion green.
 *
 * Inside `main`, `main` is taller than every viewport measured, which is what it
 * is in the product: its views are lists of rides and forms of settings. A
 * fragment jump onto it then behaves the way it does for a real reader, and
 * `shell.browser.spec.ts` §"the apparatus can see chrome that stays" and its
 * per-viewport scroll control are what stop either of the two failures above
 * returning unnoticed.
 *
 * React owns `.oyl-main`'s children, so an appended node is in principle
 * reconcilable away. In practice nothing here re-renders — there is no state
 * change and the spec changes no route — and the spec asserts the page is
 * scrollable at every viewport, so a spacer that stopped working is a red build
 * rather than a quiet one.
 */
const SPACER_PIXELS = 4000;

/**
 * The attribute the spec waits on.
 *
 * Set **after** a synchronous flush, so that its presence means React has
 * committed and the browser has a tree to lay out. Waiting on the element
 * instead would race: `#shell` is in the HTML before any script runs, so a
 * selector for it is satisfied by an empty page.
 */
const READY_ATTRIBUTE = 'data-oyl-shell-ready';

/**
 * The `.oyl-button` controls a rider touches mid-ride, rendered so that a real
 * engine lays them out — #316.
 *
 * ## Why they are specimens rather than a route
 *
 * `AppShell` here is handed no ports, which is what the rest of this page needs
 * (see the header). Every view then takes its honest cannot-do-this-here branch
 * and renders a `StatusMessage` instead of a control: measured on this harness,
 * **all eleven routes render zero buttons, zero inputs and zero selects**. So
 * navigating to `#/` and measuring "the ride screen's Pause button" would
 * measure nothing at all, and — the failure mode that matters — it would do so
 * silently, because a `querySelectorAll` over an empty page is an empty list
 * and an assertion over an empty list passes. `shell.browser.spec.ts` counts
 * what it found for exactly that reason.
 *
 * ## What is real here, and it is the part being measured
 *
 * The component is the shipping {@link Button}, the class names are the ones it
 * emits, the stylesheet is the shipping `design/theme.css`, and the box they are
 * laid out in is the shipping `.oyl-main` inside the shipping `.oyl-shell`.
 * Nothing about the geometry is this file's. What the harness supplies is the
 * *labels*, and they are copied from `views/RideView.tsx` rather than invented:
 * `Stop` is the shortest label any `.oyl-button` in the product carries, so it
 * is the narrowest target that ships.
 *
 * ⚠️ They are rendered **inside `.oyl-main`**, above the spacer, for the reason
 * {@link SPACER_PIXELS} gives at length: a control measured outside `.oyl-shell`
 * is a control outside the layout under test.
 *
 * `data-oyl-touch-target` is what `shell.browser.spec.ts` selects on. Renaming
 * it is a red build there rather than a quiet one, because that spec asserts
 * how many specimens it found before it measures any of them.
 */
function TouchTargets(): JSX.Element {
  return (
    <section data-oyl-touch-target="true" aria-label="Touch target specimens">
      <Button variant="secondary">Pause</Button>
      <Button>Resume</Button>
      <Button variant="secondary">Stop</Button>
      <Button>Yes, stop the ride</Button>
      <Button variant="secondary">Keep riding</Button>
    </section>
  );
}

/**
 * `?links=specimens` renders a link inside each of the four status messages —
 * #661 — opt-in for `CAMERA_LIVE`'s reason.
 *
 * ⚠️ **Why specimens, and why these four.** The product puts links inside
 * status messages — the trainer game's "Realistic world" notice, Home's "A ride
 * left unfinished" — and a link there sits on the message's own surface, a
 * pair `design/tokens.ts` §`LINK_SURFACES` declares. But this page hands the
 * shell no ports, and measured on it **no route renders a link on any status
 * surface**: every link it draws sits on `canvas`, `surface` or the navigation's
 * `surfaceOverlay`. So `links.browser.spec.ts`'s check that each link's surface
 * is a declared pair would never meet a status surface at all, and would pass
 * over exactly the case where a link's colour is closest to the ink around it.
 *
 * What is real: the shipping {@link StatusMessage}, its classes and the shipping
 * stylesheet. What the harness supplies is the sentence and the `href`, which
 * points at the page itself so a press goes nowhere. `data-oyl-link-specimen` is
 * what the spec counts apart from a route's own links, so these cannot stand in
 * for a route that rendered none.
 */
const LINK_SPECIMENS = 'specimens';

const SPECIMEN_TONES: readonly StatusTone[] = ['info', 'success', 'warning', 'danger'];

function LinkSpecimens(): JSX.Element {
  return (
    <section data-oyl-link-specimen="true" aria-label="Link specimens">
      {SPECIMEN_TONES.map((tone) => (
        <StatusMessage key={tone} tone={tone}>
          A sentence with <a href="#/">a link in it</a>, as a {tone} message draws one.
        </StatusMessage>
      ))}
    </section>
  );
}

/**
 * `?controls=specimens` renders the native form controls #667 styles — opt-in
 * for `CAMERA_LIVE`'s reason, so every pre-existing case loads the page it was
 * written against.
 *
 * ⚠️ **Why specimens.** Handed no ports, the shell's routes render a
 * `StatusMessage` where their forms would be (see {@link TouchTargets}), so no
 * route here draws a file input, a radio or a `<select>` with options to open.
 * The markup is copied from the views that ship it — Routes' file input and its
 * loop box with the label BESIDE the control, Settings' radios and the trainer
 * game's boxes with the label WRAPPING it, Settings' "Say your power" select —
 * and the stylesheet and the layout box are the shipping ones.
 * `data-oyl-native-control` is what the spec counts, so a missing specimen is a
 * red build rather than an empty loop.
 *
 * The options are chosen for the typeahead case: exactly one starts with "f".
 * And the one checkbox label that is NOT copied is long on purpose: it wraps
 * at a phone's width, which is when a flex row squeezes its box (#667's CI run
 * found Settings' switch at 22.6 px that way).
 */
const CONTROL_SPECIMENS = 'specimens';

/**
 * `&base-select=off` is the select's CONTROL (#667): the same page with every
 * `@supports (appearance: base-select)` block deleted from the shipping sheet
 * through the CSSOM, which is the stylesheet an engine without `base-select`
 * would apply. The spec requires the closed skin only there, and requires the
 * option-height assertion to FAIL — which is what proves the positive case
 * measured the styled picker. It publishes how many blocks it removed, and the
 * spec requires one.
 */
const BASE_SELECT_OFF = 'off';

function removeBaseSelect(): number {
  let removed = 0;
  for (const sheet of [...document.styleSheets]) {
    const rules = sheet.cssRules;
    for (let index = rules.length - 1; index >= 0; index -= 1) {
      const rule = rules[index];
      if (rule instanceof CSSSupportsRule && rule.conditionText.includes('base-select')) {
        sheet.deleteRule(index);
        removed += 1;
      }
    }
  }
  return removed;
}

function NativeControls(): JSX.Element {
  return (
    <section data-oyl-native-controls="true" aria-label="Native control specimens">
      <p>
        <label htmlFor="specimen-file">GPX file</label>
        <input data-oyl-native-control="file" id="specimen-file" type="file" />
      </p>
      <p>
        <label data-oyl-native-row="beside" htmlFor="specimen-loop">
          This route is a loop
        </label>
        <input data-oyl-native-control="checkbox" id="specimen-loop" type="checkbox" />
      </p>
      <p>
        <label data-oyl-native-row="wrapping">
          <input data-oyl-native-control="checkbox" type="checkbox" defaultChecked /> Race your own
          best attempt, and ride against a pacer at the intensity you set below
        </label>
      </p>
      <fieldset className="oyl-fieldset">
        <legend>Which units do you ride in?</legend>
        <p>
          <label data-oyl-native-row="wrapping">
            <input
              data-oyl-native-control="radio"
              type="radio"
              name="specimen-units"
              defaultChecked
            />{' '}
            Metric — kilometres and kilograms
          </label>
        </p>
        <p>
          <label data-oyl-native-row="wrapping">
            <input data-oyl-native-control="radio" type="radio" name="specimen-units" /> Imperial —
            miles and pounds
          </label>
        </p>
      </fieldset>
      <p>
        <label htmlFor="specimen-select">Say your power</label>{' '}
        <select data-oyl-native-control="select" id="specimen-select" defaultValue="never">
          <option value="never">never</option>
          <option value="15">every 15 seconds</option>
          <option value="30">every 30 seconds</option>
          <option value="45">forty-five seconds</option>
        </select>
      </p>
      <p>
        <label htmlFor="specimen-range">Volume</label>{' '}
        <input data-oyl-native-control="range" id="specimen-range" type="range" />
      </p>
      <p>
        <progress data-oyl-native-control="progress" max={10} value={4} aria-label="Progress" />
      </p>
    </section>
  );
}

/**
 * `?hierarchy=specimens` renders one button of each kind, in each state a
 * rider can see, and a segmented control — #668 and #688, opt-in for
 * `CAMERA_LIVE`'s reason.
 *
 * ⚠️ **Why specimens.** This page hands the shell no ports, and measured on it
 * no route renders a toggle, a pressed toggle or a segmented control at all;
 * `button-hierarchy.browser.spec.ts` would read colours off nothing. What is
 * real: the shipping {@link Button} and the shipping stylesheet, and the
 * segmented control's markup is Settings' own (a `fieldset` of labels each
 * wrapping a native radio). What the harness supplies is the labels, and a
 * third segment, so the middle segment — joined on both sides — is measured.
 *
 * `data-oyl-kind` names each button's kind and state for the spec, and
 * `data-oyl-segment` each segment; the spec counts both before it measures.
 */
const HIERARCHY_SPECIMENS = 'specimens';

/**
 * `&hover-rule=off` is #688's CONTROL: the same page with the rule that gives
 * a secondary and a toggle their own hover deleted from the shipping sheet
 * through the CSSOM. The spec requires the pair read back there to be the one
 * #688 found — `accent` on `accentHover`, under 4.5:1 — which is what proves
 * the positive case measured the rule rather than something else. It
 * publishes how many rules it removed, and the spec requires one.
 */
const HOVER_RULE_OFF = 'off';

function removeLighterHover(): number {
  let removed = 0;
  for (const sheet of [...document.styleSheets]) {
    const rules = sheet.cssRules;
    for (let index = rules.length - 1; index >= 0; index -= 1) {
      const rule = rules[index];
      if (
        rule instanceof CSSStyleRule &&
        rule.selectorText.startsWith('.oyl-button--secondary:hover')
      ) {
        sheet.deleteRule(index);
        removed += 1;
      }
    }
  }
  return removed;
}

function HierarchySpecimens(): JSX.Element {
  return (
    <section data-oyl-hierarchy="true" aria-label="Button hierarchy specimens">
      <p>
        <Button>Start recording</Button> <Button variant="secondary">Pause</Button>{' '}
        <Button variant="toggle" pressed={false}>
          Mute sounds
        </Button>{' '}
        <Button variant="toggle" pressed>
          Show power
        </Button>
      </p>
      <p>
        <Button disabled>Save</Button>{' '}
        <Button variant="secondary" disabled>
          Keep riding
        </Button>{' '}
        <Button variant="toggle" pressed disabled>
          Show heart rate
        </Button>
      </p>
      <p>
        {/* A link drawn as a secondary button, as Routes' empty state draws one. */}
        <a data-oyl-link-button="true" className="oyl-button oyl-button--secondary" href="#/routes">
          Draw a route on this device
        </a>
      </p>
      <fieldset className="oyl-segmented">
        <legend>Which units do you ride in?</legend>
        <div className="oyl-segmented__options">
          {(['Kilometres', 'Miles', 'Nautical miles'] as const).map((label, index) => (
            <label key={label} data-oyl-segment={label}>
              <input type="radio" name="specimen-segmented" defaultChecked={index === 1} /> {label}
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
}

/**
 * `?illustration=specimens` renders the menus' house style (#936): a heading
 * at the display step, one drawing painted with every illustration colour,
 * and one element that moves the way a menu may.
 *
 * ⚠️ **Why specimens.** No screen draws art, a display heading or motion yet —
 * #938 onwards do — and a token no rule paints is the defect
 * `theme.a11y.test.ts` §"every token is painted by something" exists for. So
 * the rules the kit will use (`theme.css` §`.oyl-illo__*`, §`.oyl-display`,
 * §`.oyl-motion-enter`) are painted here with the shipping stylesheet, and
 * `shell.browser.spec.ts` §"#936" measures them. What the harness supplies is
 * the shapes and the words.
 *
 * The drawing is `aria-hidden` and carries no text, which is the house rule.
 * The heading's last word is long on purpose: at the display step it is wider
 * than a 320 px viewport, so the reflow case measures the wrap rather than a
 * heading that happened to fit.
 */
const ILLUSTRATION_SPECIMENS = 'specimens';

/**
 * `&motion-rule-off=<condition>` is the motion case's CONTROL (#936): the same
 * page with every `@media` block whose condition contains `<condition>` —
 * `prefers-reduced-motion` or `update` — deleted from the shipping sheet
 * through the CSSOM. The spec requires the specimen's transition to RUN there
 * under the same emulated preference, which is what proves the positive case
 * measured the block rather than a transition that never started. It
 * publishes how many blocks it removed, and the spec requires one.
 */
function removeMediaBlocks(condition: string): number {
  let removed = 0;
  for (const sheet of [...document.styleSheets]) {
    const rules = sheet.cssRules;
    for (let index = rules.length - 1; index >= 0; index -= 1) {
      const rule = rules[index];
      if (rule instanceof CSSMediaRule && rule.conditionText.includes(condition)) {
        sheet.deleteRule(index);
        removed += 1;
      }
    }
  }
  return removed;
}

/**
 * `&update=slow` applies the `@media (update: slow)` block as a screen that
 * cannot cheaply repaint would (#936). ⚠️ **The engine cannot be told it is
 * such a screen**: neither Playwright nor the DevTools protocol emulates the
 * `update` feature (`Emulation.setEmulatedMedia` accepts it and
 * `matchMedia('(update: slow)')` still answers no, measured on the pinned
 * Chromium). So the block's condition is rewritten to `all` through the
 * CSSOM, which applies exactly what the block says, and nothing else. What
 * this cannot prove is that a real e-ink panel matches the query — that is the
 * platform's. It publishes how many blocks it forced, and the spec requires one.
 */
function forceSlowUpdate(): number {
  let forced = 0;
  for (const sheet of [...document.styleSheets]) {
    for (const rule of [...sheet.cssRules]) {
      if (rule instanceof CSSMediaRule && rule.conditionText.includes('update: slow')) {
        rule.media.mediaText = 'all';
        forced += 1;
      }
    }
  }
  return forced;
}

function IllustrationSpecimens(): JSX.Element {
  return (
    <section data-oyl-illustration="true" aria-label="Illustration specimens">
      <h2 className="oyl-display" data-oyl-display="true">
        Choose a transcontinental ride
      </h2>
      <svg
        aria-hidden="true"
        data-oyl-illustration-drawing="true"
        focusable="false"
        viewBox="0 0 320 120"
        width="100%"
      >
        <rect className="oyl-illo__sky" data-oyl-illo="illoSky" width="320" height="120" />
        <circle className="oyl-illo__sun" data-oyl-illo="illoSun" cx="250" cy="34" r="16" />
        <path
          className="oyl-illo__hill-far"
          data-oyl-illo="illoHillFar"
          d="M0 78 Q80 44 160 70 T320 60 V120 H0 Z"
        />
        <path
          className="oyl-illo__hill-near"
          data-oyl-illo="illoHillNear"
          d="M0 96 Q100 70 200 92 T320 88 V120 H0 Z"
        />
        <path
          className="oyl-illo__road"
          data-oyl-illo="illoRoad"
          d="M150 120 Q170 104 210 96 L216 97 Q182 106 170 120 Z"
        />
      </svg>
      <p className="oyl-motion-enter" data-oyl-motion-specimen="true" data-oyl-entered="false">
        This line fades up into place.
      </p>
    </section>
  );
}

/**
 * The camera half of this page — #382, and it is **opt-in through the query
 * string**.
 *
 * ⚠️ **Why not simply always**: the live indicator is `position: fixed` at the
 * top of the viewport, and half the assertions on this page are about what is
 * at the top of the viewport — the header's height, where a fragment jump lands
 * the `h1`, and whether the focused skip link is the topmost thing at its own
 * centre. An indicator rendered unconditionally would be a new element inside
 * every one of those measurements, and the first symptom would be an existing
 * gate going red for a reason unrelated to the thing it guards. So
 * `?camera=live` is what turns it on, and every pre-existing case goes on
 * loading the page it was written against.
 *
 * What is real here is everything: the shipping `CameraController`, the
 * shipping `browserCameraPort`, the shipping `CameraIndicator` rendered by the
 * shipping `AppShell`, under the shipping stylesheet. The only thing the
 * harness supplies is the decision to switch it on.
 */
const CAMERA_LIVE = 'live';

/**
 * `?pairing=on` hands the shell a side-camera pairing port — #566's review —
 * so the Camera screen at `#/camera` renders its side-camera way in, whose
 * "Use this phone as the side camera" is a LINK drawn as a button inside a
 * sentence. Opt-in for `CAMERA_LIVE`'s reason: every pre-existing case goes on
 * loading the page it was written against. The port opens no connection until
 * a rider presses "Pair a phone", and nothing here does; its peer is `undefined`
 * so even that press could reach no network.
 */
const PAIRING_ON = 'on';

/** The `z-index` the ride stage declares — `theme.css` §"THE STAGE". */
const PRODUCT_MAXIMUM_STACKING = 20;

/**
 * A full-viewport element at the product's own maximum stacking order.
 *
 * ⚠️ **This is the "or an overlay" half of #382's requirement, made
 * measurable.** There is no `z-index` that wins against a hostile page and the
 * component's own header says so; what can be claimed and checked is that
 * nothing *this product draws* covers the indicator, and the highest thing this
 * product draws is the ride stage at 20 — which is precisely the state the
 * camera is most likely to be running in.
 *
 * `pointer-events: none` so it cannot swallow a click the rest of the page
 * needs; `elementFromPoint` ignores that property, so the hit test still sees
 * it and the assertion is unaffected.
 */
function StackingOverlay(): JSX.Element {
  return (
    <div
      data-oyl-overlay="true"
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: PRODUCT_MAXIMUM_STACKING,
        pointerEvents: 'none',
        background: 'rgba(0, 0, 0, 0.1)',
      }}
    />
  );
}

/**
 * The one thing on this page that runs the **real** capture path.
 *
 * ⚠️ **It is the only place in this repository where ADR 0029 D-9 is exercised
 * rather than asserted.** `frame.ts`'s refusal is a check on a guarantee, and
 * the guarantee is that `canvasFrameGrabber` re-encodes from raw pixels — one
 * line, in one adapter, reachable from no jsdom suite because jsdom implements
 * neither media playback nor a 2D canvas context. Everything above it could be
 * green against a fake returning bytes the test author typed.
 *
 * So this opens a real `getUserMedia` against the synthetic camera Chromium
 * provides under `--use-fake-device-for-media-stream`, draws it, encodes it,
 * and publishes what came out. `shell.browser.spec.ts` §"the camera, in a real
 * engine" is what reads it.
 *
 * ⚠️ It is a function on `window` rather than something this page runs on load,
 * because opening a camera on every visit would slow every other case here and
 * would put a media device in the middle of a layout gate.
 */
async function probeTheRealCamera(): Promise<unknown> {
  const devices = platformMediaDevices();
  if (devices === undefined) {
    return { opened: false, why: 'no mediaDevices in this browser' };
  }
  const port = browserCameraPort({
    devices,
    grabber: canvasFrameGrabber(),
    secureContext: globalThis.isSecureContext,
  });
  const availability = await port.cameraAvailability();
  const permission = await port.requestCameraAccess();
  const session = await port.startCamera();
  try {
    const frame = await session.captureFrame();
    return {
      opened: true,
      availability: availability.kind,
      permission: permission.kind,
      mediaType: frame.mediaType,
      bytes: frame.bytes.length,
      width: frame.width,
      height: frame.height,
      // The first two bytes of a JPEG, so the spec can say the browser really
      // produced one rather than trusting `mediaType`, which this code chose.
      soi: [frame.bytes[0], frame.bytes[1]],
    };
  } finally {
    session.stopCamera();
  }
}

/**
 * #387's real-engine probe: a real camera, a real capture, the REAL transport
 * and the platform's own `fetch`, sent to whatever address the spec hands in.
 *
 * `address === null` is the control — a controller with nothing configured —
 * and the spec asserts that it produces no request at all. Everything else is
 * the shipping chain `main.tsx` builds, with the endpoint decided by the same
 * `endpointDecision` the Camera screen uses.
 *
 * What comes back is the outcome's KIND and nothing of the answer's words.
 */
async function probeTheAnalysis(address: string | null): Promise<unknown> {
  const devices = platformMediaDevices();
  if (devices === undefined) {
    return { asked: false, why: 'no mediaDevices in this browser' };
  }
  const endpoint =
    address === null
      ? undefined
      : endpointDecision({ address, model: 'harness-model', switchedOn: true }).endpoint;
  const controller = new CameraController({
    port: browserCameraPort({
      devices,
      grabber: canvasFrameGrabber(),
      secureContext: globalThis.isSecureContext,
    }),
    schedule: () => () => undefined,
    analysis: () => riderAnalysisPort(endpoint),
  });
  controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
  await controller.turnOn();
  try {
    const outcome = await controller.askAboutPicture('connection-check').outcome;
    return {
      asked: true,
      configured: endpoint !== undefined,
      kind: outcome.kind,
      failure: outcome.kind === 'failed' ? outcome.failure : undefined,
      captured: controller.state().captured,
    };
  } finally {
    controller.turnOff();
  }
}

function main(): void {
  const host = document.querySelector('#shell');
  if (host === null) {
    throw new Error('shell harness: #shell is missing from shell.html');
  }

  const params = new URLSearchParams(globalThis.location.search);
  const wantsCamera = new URLSearchParams(globalThis.location.search).get('camera') === CAMERA_LIVE;
  const wantsPairing =
    new URLSearchParams(globalThis.location.search).get('pairing') === PAIRING_ON;
  const wantsLinkSpecimens =
    new URLSearchParams(globalThis.location.search).get('links') === LINK_SPECIMENS;
  const camera = new CameraController({
    // A port that never opens anything: what this page measures is where the
    // INDICATOR is drawn, and a real camera would be a media device in the
    // middle of a layout gate. `probeTheRealCamera` below is where a real one
    // is opened, on demand.
    port: {
      cameraAvailability: () => Promise.resolve({ kind: 'available' as const }),
      requestCameraAccess: () => Promise.resolve({ kind: 'granted' as const }),
      startCamera: () =>
        Promise.resolve({
          captureFrame: () => Promise.reject(new Error('this harness does not capture')),
          sampleLuminance: () => Promise.reject(new Error('this harness does not sample')),
          readCodePixels: () => Promise.reject(new Error('this harness reads no code')),
          captureSideFrame: () => Promise.reject(new Error('this harness sends no picture')),
          attachCameraPreview: () => () => undefined,
          stopCamera: () => undefined,
          live: true,
        }),
    },
    // No timer: nothing here ends the track, and an interval left running in a
    // gate is a gate that never settles.
    schedule: () => () => undefined,
  });

  flushSync(() => {
    createRoot(host).render(
      <StrictMode>
        <AppShell
          capabilities={NO_BLUETOOTH}
          camera={camera}
          {...(wantsPairing ? { sidePairing: sidePairingPort({ peer: () => undefined }) } : {})}
        />
      </StrictMode>,
    );
  });

  if (wantsCamera) {
    camera.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    void camera.turnOn();
  }

  const region = document.querySelector('.oyl-main');
  if (region === null) {
    throw new Error('shell harness: AppShell rendered no .oyl-main to extend');
  }

  // #316's specimens, in their own root inside `.oyl-main`. A second root
  // rather than a prop on `AppShell`, because the shell's job is to render a
  // route and adding a "render these buttons too" input to a shipping component
  // for a harness's benefit is the change `hud-harness.tsx` warns against.
  // `flushSync` for the same reason as above: the attribute the spec waits on
  // has to mean the browser has these boxes to lay out.
  const specimens = document.createElement('div');
  region.append(specimens);
  flushSync(() => {
    createRoot(specimens).render(
      <StrictMode>
        <TouchTargets />
      </StrictMode>,
    );
  });

  if (params.get('controls') === CONTROL_SPECIMENS) {
    const controls = document.createElement('div');
    region.append(controls);
    flushSync(() => {
      createRoot(controls).render(
        <StrictMode>
          <NativeControls />
        </StrictMode>,
      );
    });
    if (params.get('base-select') === BASE_SELECT_OFF) {
      document.documentElement.dataset['oylBaseSelectRemoved'] = String(removeBaseSelect());
    }
  }

  if (params.get('hierarchy') === HIERARCHY_SPECIMENS) {
    const hierarchy = document.createElement('div');
    region.append(hierarchy);
    flushSync(() => {
      createRoot(hierarchy).render(
        <StrictMode>
          <HierarchySpecimens />
        </StrictMode>,
      );
    });
    // Each specimen's kind and state, from the class and attribute the real
    // `Button` rendered — never from what this file asked for.
    for (const button of hierarchy.querySelectorAll<HTMLButtonElement>('button.oyl-button')) {
      const kind = button.classList.contains('oyl-button--toggle')
        ? `toggle-${button.getAttribute('aria-pressed') === 'true' ? 'on' : 'off'}`
        : button.classList.contains('oyl-button--secondary')
          ? 'secondary'
          : 'primary';
      button.dataset['oylKind'] = button.disabled ? `${kind}-disabled` : kind;
    }
    if (params.get('hover-rule') === HOVER_RULE_OFF) {
      document.documentElement.dataset['oylHoverRuleRemoved'] = String(removeLighterHover());
    }
  }

  if (params.get('illustration') === ILLUSTRATION_SPECIMENS) {
    const illustration = document.createElement('div');
    region.append(illustration);
    flushSync(() => {
      createRoot(illustration).render(
        <StrictMode>
          <IllustrationSpecimens />
        </StrictMode>,
      );
    });
    const off = params.get('motion-rule-off');
    if (off !== null) {
      document.documentElement.dataset['oylMotionRulesRemoved'] = String(removeMediaBlocks(off));
    }
    if (params.get('update') === 'slow') {
      document.documentElement.dataset['oylSlowUpdateForced'] = String(forceSlowUpdate());
    }
  }

  if (wantsLinkSpecimens) {
    const links = document.createElement('div');
    region.append(links);
    flushSync(() => {
      createRoot(links).render(
        <StrictMode>
          <LinkSpecimens />
        </StrictMode>,
      );
    });
  }

  const spacer = document.createElement('div');
  spacer.dataset['oylSpacer'] = 'true';
  spacer.style.height = `${String(SPACER_PIXELS)}px`;
  spacer.setAttribute('aria-hidden', 'true');
  region.append(spacer);

  if (wantsCamera) {
    const overlay = document.createElement('div');
    document.body.append(overlay);
    flushSync(() => {
      createRoot(overlay).render(
        <StrictMode>
          <StackingOverlay />
        </StrictMode>,
      );
    });
  }

  // #382's real-engine probe, reachable by name from the spec. @see probeTheRealCamera
  (globalThis as unknown as { __oylCamera?: () => Promise<unknown> }).__oylCamera =
    probeTheRealCamera;

  // #387's real-engine probe. @see probeTheAnalysis
  (
    globalThis as unknown as { __oylAnalysis?: (address: string | null) => Promise<unknown> }
  ).__oylAnalysis = probeTheAnalysis;

  document.documentElement.setAttribute(READY_ATTRIBUTE, 'true');
}

// #674: the view groups first, so every view renders on the render that asks. @see viewGroupsLoaded
void viewGroupsLoaded().then(main);
