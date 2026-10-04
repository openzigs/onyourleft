// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **The Camera screen's side-camera section with the live picture on it,
 * audited** — #1061's *"`pnpm run test:a11y` covers the screen in its new
 * state"*. The route walk (`routes.a11y.test.tsx`) renders the Camera screen
 * with no paired phone, so the picture, its text alternative and its caption
 * are reached only here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { CameraController } from '../camera/session';
import { SIDE_LIVE_PICTURE_LABEL } from '../camera/SideLiveView';
import {
  manualSchedule,
  scriptedCamera,
  scriptedLiveView,
  scriptedSidePairing,
} from '../camera/testing';
import { mount, settle, type Mounted } from '../testing/mount';

import { SideCameraControl } from './SideCameraControl';
import { browserSecureWindow } from '../camera/secure-window-testing';

let mounted: Mounted | undefined;

beforeEach(() => {
  // jsdom draws nothing; the picture's canvas is a box to audit, not pixels.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.restoreAllMocks();
});

const PIXELS = { width: 640, height: 360, close: () => undefined } as unknown as ImageBitmap;

async function screen(withPose: boolean): Promise<void> {
  const live = scriptedLiveView({
    picture: {
      sequence: 4,
      pixels: PIXELS,
      pose: withPose
        ? {
            aspect: 16 / 9,
            nearSide: 'left',
            landmarks: [
              { name: 'shoulder', x: 0.45, y: 0.3, visibility: 0.9 },
              { name: 'hip', x: 0.4, y: 0.5, visibility: 0.9 },
            ],
          }
        : undefined,
    },
    reference: undefined,
  });
  const pairing = scriptedSidePairing({ phone: 'filming' }, live);
  const controller = new CameraController({
    secureWindow: browserSecureWindow(),
    port: scriptedCamera().port,
    schedule: manualSchedule().schedule,
  });
  // Inside the page it is part of: one main, an h1, and the h2 the Camera
  // screen puts the section under (its own heading is an h3).
  mounted = await mount(
    <main>
      <h1>Camera</h1>
      <h2>Filming a ride: the side camera</h2>
      <SideCameraControl controller={controller} pairing={pairing} />
    </main>,
  );
  await settle();
}

describe('the side camera’s live view, audited — #1061', () => {
  it.each([
    ['with an outline', true],
    ['with nobody found', false],
  ])('passes the audit %s, and names the picture by what it is', async (_, withPose) => {
    await screen(withPose);
    const picture = document.querySelector('[role="img"]');
    expect(picture?.getAttribute('aria-label')).toBe(SIDE_LIVE_PICTURE_LABEL);
    expect(document.querySelector('figcaption')?.textContent).toContain(
      'The solid outline is where to stand the bike.',
    );
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});
