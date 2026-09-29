// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The page the ride-layout half of the browser gate drives — #373, and since
 * #423 the stage.
 *
 * It renders the **real** `shell/AppShell.tsx` at the **real** game route,
 * hands it a game port with one route on it, and then **rides**: it ticks the
 * picker's own checkboxes, types a wind speed and presses the picker's own
 * *Ride* button. What is on the page after that is what a rider has — the real
 * `GameView` on the real stage, the real `HudPanel` over it, the shell with its
 * chrome absent because `GameView` told it so — under the **real**
 * `design/theme.css`. Nothing about the geometry is this file's.
 *
 * ## ⚠️ A reviewer who remembers this file rendering `<HudPanel>` by hand is
 * reading the old one, and the difference is the point of #423
 *
 * Until #423 this page hid the shell's view and mounted a **copy of
 * `GameView`'s markup** beside it — a `section.oyl-game` with a canvas and a
 * panel, typed out here. That was honest about the box model and blind to
 * everything #423 is: whether the stage class is on the element, whether the
 * shell stops rendering its header when a ride starts, whether the notices are
 * inside the HUD's grid. A harness that re-types the product's markup measures
 * its own typing (#236 is what that costs). So the ride is now started the way
 * a rider starts it, and a `GameView` that stopped putting `oyl-game--riding`
 * on its root, or a shell that stopped listening, fails here rather than
 * passing over a fixture that still does both.
 *
 * ## What it exists to catch, and why no other gate could
 *
 * Measured on a Pixel Tablet, landscape, on 2026-09-20 (#422): canvas, HUD
 * fields, elevation strip and plan view visible; **Pause, End ride and the
 * trainer line below the fold**; about 53 % of the display blank. #419 had
 * already measured the same thing in this harness at four viewports. Every
 * gate was green, because `test:a11y` renders into jsdom, which performs no
 * layout (CLAUDE.md §4e); `shell.browser.spec.ts` measures chrome at 320×256
 * and never renders a HUD; `hud.browser.spec.ts` measures grid tracks and never
 * asks where the panel is on the page; and **nothing measured any ride screen
 * at a landscape-tablet viewport at all**.
 *
 * ## The fixture is the WIDEST ride the picker can start
 *
 * A pacer **and** a ghost **and** a wind, so the secondary tier carries six
 * fields rather than four, and a trainer that accepts gradients, so the trainer
 * line is there. A HUD that fits with four fields and clips with six is the
 * failure this would otherwise miss, and every one of those is a checkbox a
 * rider can tick.
 *
 * ## The control, and why a green run would otherwise mean nothing
 *
 * ⚠️ `window.__oylRide.unstage()` takes `oyl-game--riding` **off the live
 * element** — the same DOM, the same stylesheet, the same viewport, without the
 * one class #423 added. The spec requires *Pause* to be **below the fold**
 * again at a landscape phone, which is #419's own measurement. Without it a
 * stylesheet that failed to load, a ride that never started and a HUD that
 * rendered nothing would all report "every control is on screen".
 *
 * React does not put the class back: `className` is a constant string in
 * `GameView`, so no later render has a changed prop to write.
 *
 * ## What this page does NOT prove
 *
 * That the ride screen **looks right** — there is no reference image and ADR
 * 0009 forbids deriving one from another product. It renders **no WebGL**: no
 * renderer is handed to the shell, so the canvas is the shipping element with
 * the shipping box and nothing drawn in it; `game.html` owns the scene. And it
 * says nothing about a real tablet: 1280×800 in a headless Chromium has no
 * status bar, no gesture bar and no thumb.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

import {
  altitudeMetres,
  buildGhostTrack,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  watts,
  type RoutePoint,
  type RouteProfile,
  type WorkoutRescue,
} from '@onyourleft/domain';

import { scriptedSidePairing } from '../src/camera/testing';
import type { GamePort } from '../src/game/GameView';
import type { GameTrainerPort } from '../src/game/trainer-port';
import { CUES_STORAGE_KEY, DEFAULT_CUES, writeCuePreference } from '../src/game/cue-preference';
import { AppShell } from '../src/shell/AppShell';
import { viewGroupsLoaded } from './views-loaded';
import type { CapabilityProbe } from '../src/support/bluetooth-support';

// The shipping stylesheet, which is the whole point — see this file's header.
import '../src/design/theme.css';

/** A browser with no Bluetooth, which is what a headless Chromium is. */
const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

/** The class #423 added, and the one thing the control removes. */
const STAGE_CLASS = 'oyl-game--riding';

/** How long the harness waits for the product to get somewhere, in milliseconds. */
const PATIENCE_MS = 10_000;

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

/** One thing a rider has to be able to see or press. */
export interface StageItem {
  /** What it is, for a failure message a person can act on. */
  readonly name: string;
  readonly box: Box;
  /**
   * Whether the element is the topmost thing at its own centre.
   *
   * ⚠️ Hit-tested rather than inferred from a box, which is
   * `shell.browser.spec.ts`'s posture toward the skip link: two panels can
   * each be wholly inside the viewport and one of them be underneath the
   * other, and a rectangle cannot say which.
   */
  readonly onTop: boolean;
}

export interface StageMeasurement {
  readonly viewport: { readonly width: number; readonly height: number };
  /** The stage, or `undefined` once the control has taken the class off. */
  readonly stage: Box | undefined;
  readonly world: Box | undefined;
  /** Every direct child of `.oyl-hud` — the panels, and the notice slot if any. */
  readonly panels: readonly StageItem[];
  /** Every reading, the strip, the plan view, the trainer line and both controls. */
  readonly items: readonly StageItem[];
  /** The labels of the readings, in document order, per tier. */
  readonly primary: readonly string[];
  readonly secondary: readonly string[];
  /** Type sizes in CSS pixels, so "visibly larger" is read off the engine. */
  readonly primaryValuePixels: number;
  readonly secondaryValuePixels: number;
  /** Whether each piece of page chrome is in the document at all. */
  readonly chrome: {
    readonly header: boolean;
    readonly navigation: boolean;
    readonly summary: boolean;
    readonly footer: boolean;
    readonly skipLink: boolean;
  };
  /** How far anything has been scrolled. A reachable control needs all three at 0. */
  readonly scrollY: number;
  readonly stageScrollTop: number;
  /** How far the document COULD scroll: `scrollHeight − innerHeight`. */
  readonly pageOverflow: number;
  /** What `theme.css` resolved a panel's background to, as a load check. */
  readonly panelBackground: string;
}

declare global {
  interface Window {
    __oylRide?: {
      readonly ready: boolean;
      readonly errors: readonly string[];
      readonly measure: () => StageMeasurement;
      /** The control. @see this file's header */
      readonly unstage: () => void;
      /** What Capacitor's Android shell injects. @see theme.css §--oyl-safe-top */
      readonly setSafeArea: (pixels: number) => void;
      /** #439's control: the shell's old `min-height: 100vh`. @see restoreFullHeightShell */
      readonly restoreFullHeightShell: () => void;
      /** #437's control: a notice takes the route cell even collapsed. */
      readonly restoreNoticeTakesTheRoute: () => void;
    };
  }
}

const errors: string[] = [];

/** A rolling route, so the gradient field and the trainer line carry a sign. */
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
      elevation: altitudeMetres(60 + 40 * Math.sin((index / count) * 6 * Math.PI)),
    });
  }
  return routeProfile(points);
}

