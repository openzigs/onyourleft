// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Camera screen: the consent flow, the refusal screen, and the two things
 * that must never be on it.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { BYSTANDER_SENTENCE } from '../camera/consent';
import { frameLeaksIn } from '../camera/notice';
import { CameraController } from '../camera/session';
import { manualSchedule, scriptedCamera } from '../camera/testing';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';

import { CameraView, CAMERA_NO_PORT } from './CameraView';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function controllerFor(camera: ReturnType<typeof scriptedCamera>): CameraController {
  return new CameraController({ port: camera.port, schedule: manualSchedule().schedule });
}

/** The button whose visible label contains `text`. */
function button(text: string): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(document, 'button').find((each) =>
    (each.textContent ?? '').includes(text),
  );
}

describe('with no camera port', () => {
  it('explains rather than offering a control that cannot work', async () => {
    mounted = await mount(<CameraView />);
    expect(document.body.textContent).toContain(CAMERA_NO_PORT);
    // `views/DevicesView.tsx`'s rule: a disabled button is removed from the tab
    // order, so a keyboard user never reaches it and never hears why.
    expect(queryAll(document, 'button')).toHaveLength(0);
  });
});

describe('the consent flow', () => {
  it('shows the bystander sentence before anything can be turned on', async () => {
    const camera = scriptedCamera();
    mounted = await mount(<CameraView controller={controllerFor(camera)} />);
    expect(document.body.textContent).toContain(BYSTANDER_SENTENCE);
    // No control for the camera itself yet, and — the assertion that matters —
    // the port has not been touched.
    expect(button('Turn the camera on')).toBeUndefined();
    expect(camera.calls).toStrictEqual([]);
  });

  it('refuses until the rider has acknowledged it', async () => {
    const camera = scriptedCamera();
    mounted = await mount(<CameraView controller={controllerFor(camera)} />);
    const allow = button('Allow the camera');
    expect(allow).toBeDefined();
    if (allow === undefined) {
      return;
    }
    await activateWithKeyboard(allow);
    await settle();

    expect(document.body.textContent).toContain('Tick the box');
    expect(camera.calls).toStrictEqual([]);
  });

  it('offers the camera once the box is ticked and the rider agrees', async () => {
    const camera = scriptedCamera();
    mounted = await mount(<CameraView controller={controllerFor(camera)} />);
    const box = queryAll<HTMLInputElement>(document, 'input[type="checkbox"]')[0];
    expect(box).toBeDefined();
    if (box === undefined) {
      return;
    }
    box.click();
    await settle();
    const allow = button('Allow the camera');
    if (allow === undefined) {
      expect.unreachable('no consent control');
      return;
    }
    await activateWithKeyboard(allow);
    await settle();

    expect(button('Turn the camera on')).toBeDefined();
    // Agreeing is not switching on: the port is still untouched.
    expect(camera.calls).toStrictEqual([]);
  });
});

describe('the camera itself', () => {
  async function agreedScreen(camera: ReturnType<typeof scriptedCamera>): Promise<void> {
    const controller = controllerFor(camera);
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    mounted = await mount(<CameraView controller={controller} />);
    await settle();
  }

  it('turns on, takes a picture, and says the picture was thrown away', async () => {
    const camera = scriptedCamera();
    await agreedScreen(camera);
    const on = button('Turn the camera on');
    if (on === undefined) {
      expect.unreachable('no control to turn the camera on');
      return;
    }
    await activateWithKeyboard(on);
    await settle();
    expect(document.body.textContent).toContain('The camera is on.');

    const take = button('Take a picture');
    if (take === undefined) {
      expect.unreachable('no control to take a picture');
      return;
    }
    await activateWithKeyboard(take);
    await settle();

    expect(document.body.textContent).toContain('thrown away');
    expect(document.body.textContent).toContain('None of them was kept.');
  });

  it('shows no picture, no preview and no locator for one', async () => {
    const camera = scriptedCamera();
    await agreedScreen(camera);
    const on = button('Turn the camera on');
    if (on === undefined) {
      return;
    }
    await activateWithKeyboard(on);
    await settle();
    const take = button('Take a picture');
    if (take === undefined) {
      return;
    }
    await activateWithKeyboard(take);
    await settle();

    // ADR 0029 D-8 and D-11 together: not the frame, not a thumbnail, not a
    // `blob:` URL, and not an `<img>` or a `<video>` anywhere on the screen.
    expect(queryAll(document, 'img')).toHaveLength(0);
    expect(queryAll(document, 'video')).toHaveLength(0);
    expect(queryAll(document, 'canvas')).toHaveLength(0);
    expect(frameLeaksIn(document.body.innerHTML)).toStrictEqual([]);
  });

  it('takes the consent back and stops the camera', async () => {
    const camera = scriptedCamera();
    await agreedScreen(camera);
    const on = button('Turn the camera on');
    if (on === undefined) {
      return;
    }
    await activateWithKeyboard(on);
    await settle();

    const stop = button('Stop using the camera');
    if (stop === undefined) {
      expect.unreachable('no control to revoke');
      return;
    }
    await activateWithKeyboard(stop);
    await settle();

    expect(camera.calls).toContain('stop');
    expect(document.body.textContent).toContain(BYSTANDER_SENTENCE);
    expect(button('Turn the camera on')).toBeUndefined();
  });
});

describe('the refusal screen', () => {
  it('explains a denied permission and names what to do outside the app', async () => {
    const camera = scriptedCamera({ permission: 'not-permitted' });
    const controller = controllerFor(camera);
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    mounted = await mount(<CameraView controller={controller} />);
    const on = button('Turn the camera on');
    if (on === undefined) {
      expect.unreachable('no control to turn the camera on');
      return;
    }
    await activateWithKeyboard(on);
    await settle();

    const text = document.body.textContent ?? '';
    expect(text).toContain('The camera was not allowed');
    expect(text).toContain('settings');
    // #382: the explanation names no error code as its only content.
    expect(text).not.toMatch(/NotAllowedError|DOMException/);
  });

  it('carries no frame, crop, thumbnail or path to one', async () => {
    const camera = scriptedCamera({ startFails: 'unavailable' });
    const controller = controllerFor(camera);
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    mounted = await mount(<CameraView controller={controller} />);
    const on = button('Turn the camera on');
    if (on === undefined) {
      return;
    }
    await activateWithKeyboard(on);
    await settle();
    expect(frameLeaksIn(document.body.innerHTML)).toStrictEqual([]);
  });
});
