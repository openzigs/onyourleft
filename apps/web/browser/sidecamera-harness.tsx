// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The tripod phone's filming sign, laid out by a real engine** — #528.
 *
 * #528's first criterion: *"A browser-gate measurement at a phone viewport
 * shows it is the dominant element."* jsdom performs no layout and resolves no
 * custom property (CLAUDE.md §4e), so nothing in the Vitest suite can say how
 * big the sign is, whether anything is drawn over it, or whether the stop
 * control is 44 × 44 and uncovered. This page renders the **real** `AppShell`
 * at the **real** side-camera route under the **real** `theme.css`, drives it
 * into the filming state through the screen's own controls, and publishes
 * what a real engine laid out.
 *
 * ## What is not real, and why
 *
 * - **The camera.** A port that never opens anything, as `shell-harness.tsx`'s
 *   is: what this page measures is where the SIGN is drawn, and a real camera
 *   would be a media device in the middle of a layout gate.
 * - **The link.** There is no production link (#529, held by ADR 0033 D-0), so
 *   the page hands the shell the scripted one the unit tests use, through
 *   `AppShellProps.sideCameraLink` — the prop #529 will fill.
 *
 * ## What it does NOT prove
 *
 * That the sign is legible from any particular doorway. It measures sizes in
 * CSS pixels; how many millimetres that is depends on the phone.
 * `theme.css` §"THE SIDE CAMERA" says what rule of thumb the floor is set
 * against, and that it was read second-hand.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { CameraController } from '../src/camera/session';
import { scriptedLink } from '../src/camera/testing';
import { AppShell } from '../src/shell/AppShell';
import type { CapabilityProbe } from '../src/support/bluetooth-support';

// The shipping stylesheet, which is the whole point — see this file's header.
import '../src/design/theme.css';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };
const PATIENCE_MS = 10_000;

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export interface SideCameraMeasurement {
  readonly viewport: { readonly width: number; readonly height: number };
  /** The filming stage, or `undefined` when it is not on the page. */
  readonly stage: Box | undefined;
  /** The big word's own box. */
  readonly word: Box | undefined;
  /** The big word's resolved font size, in pixels. */
  readonly wordFontSize: number;
  /** The largest resolved font size of any OTHER visible text on the page. */
  readonly largestOtherFontSize: number;
  /** Every visible control on the page — the criterion is that there is one. */
  readonly controls: readonly {
    readonly name: string;
    readonly box: Box;
    readonly onTop: boolean;
  }[];
  /**
   * What is at each point of a 7 × 7 grid over the viewport: `stage`, the
   * shell's `indicator`, or `other` — the criterion's *"nothing else on
   * screen"*, hit-tested rather than read off a stylesheet.
   */
  readonly grid: readonly ('stage' | 'indicator' | 'other')[];
  /** Whether the shell's header or navigation is in the document at all. */
  readonly chromePresent: boolean;
  /** The countdown's text, when there is one. */
  readonly countdown: string | undefined;
  readonly scrollY: number;
}

declare global {
  interface Window {
    __oylSideCamera?: {
      readonly ready: boolean;
      readonly errors: readonly string[];
      readonly measure: () => SideCameraMeasurement;
      /** The tablet goes quiet: D-5's countdown starts. */
      readonly loseLink: () => void;
      /**
       * The control: strip the stage's class, so the same markup is laid out
       * as an ordinary block. A measurement that stays "dominant" after this
       * was not measuring the stylesheet.
       */
      readonly unstyle: () => void;
    };
  }
}

const errors: string[] = [];

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