const GAME: GamePort = {
  // `attempts: 1`, so the picker offers the ghost — see this file's header.
  listRoutes: () =>
    Promise.resolve([{ id: 'harness', name: 'Harness hills', profile: route(), attempts: 1 }]),
  loadGhost: () =>
    Promise.resolve(buildGhostTrack({ elapsedSeconds: [0, 3_600], distanceMetres: [0, 36_000] })),
  readSensors: () => ({
    rider: { power: watts(342), live: true, paired: true },
    cadence: { value: 92, live: true, paired: true },
    heartRate: { value: 168, live: true, paired: true },
  }),
};

/**
 * `ride.html?trainer=workout` — a ride with something to SAY.
 *
 * A trainer a workout is already driving produces `GameView`'s standing
 * warning, *"The road is not reaching your trainer"*, for the whole ride — and
 * of the four sentences `trainer-port.ts` §`trainerRoadNotice` can produce it
 * is the longest, which is the one a layout has to survive. That is the HUD's fifth grid item, it is the one most likely to land
 * on the rider, and the default fixture never renders it — a trainer that
 * accepts gradients has nothing to warn about. The two are mutually exclusive
 * by construction (`GameView` §`trainerReading`), so they are two fixtures.
 */
const WITH_A_NOTICE =
  new URLSearchParams(window.location.search).get('trainer') === 'workout' ||
  new URLSearchParams(window.location.search).get('rescue') !== null;

