// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Camera screen: the consent flow, the refusal screen, and the two things
 * that must never be on it.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { BYSTANDER_SENTENCE } from '../camera/consent';
import type { FrameKeep } from '../camera/keep';
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

/* -------------------------------------------------------------------------- *
 * #384: the per-ride keep, and the count that replaces a picture.
 * -------------------------------------------------------------------------- */

describe('keeping this ride’s pictures', () => {
  async function screenWithKeep(
    keep: Parameters<typeof controllerWith>[1],
  ): Promise<CameraController> {
    const camera = scriptedCamera();
    const controller = controllerWith(camera, keep);
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    mounted = await mount(<CameraView controller={controller} />);
    await settle();
    const on = button('Turn the camera on');
    if (on !== undefined) {
      await activateWithKeyboard(on);
      await settle();
    }
    return controller;
  }

  /** Presses "Take a picture" `times` times and lets the screen settle. */
  async function takePictures(times: number): Promise<void> {
    for (let index = 0; index < times; index += 1) {
      const take = button('Take a picture');
      if (take === undefined) {
        expect.unreachable('no control to take a picture');
        return;
      }
      await activateWithKeyboard(take);
      await settle();
    }
  }

  it('offers the switch OFF, and says nothing has been taken yet', async () => {
    await screenWithKeep(stubKeep());
    const box = queryAll<HTMLInputElement>(document, 'input[type="checkbox"]')[0];
    expect(box?.checked).toBe(false);
    expect(document.body.textContent).toContain(
      'No pictures have been taken since the camera was turned on.',
    );
  });

  it('turns the keep on, and says a picture is on this device once one is', async () => {
    const keep = stubKeep();
    await screenWithKeep(keep);
    const box = queryAll<HTMLInputElement>(document, 'input[type="checkbox"]')[0];
    expect(box).toBeDefined();
    if (box === undefined) {
      return;
    }
    box.click();
    await settle();
    expect(keep.keeping).toBe(true);

    await takePictures(1);

    expect(document.body.textContent).toContain('It is on this device.');
    // ⚠️ And the section below FOLLOWS, which it did not: `refreshKept` used to
    // run on mount and after a delete only, so a rider who had just kept a
    // picture went on reading "holding no pictures" until they navigated away.
    expect(document.body.textContent).toContain('This device is holding 1 picture.');
  });

  it('does not claim nothing was kept after the switch is turned back off', async () => {
    // ⚠️ **The regression this whole pair of fields exists for.** `keeping` is
    // present tense and the sentence is about every picture since switch-on, so
    // reading one off the other told a rider who had kept three pictures and
    // then turned the switch off that NONE of them was kept — on the one screen
    // whose job is to say what this device is holding, about the most sensitive
    // thing this program stores. A mid-session toggle is explicitly supported:
    // `camera/keep.ts` §`keepThisRide` argues for it.
    const keep = stubKeep();
    await screenWithKeep(keep);
    const box = queryAll<HTMLInputElement>(document, 'input[type="checkbox"]')[0];
    if (box === undefined) {
      expect.unreachable('no keep switch');
      return;
    }

    box.click();
    await settle();
    await takePictures(3);
    box.click();
    await settle();

    expect(keep.keeping).toBe(false);
    expect(document.body.textContent).not.toContain('None of them was kept.');
    expect(document.body.textContent).toContain('Pictures taken since the camera was turned on: 3');
    expect(document.body.textContent).toContain('All of them are on this device.');
    expect(document.body.textContent).toContain('This device is holding 3 pictures.');
  });

  it('counts only the pictures the switch was on for', async () => {
    // The mixed session: the sentence is arithmetic over what the SINK did,
    // not over the switch's position at either end.
    const keep = stubKeep();
    await screenWithKeep(keep);
    const box = queryAll<HTMLInputElement>(document, 'input[type="checkbox"]')[0];
    if (box === undefined) {
      expect.unreachable('no keep switch');
      return;
    }

    await takePictures(1);
    box.click();
    await settle();
    await takePictures(2);

    expect(document.body.textContent).toContain('Pictures taken since the camera was turned on: 3');
    expect(document.body.textContent).toContain(
      '2 of them are on this device; the rest were thrown away.',
    );
    expect(document.body.textContent).toContain('This device is holding 2 pictures.');
  });

  it('shows a COUNT and never a picture', async () => {
    // ADR 0029 D-11: a kept frame is reached from the report the rider opens
    // deliberately and from nowhere else. A count is D-8's permitted column.
    await screenWithKeep(stubKeep(3));
    await settle();
    expect(document.body.textContent).toContain('holding 3 pictures');
    expect(queryAll(document, 'img')).toHaveLength(0);
    expect(frameLeaksIn(document.body.innerHTML)).toStrictEqual([]);
  });

  it('offers no delete control when this device is holding nothing', async () => {
    await screenWithKeep(stubKeep(0));
    await settle();
    expect(document.body.textContent).toContain('holding no pictures');
    expect(button('Delete every picture')).toBeUndefined();
  });

  it('deletes them all, and the count follows', async () => {
    const keep = stubKeep(2);
    await screenWithKeep(keep);
    await settle();

    const remove = button('Delete every picture');
    expect(remove).toBeDefined();
    if (remove === undefined) {
      return;
    }
    await activateWithKeyboard(remove);
    await settle();

    expect(keep.forgotten).toBe(1);
    expect(document.body.textContent).toContain('holding no pictures');
  });
});