function textOf(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function visible(element: Element): boolean {
  const box = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return (
    box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  );
}

function measure(): SideCameraMeasurement {
  const stage = document.querySelector('[data-oyl-side-camera-stage]');
  const word = document.querySelector('.oyl-side-camera__word');
  const wordFontSize = word === null ? 0 : Number.parseFloat(getComputedStyle(word).fontSize);

  let largestOtherFontSize = 0;
  for (const element of document.body.querySelectorAll('*')) {
    if (element === word || word?.contains(element) === true || !visible(element)) {
      continue;
    }
    // Only elements that draw text of their own.
    const ownText = [...element.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
    );
    if (!ownText) {
      continue;
    }
    largestOtherFontSize = Math.max(
      largestOtherFontSize,
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
  }

  const controls = [...document.querySelectorAll('button, a[href], input, select, textarea')]
    .filter(visible)
    .map((control) => {
      const box = boxOf(control);
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return {
        name: textOf(control),
        box,
        onTop: hit !== null && (hit === control || control.contains(hit)),
      };
    });

  const grid: ('stage' | 'indicator' | 'other')[] = [];
  const steps = 7;
  for (let row = 0; row < steps; row += 1) {
    for (let column = 0; column < steps; column += 1) {
      const x = ((column + 0.5) / steps) * innerWidth;
      const y = ((row + 0.5) / steps) * innerHeight;
      const hit = document.elementFromPoint(x, y);
      grid.push(
        hit !== null && stage?.contains(hit) === true
          ? 'stage'
          : hit?.closest('[data-oyl-camera-indicator]') != null
            ? 'indicator'
            : 'other',
      );
    }
  }

  const countdown = document.querySelector('[role="timer"]');
  return {
    viewport: { width: innerWidth, height: innerHeight },
    stage: stage === null ? undefined : boxOf(stage),
    word: word === null ? undefined : boxOf(word),
    wordFontSize,
    largestOtherFontSize,
    controls,
    grid,
    chromePresent: document.querySelector('header, nav') !== null,
    countdown: countdown === null ? undefined : textOf(countdown),
    scrollY,
  };
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const started = performance.now();
  while (!condition()) {
    if (performance.now() - started > PATIENCE_MS) {
      throw new Error(`side-camera harness: timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function press(text: string): void {
  const button = [...document.querySelectorAll('button')].find((each) =>
    textOf(each).includes(text),
  );
  if (button === undefined) {
    throw new Error(`side-camera harness: no "${text}" button on the page`);
  }
  button.click();
}

async function run(): Promise<void> {
  const host = document.querySelector('#shell');
  if (host === null) {
    throw new Error('side-camera harness: #shell is missing from sidecamera.html');
  }
  globalThis.location.hash = '#/camera/side';

  const camera = new CameraController({
    port: {
      cameraAvailability: () => Promise.resolve({ kind: 'available' as const }),
      requestCameraAccess: () => Promise.resolve({ kind: 'granted' as const }),
      startCamera: () =>
        Promise.resolve({
          captureFrame: () => Promise.reject(new Error('this harness does not capture')),
          sampleLuminance: () => Promise.reject(new Error('this harness does not sample')),
          attachCameraPreview: () => () => undefined,
          stopCamera: () => undefined,
          live: true,
        }),
    },
    // No timer: nothing here ends the track, and an interval left running in a
    // gate is a gate that never settles.
    schedule: () => () => undefined,
  });
  const link = scriptedLink();

  flushSync(() => {
    createRoot(host).render(
      <StrictMode>
        <AppShell capabilities={NO_BLUETOOTH} camera={camera} sideCameraLink={link} />
      </StrictMode>,
    );
  });

  // Through the screen's own controls, as a rider would: the box, then the
  // button, then the tablet's start.
  await until(() => document.querySelector('input[type="checkbox"]') !== null, 'the consent');
  document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
  await until(
    () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked === true,
    'the box to be ticked',
  );
  press('Turn the camera on');
  await until(() => document.querySelector('video') !== null, 'the framing picture');
  link.emit({ kind: 'start' });
  await until(
    () =>
      document.querySelector('[data-oyl-side-camera-stage]') !== null &&
      document.querySelector('header') === null,
    'the filming sign, with the chrome gone',
  );

  window.__oylSideCamera = {
    ready: true,
    errors,
    measure,
    loseLink: () => {
      link.emit({ kind: 'condition', condition: 'lost' });
    },
    unstyle: () => {
      document
        .querySelector('[data-oyl-side-camera-stage]')
        ?.classList.remove('oyl-side-camera__stage');
    },
  };
}

run().catch((error: unknown) => {
  errors.push(error instanceof Error ? error.message : String(error));
  window.__oylSideCamera = {
    ready: false,
    errors,
    measure,
    loseLink: () => undefined,
    unstyle: () => undefined,
  };
});