/**
 * `ride.html?rescue=floor` — the workout fixture above with the workout's stall
 * rescue in force (#585, PR #599's review finding B1). A rescue only exists on
 * a running workout, so this implies `?trainer=workout`.
 *
 * ⚠️ **The floor, deliberately**: of the rescue's sentences it is the longest
 * one `workout/rescue-text.ts` can build, because only the floor adds the
 * two-step way back. Until this query the double returned `undefined` from
 * `workoutRescue`, so no browser gate had ever laid out the HUD with an
 * "Eased" notice — and on a phone on its side it pushed Pause and End ride off
 * the stage with all 460 browser cases green.
 */
const RESCUE: WorkoutRescue | undefined =
  new URLSearchParams(window.location.search).get('rescue') === 'floor'
    ? {
        kind: 'floor',
        reason: 'Pedalling has stopped, so the target has been dropped to the trainer’s lowest.',
      }
    : undefined;

/**
 * `ride.html?sounds=on` — a ride with #400's mute and volume in the HUD's
 * actions panel, which makes that panel taller. Written through the product's
 * own preference module before the ride starts, exactly as Settings would.
 */
const WITH_SOUNDS = new URLSearchParams(window.location.search).get('sounds') === 'on';

/**
 * `ride.html?side=filming` and `?side=lost` — a ride with a tripod phone
 * paired (#551). `filming` puts the side camera's line and *Stop side camera*
 * in the actions panel, which makes it taller; `lost` puts the lost link in
 * the notice slot, the HUD's exception, and keeps the stop. The pairing is the
 * scripted one the unit tests use: the real link needs a second device.
 */
const SIDE = new URLSearchParams(window.location.search).get('side');
/**
 * `?side=ended` — #577's review, finding 1: a lost link that ENDED the
 * pairing. Terminal, so it is the actions panel's line and not a notice, and
 * there is nothing left to stop.
 */
const SIDE_PAIRING =
  SIDE === 'filming' || SIDE === 'lost'
    ? scriptedSidePairing({ phone: SIDE })
    : SIDE === 'ended'
      ? scriptedSidePairing({ phone: 'lost', ended: 'link-lost' })
      : undefined;

/**
 * `ride.html?keepalive=failed` — #647: the ride being recorded may stop if
 * the screen goes off, because the platform refused the recording service.
 * `GameView` reads it from the port on every frame, as it reads the rescue, and
 * puts its one sentence in the notice cell. Combines with `?trainer=workout`,
 * whose road notice stands beside it for the first minute of a ride.
 */
const MAY_STOP = new URLSearchParams(window.location.search).get('keepalive') === 'failed';

/**
 * `ride.html?gradient=refused` — a trainer that refuses every gradient, so the
 * HUD carries the *Trainer* fault in its notice cell (#693's re-review: the
 * cell stacks every notice that is never put away, and keep-the-screen-on is
 * measured beside each of them). The refusal is `control-not-permitted`,
 * whose sentence is the longest of `gradient.ts` §`faultText`'s four.
 *
 * ⚠️ The fault is cleared as each new gradient is offered and set again when
 * it is refused, so it can be absent for a frame. A measurement that needs it
 * checks for it in the same evaluation.
 */
const REFUSED = new URLSearchParams(window.location.search).get('gradient') === 'refused';

