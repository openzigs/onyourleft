// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Camera screen: the consent flow, the refusal screen, and the two things
 * that must never be on it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ANALYSIS_ENDPOINT_STORAGE_KEY, readAnalysisEndpoint } from '../camera/analysis-endpoint';
import type { AnalysisPort } from '../camera/analysis-port';
import { riderAnalysisPort, type AnalysisSend } from '../camera/analysis-transport';
import { BYSTANDER_SENTENCE } from '../camera/consent';
import type { FrameKeep } from '../camera/keep';
import { frameLeaksIn } from '../camera/notice';
import { CameraController } from '../camera/session';
import { manualSchedule, scriptedCamera } from '../camera/testing';
import {
  activateWithKeyboard,
  mount,
  queryAll,
  settle,
  submitForm,
  typeInto,
  type Mounted,
} from '../testing/mount';

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

  it('says the check has stopped, not "cannot tell yet", once the ladder takes it away — #516', async () => {
    const { controller } = await onScreen();
    const on = button('Turn the camera on');
    if (on === undefined) {
      expect.unreachable('no control to turn the camera on');
      return;
    }
    await activateWithKeyboard(on);
    await settle();
    presenceBox()?.click();
    await settle();
    expect(document.body.textContent).toContain('cannot tell yet');

    controller.throttlePresence(false);
    await settle();
    expect(document.body.textContent).not.toContain('cannot tell yet');
    expect(document.body.textContent).toContain('has stopped to spare this device');
    expect(document.body.textContent).toContain('will not pause your ride');
  });
});

