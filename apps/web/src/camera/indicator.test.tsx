// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The indicator, both directions — and the stylesheet rule it depends on.
 *
 * ⚠️ **"Absent when the camera is off" is the half that makes the other half
 * mean something.** #382: *"a test asserts it is present whenever a session is
 * live and absent whenever it is not — **both directions**, because an
 * indicator that is always on is indistinguishable from one that works."*
 *
 * ⚠️ **What this file cannot do is measure anything**, because jsdom performs
 * no layout and resolves no custom property (CLAUDE.md §4e). The `position`,
 * the stacking and the hit test are `browser/shell.browser.spec.ts`'s, and the
 * one property of the stylesheet that can be checked without a browser — that
 * no other rule declares a higher `z-index` — is `indicator-style.test.ts`'s.
 * ⚠️ That is a **separate file on purpose**: reading a file off disk needs
 * `import.meta.url` to be a `file:` URL, and in the DOM environment this suite
 * needs it is an `http:` one. `indicator-style.test.ts` records the second
 * trap that finding produced, which is that naming Vitest's environment
 * docblock tag in prose sets it.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { mount, settle, type Mounted } from '../testing/mount';

import { CameraIndicator } from './indicator';
import { CameraController } from './session';
import { manualSchedule, scriptedCamera } from './testing';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const AGREED = { acknowledgedBystanders: true, allowLocal: true, allowHosted: false } as const;

function indicator(): Element | null {
  return document.querySelector('[data-oyl-camera-indicator]');
}

describe('the indicator follows the camera', () => {
  it('is absent when there is no camera port at all', async () => {
    mounted = await mount(<CameraIndicator />);
    expect(indicator()).toBeNull();
  });

  it('is absent when a camera exists and is not running', async () => {
    const camera = scriptedCamera();
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
    });
    controller.agree(AGREED);
    mounted = await mount(<CameraIndicator controller={controller} />);
    expect(indicator()).toBeNull();
  });

  it('appears when the camera starts and goes when it stops', async () => {
    const camera = scriptedCamera();
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
    });
    controller.agree(AGREED);
    mounted = await mount(<CameraIndicator controller={controller} />);
    expect(indicator()).toBeNull();

    await controller.turnOn();
    await settle();
    expect(indicator()).not.toBeNull();

    controller.turnOff();
    await settle();
    expect(indicator()).toBeNull();
  });

  it('goes out when the camera is taken away from outside this app', async () => {
    const camera = scriptedCamera();
    const timers = manualSchedule();
    const controller = new CameraController({ port: camera.port, schedule: timers.schedule });
    controller.agree(AGREED);
    mounted = await mount(<CameraIndicator controller={controller} />);
    await controller.turnOn();
    await settle();
    expect(indicator()).not.toBeNull();

    camera.endTheTrack();
    timers.fire();
    await settle();

    expect(indicator()).toBeNull();
  });
});
