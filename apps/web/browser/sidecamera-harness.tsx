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
 *   ⚠️ **Except `?pictures=`** (#1112), which measures the picture RATE and
 *   so opens the synthetic camera through the real `browserCameraPort`; its
 *   comment below says what it stands in for.
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

import {
  browserCameraPort,
  canvasFrameGrabber,
  videoSidePictureSampler,
} from '../src/camera/browser-camera';
import { CameraController } from '../src/camera/session';
import { mainThreadJpegEncoder } from '../src/camera/side-picture-encoder';
import { scriptedLink, scriptedSidePairing } from '../src/camera/testing';
import { AppShell } from '../src/shell/AppShell';
import { viewGroupsLoaded } from './views-loaded';
import type { CapabilityProbe } from '../src/support/bluetooth-support';

// The shipping stylesheet, which is the whole point — see this file's header.
import '../src/design/theme.css';
import '../src/design/tailwind.css';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

/**
 * `?pairing=scan` — #1108: the phone UNPAIRED, framing, looking for the
 * tablet's code, with a camera picture the shape an upright phone's camera
 * gives (720 × 1280). That is the screen the owner found no way to pair on:
 * the instruction and "Looking for the tablet's code…" were under a picture as
 * tall as the screen.
 */
const PAIRING_SCAN = new URLSearchParams(location.search).get('pairing') === 'scan';

/**
 * `?pictures=worker` and `?pictures=main-thread` — #1112: the phone FILMING
 * through the real shell with the REAL camera path (`browserCameraPort` over
 * the synthetic camera, `canvasFrameGrabber`, the real session's picture
 * timer), with a main thread that is never idle, and how many pictures reach
 * the link in {@link PICTURE_RATE_MILLISECONDS}.
 *
 * `worker` is the product. `main-thread` is the control: the same page with
 * the side sampler's encoder put back to `canvas.toBlob`, which is what every
 * picture used before #1112.
 *
 * ⚠️ **The busy main thread is a stand-in, and says so.** On the owner's phone
 * something kept the WebView's main thread from giving Chromium an idle
 * period, and a main-thread JPEG encode waits for one (`camera/
 * side-picture-encoder.ts`' header): up to 4 s on Android, 1 s here. What
 * keeps that phone's thread busy is not established; a chain of 4 ms tasks
 * is the simplest page that never idles, and on it the old encoder waits the
 * whole timeout for every picture.
 */
const PICTURES = new URLSearchParams(location.search).get('pictures');

/** How long the rate is measured over, once filming has begun. */
const PICTURE_RATE_MILLISECONDS = 3000;

/** What `?pictures=` measures. */
export interface PictureRateMeasurement {
  readonly encoder: string;
  /** Pictures the link accepted inside the window. */
  readonly pictures: number;
  readonly milliseconds: number;
  /** The page's own recorder, as `webview-probe.mjs` would read it. */
  readonly timings: unknown;
  /** Whether the filming sign was up for the whole window. */
  readonly filmingThroughout: boolean;
}

/** An upright phone's camera picture, as a stream a `<video>` can play. */
function uprightPicture(): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 1280;
  const context = canvas.getContext('2d');
  if (context !== null) {
    context.fillStyle = '#556';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas.captureStream(1);
}

/** What `?pairing=scan` measures: where the pairing is, against the fold. */
export interface PairingMeasurement {
  readonly viewport: { readonly width: number; readonly height: number };
  /** The pairing instruction, "To pair with your tablet…". */
  readonly instruction: Box | undefined;
  /** Its status, "Looking for the tablet's code…". */
  readonly status: Box | undefined;
  /** The camera's picture. */
  readonly picture: Box | undefined;
  /** The top of a bottom navigation bar, or the viewport's bottom. */
  readonly fold: number;
  readonly scrollY: number;
}
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
  /**
   * The largest resolved font size of any OTHER visible text on the page.
   *
   * ⚠️ Visible means drawn: the shell keeps the route's `h1` in the document
   * while the chrome is absent, clipped to a 1 px box for screen readers
   * (`oyl-visually-hidden`), and a 1 px box is not text anybody in the room
   * can see, so it is not a rival to the sign.
   */
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
      /** `?pairing=scan` only (#1108): where the pairing is. */
      readonly pairing?: () => PairingMeasurement;
      /**
       * `?pairing=scan` only: the control — the pairing moved back BELOW the
       * picture, which is the order #1108 was filed against.
       */
      readonly oldOrder?: () => void;
      /** `?pictures=` only (#1112): the measured rate. */
      readonly pictures?: PictureRateMeasurement;
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
  // More than a pixel each way: `oyl-visually-hidden` leaves exactly one.
  return (
    box.width > 1 && box.height > 1 && style.visibility !== 'hidden' && style.display !== 'none'
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

function measurePairing(): PairingMeasurement {
  const pairing = document.querySelector('[data-oyl-side-pairing]');
  const paragraphs = pairing === null ? [] : [...pairing.querySelectorAll('p')];
  const instruction = paragraphs.find((each) =>
    textOf(each).startsWith('To pair with your tablet'),
  );
  const status = pairing?.querySelector('[role="status"]');
  const picture = document.querySelector('.oyl-framing__picture');
  const bars = [...document.querySelectorAll('nav')]
    .map((nav) => nav.getBoundingClientRect())
    .filter((box) => box.height > 0 && box.top > innerHeight / 2);
  return {
    viewport: { width: innerWidth, height: innerHeight },
    instruction: instruction === undefined ? undefined : boxOf(instruction),
    status: status === null || status === undefined ? undefined : boxOf(status),
    picture: picture === null ? undefined : boxOf(picture),
    fold: Math.min(innerHeight, ...bars.map((box) => box.top)),
    scrollY,
  };
}

async function runPairingScan(host: Element): Promise<void> {
  globalThis.location.hash = '#/camera/side';
  const camera = new CameraController({
    port: {
      cameraAvailability: () => Promise.resolve({ kind: 'available' as const }),
      requestCameraAccess: () => Promise.resolve({ kind: 'granted' as const }),
      startCamera: () =>
        Promise.resolve({
          captureFrame: () => Promise.reject(new Error('this harness does not capture')),
          sampleLuminance: () => Promise.reject(new Error('this harness does not sample')),
          // Nothing to read, so the screen goes on looking — the state measured.
          readCodePixels: () => Promise.reject(new Error('this harness reads no code')),
          captureSideFrame: () => Promise.reject(new Error('this harness sends no picture')),
          attachCameraPreview: (surface) => {
            surface.srcObject = uprightPicture();
            surface.muted = true;
            surface.playsInline = true;
            void surface.play().catch(() => undefined);
            return () => {
              surface.srcObject = null;
            };
          },
          stopCamera: () => undefined,
          live: true,
        }),
    },
    schedule: () => () => undefined,
  });
  await viewGroupsLoaded();
  flushSync(() => {
    createRoot(host).render(
      <StrictMode>
        <AppShell
          capabilities={NO_BLUETOOTH}
          camera={camera}
          sidePairing={scriptedSidePairing({ phone: 'pairing', answered: false })}
        />
      </StrictMode>,
    );
  });
  await until(() => document.querySelector('input[type="checkbox"]') !== null, 'the consent');
  document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
  await until(
    () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked === true,
    'the box to be ticked',
  );
  press('Turn the camera on');
  await until(
    () =>
      (document.querySelector('[data-oyl-side-pairing]')?.textContent ?? '').includes(
        'Looking for the tablet',
      ),
    'the phone looking for the tablet’s code',
  );
  // The picture takes its upright shape once the video knows its size.
  await until(
    () =>
      (document.querySelector('.oyl-framing__picture')?.getBoundingClientRect().height ?? 0) >
      innerWidth,
    'an upright camera picture',
  );
  window.__oylSideCamera = {
    ready: true,
    errors,
    measure,
    loseLink: () => undefined,
    unstyle: () => undefined,
    pairing: measurePairing,
    oldOrder: () => {
      const pairing = document.querySelector('[data-oyl-side-pairing]');
      const figure = document.querySelector('figure.oyl-framing');
      if (pairing !== null && figure !== null) {
        figure.after(pairing);
      }
    },
  };
}

/** A main thread that is never idle: one 4 ms task after another, until stopped. */
function neverIdle(): () => void {
  let going = true;
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    if (!going) {
      return;
    }
    const started = performance.now();
    while (performance.now() - started < 4) {
      // Busy, on purpose.
    }
    channel.port2.postMessage(0);
  };
  channel.port2.postMessage(0);
  return () => {
    going = false;
    channel.port1.close();
  };
}

async function runPictures(host: Element, encoder: string): Promise<void> {
  globalThis.location.hash = '#/camera/side';
  const products = canvasFrameGrabber();
  const grabber =
    encoder === 'main-thread'
      ? {
          ...products,
          sidePictures: (stream: Parameters<typeof videoSidePictureSampler>[0]) =>
            videoSidePictureSampler(stream, mainThreadJpegEncoder()),
        }
      : products;
  const camera = new CameraController({
    port: browserCameraPort({
      devices: navigator.mediaDevices,
      grabber,
      secureContext: globalThis.isSecureContext,
    }),
    schedule: () => () => undefined,
  });
  const link = scriptedLink();
  await viewGroupsLoaded();
  flushSync(() => {
    createRoot(host).render(
      <StrictMode>
        <AppShell capabilities={NO_BLUETOOTH} camera={camera} sideCameraLink={link} />
      </StrictMode>,
    );
  });
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
    () => document.querySelector('[data-oyl-side-camera-stage]') !== null,
    'the filming sign',
  );
  // The first picture opens the camera's own video; the rate is measured after it.
  await until(() => link.pictures.length > 0, 'a first picture');
  const stop = neverIdle();
  const before = link.pictures.length;
  const started = performance.now();
  let filmingThroughout = true;
  while (performance.now() - started < PICTURE_RATE_MILLISECONDS) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    filmingThroughout &&= document.querySelector('[data-oyl-side-camera-stage]') !== null;
  }
  const milliseconds = performance.now() - started;
  const pictures = link.pictures.length - before;
  stop();
  window.__oylSideCamera = {
    ready: true,
    errors,
    measure,
    loseLink: () => undefined,
    unstyle: () => undefined,
    pictures: {
      encoder,
      pictures,
      milliseconds,
      timings: window.__oylSideCameraTimings?.snapshot(),
      filmingThroughout,
    },
  };
}

async function run(): Promise<void> {
  const host = document.querySelector('#shell');
  if (host === null) {
    throw new Error('side-camera harness: #shell is missing from sidecamera.html');
  }
  if (PAIRING_SCAN) {
    await runPairingScan(host);
    return;
  }
  if (PICTURES !== null) {
    await runPictures(host, PICTURES);
    return;
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
  const link = scriptedLink();

  // #674: the view groups first, so every view renders on the render that asks.
  await viewGroupsLoaded();
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