describe('your own computer — #387', () => {
  beforeEach(() => {
    localStorage.removeItem(ANALYSIS_ENDPOINT_STORAGE_KEY);
  });

  afterEach(() => {
    localStorage.removeItem(ANALYSIS_ENDPOINT_STORAGE_KEY);
  });

  /** The screen, agreed, with the controller wired the way `main.tsx` wires it. */
  async function wired(send: AnalysisSend): Promise<{
    controller: CameraController;
    camera: ReturnType<typeof scriptedCamera>;
  }> {
    const camera = scriptedCamera();
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
      analysis: () => riderAnalysisPort(readAnalysisEndpoint(), { send }),
    });
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    mounted = await mount(<CameraView controller={controller} />);
    await settle();
    return { controller, camera };
  }

  function field(id: string): HTMLInputElement {
    const input = document.querySelector<HTMLInputElement>(`#${id}`);
    if (input === null) {
      throw new Error(`no #${id} on the screen`);
    }
    return input;
  }

  function switchedOnBox(): HTMLInputElement | undefined {
    return queryAll<HTMLInputElement>(document, 'input[type="checkbox"]').find((box) =>
      (box.closest('label')?.textContent ?? '').includes('Send pictures to this computer'),
    );
  }

  async function saveComputer(address: string, model: string, on: boolean): Promise<void> {
    await typeInto(field('oyl-analysis-address'), address);
    await typeInto(field('oyl-analysis-model'), model);
    const box = switchedOnBox();
    if (box !== undefined && box.checked !== on) {
      box.click();
      await settle();
    }
    const form = field('oyl-analysis-address').form;
    if (form === null) {
      throw new Error('the address box is in no form');
    }
    await submitForm(form);
  }

  async function turnOn(): Promise<void> {
    const on = button('Turn the camera on');
    if (on === undefined) {
      throw new Error('no control to turn the camera on');
    }
    await activateWithKeyboard(on);
    await settle();
  }

  function replying(content: string): { send: AnalysisSend; urls: string[] } {
    const urls: string[] = [];
    return {
      urls,
      send: async (url) => {
        urls.push(url);
        return Promise.resolve(
          new Response(JSON.stringify({ choices: [{ message: { content } }] })),
        );
      },
    };
  }

  it('starts with nothing set up: empty boxes, no placeholder, switched off', async () => {
    await wired(replying('ready').send);
    expect(field('oyl-analysis-address').value).toBe('');
    expect(field('oyl-analysis-model').value).toBe('');
    // ADR 0031 D-4 condition 2: not even as a placeholder.
    expect(field('oyl-analysis-address').getAttribute('placeholder')).toBeNull();
    expect(field('oyl-analysis-model').getAttribute('placeholder')).toBeNull();
    expect(switchedOnBox()?.checked).toBe(false);
    expect(button('check the connection')).toBeUndefined();
  });

  it('refuses a service on the internet, and stores nothing', async () => {
    await wired(replying('ready').send);
    await saveComputer('https://api.example.com', 'somebody-elses', true);
    expect(document.body.textContent).toContain('not on your own network');
    expect(localStorage.getItem(ANALYSIS_ENDPOINT_STORAGE_KEY)).toBeNull();
    // The refusal does not repeat the address back.
    expect(document.body.textContent).not.toContain('api.example.com');
  });

  it('saves a computer on the rider’s network, and offers the check only while the camera is on', async () => {
    await wired(replying('ready').send);
    await saveComputer('http://192.168.1.20:8080', 'vision-4b', true);
    expect(readAnalysisEndpoint()?.address).toBe('http://192.168.1.20:8080');
    expect(button('check the connection')).toBeUndefined();
    await turnOn();
    expect(button('check the connection')).toBeDefined();
  });

  it('sends one picture to the address the rider typed, through the controller main.tsx builds', async () => {
    // ⚠️ The branch `check:wiring` cannot see: an `analysis` option nobody
    // supplies is green there. This drives it from the screen to the send.
    const { send, urls } = replying('ready');
    const { camera } = await wired(send);
    await saveComputer('http://192.168.1.20:8080', 'vision-4b', true);
    await turnOn();
    const check = button('check the connection');
    if (check === undefined) {
      expect.unreachable('no check control');
      return;
    }
    await activateWithKeyboard(check);
    await settle();
    await settle();
    expect(urls).toStrictEqual(['http://192.168.1.20:8080/v1/chat/completions']);
    expect(camera.calls.filter((call) => call === 'capture')).toHaveLength(1);
    expect(document.body.textContent).toContain('understood the request');
  });

  it('sends nothing when saved switched off', async () => {
    const { send, urls } = replying('ready');
    await wired(send);
    await saveComputer('http://192.168.1.20:8080', 'vision-4b', false);
    await turnOn();
    expect(button('check the connection')).toBeUndefined();
    expect(urls).toStrictEqual([]);
    expect(document.body.textContent).toContain('Nothing is sent');
  });

  it('shows nothing a hostile answer said — no markup, no words', async () => {
    const hostile =
      '<img src=x onerror="window.__pwned=1"> Your knee angle is 142 degrees. Raise your saddle.';
    const { send } = replying(hostile);
    await wired(send);
    await saveComputer('http://192.168.1.20:8080', 'vision-4b', true);
    await turnOn();
    const check = button('check the connection');
    if (check === undefined) {
      expect.unreachable('no check control');
      return;
    }
    await activateWithKeyboard(check);
    await settle();
    await settle();
    expect(document.querySelector('img')).toBeNull();
    expect(document.body.textContent).not.toContain('knee');
    expect(document.body.textContent).not.toContain('saddle');
    expect(document.body.textContent).toContain('What it said is not shown');
  });

  it('forgets the computer', async () => {
    await wired(replying('ready').send);
    await saveComputer('http://192.168.1.20:8080', 'vision-4b', true);
    const forget = button('Forget this computer');
    if (forget === undefined) {
      expect.unreachable('no forget control');
      return;
    }
    await activateWithKeyboard(forget);
    await settle();
    expect(readAnalysisEndpoint()).toBeUndefined();
    expect(field('oyl-analysis-address').value).toBe('');
  });

  it('names the failure in words the rider can act on, and carries no picture', async () => {
    const port: AnalysisPort = {
      askAboutFrame: () => ({
        outcome: Promise.resolve({ kind: 'failed', failure: 'unreachable' }),
        cancel: () => undefined,
      }),
    };
    const camera = scriptedCamera();
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
      analysis: () => port,
    });
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    await saveStoredOn();
    mounted = await mount(<CameraView controller={controller} />);
    await settle();
    await turnOn();
    const check = button('check the connection');
    if (check === undefined) {
      expect.unreachable('no check control');
      return;
    }
    await activateWithKeyboard(check);
    await settle();
    expect(document.body.textContent).toContain('could not be reached');
    expect(frameLeaksIn(document.body.textContent ?? '')).toStrictEqual([]);
  });

  async function saveStoredOn(): Promise<void> {
    localStorage.setItem(
      ANALYSIS_ENDPOINT_STORAGE_KEY,
      JSON.stringify({ address: 'http://192.168.1.20:8080', model: 'm', switchedOn: true }),
    );
    return Promise.resolve();
  }
});
