// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The instance card's scanner, in a real engine** — #2785.
 *
 * The Connect form (`views/InstanceView.tsx`, not connected, over the scripted
 * instance port) with the REAL camera pipeline under it: `browser-camera.ts`
 * §`browserCameraPort` with its real canvas grabber, `session.ts`
 * §`CameraController`, and the real lazy-loaded QR reader
 * (`side-link-qr.ts`). The one thing that is not real is the camera itself:
 * `getUserMedia` answers with a canvas's own stream, and the canvas shows
 * {@link CARD_QR_FIXTURE} — a QR code committed as a picture, carrying
 * {@link CARD_QR_TEXT}. So the spec watches pixels go from a `<video>` through
 * a canvas draw into jsQR and out as the text in the line box, in Chromium.
 *
 * ⚠️ **No real instance is named.** The card is for
 * `https://instance.example.org`, with the scripted fingerprint
 * (`instance/testing.ts` §`SCRIPTED_FINGERPRINT`), beside a made-up link code.
 * The fixture was drawn from that text with `uqr` at error correction `M`,
 * six pixels a module and a four-module quiet zone — the way
 * `camera/PairingCode.tsx` draws one.
 *
 * `window.__oylCardScan` publishes whether the page is ready, any error, and
 * the state of the stream's tracks, which is how the spec sees the camera stop.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { browserCameraPort, canvasFrameGrabber } from '../src/camera/browser-camera';
import { browserSecureWindow } from '../src/camera/secure-window-testing';
import { CameraController } from '../src/camera/session';
import { scriptedInstance } from '../src/instance/testing';
import { InstanceView } from '../src/views/InstanceView';
import CARD_QR_FIXTURE from './card-qr-fixture.png';
import { CARD_QR_TEXT } from './cardscan-fixture';

import '../src/design/theme.css';
import '../src/design/tailwind.css';

declare global {
  interface Window {
    __oylCardScan?: {
      readonly ready: boolean;
      readonly errors: readonly string[];
      /** What the fixture says. */
      readonly fixture: string;
      /** Each track of every stream the page was given: `live`, or `ended` once stopped. */
      readonly tracks: () => readonly string[];
      /** How many times the page asked for a camera: the permission probe, then the start. */
      readonly asked: () => number;
    };
  }
}

const errors: string[] = [];

/** `?blank`: the camera sees a wall with no code on it, so the scan goes on looking. */
const BLANK = new URLSearchParams(location.search).has('blank');

async function loadFixture(): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = CARD_QR_FIXTURE;
  await image.decode();
  return image;
}

async function run(): Promise<void> {
  const image = await loadFixture();
  // The "camera": a canvas a little larger than the code, redrawn every frame
  // so its stream always has a fresh one to give the `<video>`.
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('no 2D canvas');
  let drawing = true;
  const draw = (): void => {
    context.fillStyle = '#d8d8d8';
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!BLANK) {
      context.drawImage(
        image,
        (canvas.width - image.width) / 2,
        (canvas.height - image.height) / 2,
      );
    }
    if (drawing) requestAnimationFrame(draw);
  };
  draw();
  // A fresh stream for each ask, as a camera gives: the port's permission
  // probe stops the tracks of the first one at once (`browser-camera.ts`
  // §`requestCameraAccess`).
  const streams: MediaStream[] = [];
  const port = browserCameraPort({
    devices: {
      getUserMedia: () => {
        const stream = canvas.captureStream(15);
        streams.push(stream);
        return Promise.resolve(stream);
      },
    },
    grabber: canvasFrameGrabber(),
    secureContext: true,
  });
  const camera = new CameraController({ port, secureWindow: browserSecureWindow() });
  camera.agree({ acknowledgedBystanders: true, allowLocal: true });

  const host = document.getElementById('cardscan-main');
  if (host === null) throw new Error('no #cardscan-main');
  createRoot(host).render(
    <StrictMode>
      <InstanceView port={scriptedInstance().port} camera={camera} />
    </StrictMode>,
  );
  window.addEventListener('pagehide', () => {
    drawing = false;
  });
  window.__oylCardScan = {
    ready: true,
    errors,
    fixture: CARD_QR_TEXT,
    tracks: () => streams.flatMap((stream) => stream.getTracks().map((track) => track.readyState)),
    asked: () => streams.length,
  };
}

run().catch((error: unknown) => {
  errors.push(error instanceof Error ? error.message : String(error));
  window.__oylCardScan = {
    ready: false,
    errors,
    fixture: CARD_QR_TEXT,
    tracks: () => [],
    asked: () => 0,
  };
});