/** A `FrameKeep` that records what it was asked, with no store behind it. */
function stubKeep(held = 0): FrameKeep & { forgotten: number } {
  let keeping = false;
  let count = held;
  let forgotten = 0;
  return {
    get keeping(): boolean {
      return keeping;
    },
    get forgotten(): number {
      return forgotten;
    },
    setKeeping(on: boolean): void {
      keeping = on;
    },
    // The real `keepThisRide`'s shape: write and report kept only while the
    // switch is on, and make the device count follow, so a test that presses
    // "Take a picture" sees what a rider would rather than a stub that always
    // says the same thing.
    accept: async () => {
      if (!keeping) {
        return Promise.resolve(false);
      }
      count += 1;
      return Promise.resolve(true);
    },
    count: async () => Promise.resolve(count),
    forget: async () => {
      forgotten += 1;
      const removed = count;
      count = 0;
      return Promise.resolve(removed);
    },
  };
}

function controllerWith(
  camera: ReturnType<typeof scriptedCamera>,
  keep: FrameKeep,
): CameraController {
  return new CameraController({ port: camera.port, schedule: manualSchedule().schedule, keep });
}

/* --------------------------------------------------------------------------
 * #390: "pause my ride when nobody is on the bike".
 * -------------------------------------------------------------------------- */

describe('the presence switch', () => {
  /** The presence box, found by its label rather than by position. */
  function presenceBox(): HTMLInputElement | undefined {
    return (
      queryAll<HTMLLabelElement>(document, 'label')
        .find((label) => (label.textContent ?? '').includes('nobody is on the bike'))
        ?.querySelector('input') ?? undefined
    );
  }

  async function onScreen(): Promise<{
    controller: CameraController;
    camera: ReturnType<typeof scriptedCamera>;
  }> {
    const camera = scriptedCamera();
    const controller = controllerFor(camera);
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    mounted = await mount(<CameraView controller={controller} />);
    await settle();
    return { controller, camera };
  }

  it('is not offered while the camera is off — not disabled, absent', async () => {
    await onScreen();
    expect(presenceBox()).toBeUndefined();
  });

  it('is OFF when the camera comes on, and switching it on asks for nothing new', async () => {
    const { controller, camera } = await onScreen();
    const on = button('Turn the camera on');
    if (on === undefined) {
      expect.unreachable('no control to turn the camera on');
      return;
    }
    await activateWithKeyboard(on);
    await settle();
    const box = presenceBox();
    expect(box?.checked).toBe(false);
    const before = [...camera.calls];

    box?.click();
    await settle();

    expect(controller.state().watchingPresence).toBe(true);
    expect(presenceBox()?.checked).toBe(true);
    // No second request and no second start — the one camera, the one consent.
    expect(camera.calls).toStrictEqual(before);
    expect(controller.state().consent).toStrictEqual({ local: true, hosted: false });
    // And it says what `unknown` does NOT do.
    expect(document.body.textContent).toContain('it will not pause your ride');
  });
});
