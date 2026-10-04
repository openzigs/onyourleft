// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The tablet's live view of the side camera, laid out and drawn by a real
 * engine** — #1061, ADR 0044 D-1. Reached as `sidecamera.html?live=tablet`
 * (`sidecamera-harness.tsx` hands this page over), so it is no new entry and
 * no new build.
 *
 * jsdom draws nothing and lays nothing out, so nothing in the Vitest suite can
 * say whether the outline lands ON the picture: the canvas scales the picture
 * with `object-fit: contain` and the outline is an SVG over it with its own
 * `viewBox`, and a mismatch between the two — a `preserveAspectRatio` of
 * `none`, a box the picture does not fill — draws every joint beside the
 * point it is of while every unit test stays green.
 *
 * The picture is drawn from ARITHMETIC: a dark field with one small square of
 * a colour of its own at each landmark. **Never a photograph of a real
 * person** (#1061). The real `SideLiveView` component draws it, under the real
 * `theme.css`, twice: once with the landmarks where the squares are, and once
 * — the control — with every landmark moved a twentieth of the picture's width
 * to the right, which the spec requires to FAIL the same measurement.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { CameraController } from '../src/camera/session';
import { SideLiveView } from '../src/camera/SideLiveView';
import type { SidePose, SidePoseLandmark } from '../src/camera/side-analysis-port';
import { scriptedLiveView } from '../src/camera/testing';

/** The picture's size: a landscape phone's camera, small, as ADR 0033 D-3's pictures are. */
const WIDTH = 640;
const HEIGHT = 360;

/** Where each landmark is, as shares of the picture, and the colour of its square. */
const LANDMARKS: readonly {
  readonly name: SidePoseLandmark;
  readonly x: number;
  readonly y: number;
  readonly rgb: readonly [number, number, number];
}[] = [
  { name: 'ear', x: 0.52, y: 0.18, rgb: [255, 0, 0] },
  { name: 'shoulder', x: 0.46, y: 0.3, rgb: [0, 255, 0] },
  { name: 'elbow', x: 0.56, y: 0.42, rgb: [0, 0, 255] },
  { name: 'hip', x: 0.38, y: 0.52, rgb: [255, 255, 0] },
  { name: 'knee', x: 0.5, y: 0.68, rgb: [0, 255, 255] },
  { name: 'ankle', x: 0.44, y: 0.86, rgb: [255, 0, 255] },
];

/** The half-width of each square, in picture pixels. */
const SQUARE = 4;

/** How far the control moves every landmark, as a share of the picture's width. */
export const CONTROL_OFFSET = 0.05;

export interface LiveCaseMeasurement {
  readonly name: 'true' | 'offset';
  /** Each joint's centre on the screen. */
  readonly joints: readonly { readonly name: string; readonly x: number; readonly y: number }[];
  /** Each square's centre on the screen, found by reading the canvas's own pixels. */
  readonly squares: readonly { readonly name: string; readonly x: number; readonly y: number }[];
  /** The outline's stroke colour, as the engine resolved it. */
  readonly outlineStroke: string;
  /** The page's palette when measured. */
  readonly theme: string;
}

declare global {
  interface Window {
    __oylSideLive?: {
      readonly ready: boolean;
      readonly errors: readonly string[];
      readonly measure: () => readonly LiveCaseMeasurement[];
    };
  }
}

const errors: string[] = [];

async function picture(): Promise<ImageBitmap> {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('no 2D context to draw the synthetic picture');
  }
  context.fillStyle = '#202428';
  context.fillRect(0, 0, WIDTH, HEIGHT);
  for (const { x, y, rgb } of LANDMARKS) {
    context.fillStyle = `rgb(${String(rgb[0])}, ${String(rgb[1])}, ${String(rgb[2])})`;
    context.fillRect(x * WIDTH - SQUARE, y * HEIGHT - SQUARE, SQUARE * 2, SQUARE * 2);
  }
  return createImageBitmap(canvas);
}

function poseAt(offset: number): SidePose {
  return {
    aspect: WIDTH / HEIGHT,
    nearSide: 'left',
    landmarks: LANDMARKS.map(({ name, x, y }) => ({ name, x: x + offset, y, visibility: 0.9 })),
  };
}

/** Each square's centre, from the canvas's own pixels, mapped to the screen through `object-fit: contain`. */
function squaresOn(canvas: HTMLCanvasElement): LiveCaseMeasurement['squares'] {
  const context = canvas.getContext('2d');
  if (context === null) {
    return [];
  }
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const box = canvas.getBoundingClientRect();
  const scale = Math.min(box.width / canvas.width, box.height / canvas.height);
  const left = box.left + (box.width - canvas.width * scale) / 2;
  const top = box.top + (box.height - canvas.height * scale) / 2;
  return LANDMARKS.map(({ name, rgb }) => {
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const at = (y * canvas.width + x) * 4;
        if (data[at] === rgb[0] && data[at + 1] === rgb[1] && data[at + 2] === rgb[2]) {
          sumX += x + 0.5;
          sumY += y + 0.5;
          count += 1;
        }
      }
    }
    return count === 0
      ? { name, x: Number.NaN, y: Number.NaN }
      : { name, x: left + (sumX / count) * scale, y: top + (sumY / count) * scale };
  });
}

function measure(): readonly LiveCaseMeasurement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-oyl-live-case]')].map((host) => {
    const canvas = host.querySelector('canvas');
    const joints = [...host.querySelectorAll('[data-oyl-live-joint]')].map((joint) => {
      const box = joint.getBoundingClientRect();
      return {
        name: joint.getAttribute('data-oyl-live-joint') ?? '',
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
      };
    });
    const line = host.querySelector('.oyl-framing__outline line');
    return {
      name: host.getAttribute('data-oyl-live-case') === 'offset' ? 'offset' : 'true',
      joints,
      squares: canvas === null ? [] : squaresOn(canvas),
      outlineStroke: line === null ? '' : getComputedStyle(line).stroke,
      theme: document.documentElement.getAttribute('data-theme') ?? '',
    };
  });
}

export async function runLiveTablet(host: Element): Promise<void> {
  const controller = new CameraController({
    port: {
      cameraAvailability: () => Promise.resolve({ kind: 'available' as const }),
      requestCameraAccess: () => Promise.resolve({ kind: 'granted' as const }),
      startCamera: () => Promise.reject(new Error('this harness opens no camera')),
    },
    schedule: () => () => undefined,
  });
  const views = await Promise.all(
    [0, CONTROL_OFFSET].map(async (offset) =>
      scriptedLiveView({
        picture: { sequence: 0, pixels: await picture(), pose: poseAt(offset) },
        reference: undefined,
      }),
    ),
  );
  flushSync(() => {
    createRoot(host).render(
      <StrictMode>
        <main>
          <h1>The side camera’s live view</h1>
          {views.map((view, index) => (
            <div key={String(index)} data-oyl-live-case={index === 0 ? 'true' : 'offset'}>
              <SideLiveView view={view} controller={controller} />
            </div>
          ))}
        </main>
      </StrictMode>,
    );
  });
  window.__oylSideLive = { ready: true, errors, measure };
}

export function failLiveTablet(error: unknown): void {
  errors.push(error instanceof Error ? error.message : String(error));
  window.__oylSideLive = { ready: false, errors, measure };
}