/**
 * `ride.html?paused=yes` — #710's review: the ride PAUSED, by pressing the
 * HUD's own *Pause*, so that control reads *Resume*. It is the same element
 * with a different word, and a ride-time control the owner's ruling (#669)
 * names, so `ride-targets.browser.spec.ts` measures it in this state too.
 */
const PAUSED = new URLSearchParams(window.location.search).get('paused') === 'yes';

/** A trainer that accepts every gradient, so the trainer line is on the screen. */
const TRAINER: GameTrainerPort = {
  // #503: the Ride press's request for control — this double changes nothing.
  askForControlOnRide: () => Promise.resolve(),
  workoutRescue: () => RESCUE,
  recordingMayStop: () => MAY_STOP,
  readTrainer: () =>
    WITH_A_NOTICE
      ? { kind: 'workout', control: undefined }
      : {
          kind: 'ready',
          control: {
            setSimulationParameters: async () =>
              REFUSED ? Promise.reject(new Error('control-not-permitted')) : Promise.resolve(),
            letGo: async () => Promise.resolve({ kind: 'stopped' as const }),
          },
        },
};

async function until<T>(what: string, look: () => T | undefined | null): Promise<T> {
  const deadline = performance.now() + PATIENCE_MS;
  for (;;) {
    const found = look();
    if (found !== undefined && found !== null) {
      return found;
    }
    if (performance.now() > deadline) {
      throw new Error(`ride harness: gave up waiting for ${what}`);
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  }
}

function labelled<T extends HTMLElement>(selector: string, text: string): T | undefined {
  return [...document.querySelectorAll<T>(selector)].find((each) =>
    (each.closest('label')?.textContent ?? each.textContent ?? '').includes(text),
  );
}

/** Type into a React-controlled input the way a keyboard does. */
function type(input: HTMLInputElement, value: string): void {
  // React tracks a controlled input's value through its own setter, so
  // assigning `input.value` is invisible to it; the prototype's setter is not.
  // `testing/mount.tsx` §`typeInto` is the same move, in jsdom.
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (descriptor?.set === undefined) {
    throw new Error('ride harness: this browser has no HTMLInputElement value setter');
  }
  descriptor.set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function boxOf(element: Element): Box {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function item(name: string, element: Element): StageItem {
  const box = boxOf(element);
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return { name, box, onTop: hit !== null && (hit === element || element.contains(hit)) };
}

function textOf(element: Element | null): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function fontPixels(selector: string): number {
  const element = document.querySelector(selector);
  return element === null ? 0 : Number.parseFloat(window.getComputedStyle(element).fontSize);
}

function measure(): StageMeasurement {
  const stage = document.querySelector(`.${STAGE_CLASS}`);
  const world = document.querySelector('.oyl-game__world');
  const items: StageItem[] = [];
  for (const field of document.querySelectorAll('.oyl-hud__field')) {
    items.push(item(`reading: ${textOf(field.querySelector('dt'))}`, field));
  }
  for (const [name, selector] of [
    ['the elevation strip', '.oyl-hud__profile-svg'],
    ['the plan view', '.oyl-hud__plan-svg'],
    ['the trainer line', '.oyl-hud__trainer'],
    ['the side camera line', '.oyl-hud__side-camera'],
    ['the side camera stop', '.oyl-hud__side-camera-stop'],
  ] as const) {
    const element = document.querySelector(selector);
    if (element !== null) {
      items.push(item(name, element));
    }
  }
  for (const control of document.querySelectorAll('.oyl-hud__control')) {
    items.push(item(`control: ${textOf(control)}`, control));
  }
  // #400: the mute and the volume, when the rider turned sounds on.
  for (const control of document.querySelectorAll('.oyl-sound button, .oyl-sound input')) {
    items.push(item(`sound: ${textOf(control.closest('label') ?? control)}`, control));
  }
  const labels = (selector: string): string[] =>
    [...document.querySelectorAll(`${selector} dt`)].map(textOf);
  const panel = document.querySelector('.oyl-hud__panel');
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    stage: stage === null ? undefined : boxOf(stage),
    world: world === null ? undefined : boxOf(world),
    // The grid items a rider SEES. Since #397 the HUD also holds its one live
    // region, visually hidden by clip — a 1 px box that is not a panel and
    // must not be counted as one.
    // #576: on a short landscape phone with sounds on, the side camera's row
    // is lifted out of the actions panel by anchor positioning and drawn as a
    // panel of its own (`theme.css` §"SOUNDS ON AND A SIDE CAMERA PAIRED").
    // It is still the actions panel's child in the document, so it is counted
    // as a panel only when it has been lifted out — otherwise every
    // measurement would find it "over" the panel it is inside.
    panels: [
      ...document.querySelectorAll('.oyl-hud > :not([data-oyl-announcer])'),
      ...[...document.querySelectorAll('.oyl-hud__side-camera-row')].filter(
        (each) => window.getComputedStyle(each).position === 'absolute',
      ),
    ].map((each) => item(each.className, each)),
    items,
    primary: labels('.oyl-hud__fields--primary'),
    secondary: labels('.oyl-hud__fields--secondary'),
    primaryValuePixels: fontPixels('.oyl-hud__fields--primary .oyl-hud__value'),
    secondaryValuePixels: fontPixels('.oyl-hud__fields--secondary .oyl-hud__value'),
    chrome: {
      header: document.querySelector('header.oyl-header') !== null,
      navigation: document.querySelector('nav[aria-label="Primary"]') !== null,
      summary: document.querySelector('main > p.oyl-muted') !== null,
      footer: document.querySelector('footer.oyl-footer') !== null,
      skipLink: document.querySelector('.oyl-skip-link') !== null,
    },
    scrollY: window.scrollY,
    stageScrollTop: stage?.scrollTop ?? 0,
    pageOverflow: document.documentElement.scrollHeight - window.innerHeight,
    panelBackground: panel === null ? '' : window.getComputedStyle(panel).backgroundColor,
  };
}

function unstage(): void {
  const stage = document.querySelector(`.${STAGE_CLASS}`);
  if (stage === null) {
    throw new Error('ride harness: there is no stage to take the class off');
  }
  stage.classList.remove(STAGE_CLASS);
}

function setSafeArea(pixels: number): void {
  for (const edge of ['top', 'right', 'bottom', 'left']) {
    document.documentElement.style.setProperty(`--safe-area-inset-${edge}`, `${String(pixels)}px`);
  }
}

/**
 * #439's control — put back the rule the shell had before: one whole viewport
 * tall, on top of a `body` padded by the insets. With edge-to-edge insets the
 * document must scroll again by their sum; without that, "the ride does not
 * scroll" is equally true of a page that rendered no shell at all.
 */
function restoreFullHeightShell(): void {
  const style = document.createElement('style');
  style.textContent = '.oyl-shell { min-height: 100vh; }';
  document.head.append(style);
}

/**
 * #437's control — put back the rule before it: a notice, open or not, hides
 * the route panel on a phone. With the notice put away the strip and the plan
 * view must be gone again; without that, "the plan view is on screen after the
 * notice is put away" is equally true of a harness whose notice never rendered.
 */
function restoreNoticeTakesTheRoute(): void {
  const style = document.createElement('style');
  style.textContent =
    '.oyl-game--riding .oyl-hud:has(> .oyl-hud__notices) .oyl-hud__route { display: none; }';
  document.head.append(style);
}

async function run(): Promise<void> {
  const host = document.querySelector('#shell');
  if (host === null) {
    throw new Error('ride harness: #shell is missing from ride.html');
  }
  // The real route, so the shell renders the real view.
  window.location.hash = '#/game';
  // #400: a fresh origin every run, so absent means off.
  localStorage.removeItem(CUES_STORAGE_KEY);
  if (WITH_SOUNDS) {
    writeCuePreference(localStorage, { ...DEFAULT_CUES, enabled: true });
  }

  // #674: the view groups first, so every view renders on the render that asks.
  await viewGroupsLoaded();
  flushSync(() => {
    createRoot(host).render(
      <StrictMode>
        <AppShell
          capabilities={NO_BLUETOOTH}
          game={GAME}
          gameTrainer={TRAINER}
          {...(SIDE_PAIRING === undefined ? {} : { sidePairing: SIDE_PAIRING })}
        />
      </StrictMode>,
    );
  });

  // The picker, once `listRoutes` has resolved. Everything below is what a
  // rider does with it — see "The fixture is the WIDEST ride" above.
  const ride = await until('the picker to offer a ride', () =>
    labelled<HTMLButtonElement>('button', 'Ride '),
  );
  for (const text of ['pacer', 'Race your', 'Ride in a wind']) {
    const box = labelled<HTMLInputElement>('input[type="checkbox"]', text);
    if (box === undefined || box.disabled) {
      throw new Error(`ride harness: the picker offers no usable "${text}" checkbox`);
    }
    box.click();
  }
  const speed = await until('the wind speed box', () =>
    labelled<HTMLInputElement>('input[type="number"]', 'Wind speed'),
  );
  type(speed, '40');
  // A frame, so React has committed the wind before the button reads it.
  await until('the ride button to be usable', () =>
    ride.getAttribute('aria-disabled') === 'true' ? undefined : ride,
  );
  ride.click();

  await until('the ride to take the stage', () => document.querySelector(`.${STAGE_CLASS}`));
  // The trainer line appears once the gradient session has written once, which
  // is a frame or two in. Waiting for it is what makes it part of every
  // measurement rather than of whichever ones happened to run late.
  // A refusing trainer never shows the line for long: its fault replaces it.
  const noticeFirst = WITH_A_NOTICE || REFUSED;
  await until(noticeFirst ? 'the notice' : 'the trainer line', () =>
    document.querySelector(noticeFirst ? '.oyl-hud__notices' : '.oyl-hud__trainer'),
  );
  // #585: the Eased notice, when this page was asked for a rescue.
  if (RESCUE !== undefined) {
    await until('the Eased notice', () =>
      [...document.querySelectorAll('.oyl-hud__notices')].find((each) =>
        (each.textContent ?? '').includes('Eased'),
      ),
    );
  }
  // #647: the keep-the-screen-on notice, when this page was asked for one.
  if (MAY_STOP) {
    await until('the keep-the-screen-on notice', () =>
      [...document.querySelectorAll('.oyl-hud__notices')].find((each) =>
        (each.textContent ?? '').includes('Keep the screen on'),
      ),
    );
  }
  // The trainer's fault, when this page was asked for a refusing trainer.
  if (REFUSED) {
    await until('the trainer fault', () =>
      [...document.querySelectorAll('.oyl-hud__notices')].find((each) =>
        (each.textContent ?? '').includes('stopped accepting the road'),
      ),
    );
  }
  // #551: the side camera's line or notice, when this page was asked for one.
  if (SIDE_PAIRING !== undefined) {
    await until('the side camera on the HUD', () =>
      SIDE === 'ended'
        ? document.querySelector('.oyl-hud__side-camera')
        : [...document.querySelectorAll('.oyl-hud button')].find(
            (each) => each.textContent === 'Stop side camera',
          ),
    );
  }
  // #710's review: the paused HUD, reached the way a rider reaches it.
  if (PAUSED) {
    const pause = await until('the HUD’s Pause', () =>
      [...document.querySelectorAll<HTMLButtonElement>('.oyl-hud__control')].find(
        (each) => each.textContent === 'Pause',
      ),
    );
    pause.click();
    await until('the HUD’s Resume', () =>
      [...document.querySelectorAll('.oyl-hud__control')].find(
        (each) => each.textContent === 'Resume',
      ),
    );
  }
  // ⚠️ Before anything is measured. @see hud-harness.tsx
  await document.fonts.ready;

  window.__oylRide = {
    ready: true,
    errors,
    measure,
    unstage,
    setSafeArea,
    restoreFullHeightShell,
    restoreNoticeTakesTheRoute,
  };
}

run().catch((error: unknown) => {
  errors.push(error instanceof Error ? error.message : String(error));
  window.__oylRide = {
    ready: false,
    errors,
    measure,
    unstage,
    setSafeArea,
    restoreFullHeightShell,
    restoreNoticeTakesTheRoute,
  };
});
