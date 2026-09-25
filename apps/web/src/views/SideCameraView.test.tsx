// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The tripod phone's screen — #528. The consent that comes before the camera,
 * the framing screen, the filming sign with its one control, the countdown,
 * and *"stopped, link lost"* — rendered, and driven through the same
 * `SideCameraSession` production uses.
 *
 * What jsdom cannot say — that the sign is the dominant thing on a phone's
 * screen and that the stop control is 44 × 44 and uncovered — is
 * `browser/sidecamera.browser.spec.ts`.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { BYSTANDER_SENTENCE } from '../camera/consent';
import { FRAMING_VERDICT_TEXT } from '../camera/framing';
import { CameraController } from '../camera/session';
import { LINK_LOSS_LIMIT_MILLISECONDS, LINK_LOSS_SENTENCE } from '../camera/side-camera';
import { manualSchedule, scriptedCamera, scriptedLink, virtualTime } from '../camera/testing';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';

import { FILMING_WORD, NOT_PAIRED_TEXT, SideCameraView } from './SideCameraView';
import { CAMERA_NO_PORT } from './CameraView';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function button(text: string): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(document, 'button').find((each) =>
    (each.textContent ?? '').includes(text),
  );
}

async function press(text: string): Promise<void> {
  const found = button(text);
  if (found === undefined) {
    expect.unreachable(`no button "${text}"`);
    return;
  }
  await activateWithKeyboard(found);
  await settle();
}

async function tick(): Promise<void> {
  const box = queryAll<HTMLInputElement>(document, 'input[type="checkbox"]')[0];
  if (box === undefined) {
    expect.unreachable('no acknowledgement box');
    return;
  }
  box.click();
  await settle();
}

/** A phone on the screen, with a link and virtual time. */
async function phone(options: { readonly paired?: boolean } = {}): Promise<{
  readonly camera: ReturnType<typeof scriptedCamera>;
  readonly link: ReturnType<typeof scriptedLink>;
  readonly time: ReturnType<typeof virtualTime>;
  readonly immersive: boolean[];
}> {
  const camera = scriptedCamera();
  const controller = new CameraController({
    port: camera.port,
    schedule: manualSchedule().schedule,
  });
  const link = scriptedLink();
  const time = virtualTime();
  const immersive: boolean[] = [];
  mounted = await mount(
    <SideCameraView
      controller={controller}
      {...(options.paired === false ? {} : { link })}
      timers={time}
      onImmersive={(value) => {
        immersive.push(value);
      }}
    />,
  );
  await settle();
  return { camera, link, time, immersive };
}

/** Consent given, the camera on, and the tablet's start received. */
async function filming(): Promise<Awaited<ReturnType<typeof phone>>> {
  const screen = await phone();
  await tick();
  await press('Turn the camera on');
  screen.link.emit({ kind: 'start' });
  await settle();
  return screen;
}

describe('before the camera is ever on', () => {
  it('explains rather than offering a control, with no camera port', async () => {
    mounted = await mount(<SideCameraView />);
    expect(document.body.textContent).toContain(CAMERA_NO_PORT);
    expect(queryAll(document, 'button')).toHaveLength(0);
  });

  it('shows the bystander sentence AND the 30-second sentence on this device first', async () => {
    const { camera } = await phone();
    expect(document.body.textContent).toContain(BYSTANDER_SENTENCE);
    expect(document.body.textContent).toContain(LINK_LOSS_SENTENCE);
    // And nothing has been asked of the camera: shown BEFORE, not beside.
    expect(camera.calls).toStrictEqual([]);
  });

  it('refuses to turn the camera on until both are acknowledged', async () => {
    const { camera } = await phone();
    await press('Turn the camera on');
    expect(document.body.textContent).toContain('Tick the box');
    expect(camera.calls).toStrictEqual([]);
  });

  it('turns it on once they are', async () => {
    const { camera } = await phone();
    await tick();
    await press('Turn the camera on');
    expect(camera.calls).toContain('start');
  });
});

describe('framing', () => {
  it('shows the live picture with the guide over it', async () => {
    const { camera } = await phone();
    await tick();
    await press('Turn the camera on');
    expect(document.querySelector('video')).not.toBeNull();
    expect(document.querySelectorAll('.oyl-framing__guide circle').length).toBeGreaterThan(0);
    expect(camera.calls).toContain('preview');
  });

  it('draws last time’s outline and says what the tablet’s check found', async () => {
    const { link } = await phone();
    await tick();
    await press('Turn the camera on');
    link.emit({
      kind: 'reference',
      reference: {
        aspect: 16 / 9,
        landmarks: [
          { name: 'shoulder', x: 0.5, y: 0.3 },
          { name: 'hip', x: 0.42, y: 0.45 },
          { name: 'knee', x: 0.5, y: 0.62 },
        ],
      },
    });
    link.emit({ kind: 'verdict', verdict: 'differs' });
    await settle();
    expect(document.querySelectorAll('.oyl-framing__ghost line').length).toBe(2);
    expect(document.body.textContent).toContain(FRAMING_VERDICT_TEXT.differs);
  });

  it('says an unpaired phone cannot film, rather than offering a start', async () => {
    await phone({ paired: false });
    await tick();
    await press('Turn the camera on');
    expect(document.body.textContent).toContain(NOT_PAIRED_TEXT);
    expect(button('Start')).toBeUndefined();
  });

  it('turns the camera off from here too', async () => {
    const { camera } = await phone();
    await tick();
    await press('Turn the camera on');
    await press('Turn the camera off');
    expect(camera.calls).toContain('stop');
    expect(camera.calls).toContain('preview-detached');
  });
});

describe('filming', () => {
  it('is the sign and ONE control, and nothing else', async () => {
    const { immersive } = await filming();
    expect(document.querySelector('[data-oyl-side-camera-stage]')).not.toBeNull();
    expect(document.body.textContent).toContain(FILMING_WORD);
    const controls = queryAll(document, 'button, a[href], input, select, textarea');
    expect(controls.map((each) => each.textContent)).toStrictEqual(['Stop filming']);
    // No preview while filming: the picture is not on the sign.
    expect(document.querySelector('video')).toBeNull();
    // And the shell was told, so its chrome goes too.
    expect(immersive).toStrictEqual([true]);
  });

  it('counts down when the link is lost, and says "stopped, link lost" at 30 s', async () => {
    const { link, time, camera, immersive } = await filming();
    link.emit({ kind: 'condition', condition: 'lost' });
    await settle();
    expect(document.querySelector('[role="timer"]')?.textContent).toContain('30 seconds');

    time.advance(10_000);
    await settle();
    expect(document.querySelector('[role="timer"]')?.textContent).toContain('20 seconds');

    time.advance(LINK_LOSS_LIMIT_MILLISECONDS - 10_000);
    await settle();
    expect(camera.calls.filter((call) => call === 'stop')).toHaveLength(1);
    expect(document.body.textContent).toContain('Stopped, link lost.');
    // The sign has gone and the shell has its chrome back.
    expect(document.querySelector('[data-oyl-side-camera-stage]')).toBeNull();
    expect(immersive).toStrictEqual([true, false]);
  });

  it('stops on the one control', async () => {
    const { camera, link } = await filming();
    await press('Stop filming');
    expect(camera.calls.filter((call) => call === 'stop')).toHaveLength(1);
    expect(link.reports.at(-1)).toStrictEqual({ state: 'stopped', reason: 'rider' });
  });

  it('starts a fresh session on "Set up again", with the consent shown again', async () => {
    await filming();
    await press('Stop filming');
    await press('Set up again');
    expect(document.body.textContent).toContain(LINK_LOSS_SENTENCE);
    expect(button('Turn the camera on')).toBeDefined();
  });

  it('stops the camera when the rider leaves the screen mid-session', async () => {
    const { camera } = await filming();
    mounted?.unmount();
    mounted = undefined;
    expect(camera.calls.filter((call) => call === 'stop')).toHaveLength(1);
  });
});
