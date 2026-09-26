// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The side camera's session — #528, ADR 0033 D-3, D-5, D-7 and D-8.
 *
 * Driven through a REAL `CameraController` over the scripted camera, so the
 * assertion that matters — *"the camera track is stopped at 30 s and not
 * later"* — is made on the camera's own `stopCamera` call, not on a phase
 * this file set.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CameraController } from './session';
import {
  COUNTDOWN_REFRESH_MILLISECONDS,
  LINK_LOSS_LIMIT_MILLISECONDS,
  LINK_LOSS_SENTENCE,
  PICTURE_INTERVAL_MILLISECONDS,
  SideCameraSession,
  STOPPED_TEXT,
} from './side-camera';
import type { SideLinkCondition } from './side-camera-link-port';
import { manualSchedule, scriptedCamera, scriptedLink, virtualTime } from './testing';

/** A session over a real controller, with consent already given. */
async function filming(options: { readonly condition?: SideLinkCondition } = {}): Promise<{
  readonly session: SideCameraSession;
  readonly camera: ReturnType<typeof scriptedCamera>;
  readonly link: ReturnType<typeof scriptedLink>;
  readonly time: ReturnType<typeof virtualTime>;
  readonly controller: CameraController;
}> {
  const camera = scriptedCamera();
  const controller = new CameraController({
    port: camera.port,
    schedule: manualSchedule().schedule,
  });
  controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
  const link = scriptedLink(options.condition);
  const time = virtualTime();
  const session = new SideCameraSession({ camera: controller, link, ...time });
  await session.turnOnForFraming();
  link.emit({ kind: 'start' });
  return { session, camera, link, time, controller };
}

/** How many times the camera's track was stopped. */
function stops(camera: ReturnType<typeof scriptedCamera>): number {
  return camera.calls.filter((call) => call === 'stop').length;
}

describe('the 30 seconds after the link is lost', () => {
  it('stops the camera track at 30 s and not later', async () => {
    const { session, camera, link, time } = await filming();
    expect(session.state().phase).toBe('filming');

    link.emit({ kind: 'condition', condition: 'lost' });
    time.advance(LINK_LOSS_LIMIT_MILLISECONDS - 1);
    // One millisecond short: still filming, and the camera still running.
    expect(stops(camera)).toBe(0);
    expect(camera.session()?.live).toBe(true);
    expect(session.state().phase).toBe('filming');

    time.advance(1);
    // At exactly 30 s: the TRACK is stopped — the camera's own call, not a flag.
    expect(stops(camera)).toBe(1);
    expect(camera.session()?.live).toBe(false);
    expect(session.state().phase).toBe('stopped');
    expect(session.state().stopReason).toBe('link-lost');
  });

  it('is not EARLIER either — a countdown tick is not the stop', async () => {
    const { session, camera, link, time } = await filming();
    link.emit({ kind: 'condition', condition: 'lost' });
    // Every tick of the countdown up to the last one before the limit.
    time.advance(LINK_LOSS_LIMIT_MILLISECONDS - COUNTDOWN_REFRESH_MILLISECONDS);
    expect(stops(camera)).toBe(0);
    expect(session.state().phase).toBe('filming');
  });

  it('counts down in whole seconds, rounded up, so it never says 0 while filming', async () => {
    const { session, link, time } = await filming();
    link.emit({ kind: 'condition', condition: 'lost' });
    expect(session.state().secondsLeft).toBe(30);
    time.advance(1_000);
    expect(session.state().secondsLeft).toBe(29);
    time.advance(28_500);
    expect(session.state().secondsLeft).toBe(1);
    time.advance(499);
    expect(session.state().phase).toBe('filming');
    expect(session.state().secondsLeft).toBe(1);
  });

  it('says so, in #528’s words, when it stops', async () => {
    const { session, link, time } = await filming();
    link.emit({ kind: 'condition', condition: 'lost' });
    time.advance(LINK_LOSS_LIMIT_MILLISECONDS);
    const reason = session.state().stopReason;
    expect(reason).toBe('link-lost');
    expect(reason === undefined ? '' : STOPPED_TEXT[reason]).toMatch(/^Stopped, link lost\./);
    // The countdown is gone with the camera.
    expect(session.state().secondsLeft).toBeUndefined();
  });

  it('goes on filming if the link comes back inside the window', async () => {
    const { session, camera, link, time } = await filming();
    link.emit({ kind: 'condition', condition: 'lost' });
    time.advance(20_000);
    link.emit({ kind: 'condition', condition: 'connected' });
    time.advance(60_000);
    expect(stops(camera)).toBe(0);
    expect(session.state().phase).toBe('filming');
    expect(session.state().secondsLeft).toBeUndefined();
    // And the tablet is told where the phone is, because it may have missed it.
    expect(link.reports.at(-1)).toStrictEqual({ state: 'filming' });
  });

  it('gives a second loss a fresh 30 seconds and never time left over from the first', async () => {
    const { camera, link, time } = await filming();
    link.emit({ kind: 'condition', condition: 'lost' });
    time.advance(20_000);
    link.emit({ kind: 'condition', condition: 'connected' });
    time.advance(5_000);
    link.emit({ kind: 'condition', condition: 'lost' });
    time.advance(LINK_LOSS_LIMIT_MILLISECONDS - 1);
    expect(stops(camera)).toBe(0);
    time.advance(1);
    expect(stops(camera)).toBe(1);
  });

  it('counts an ENDED link as lost that cannot recover — #529', async () => {
    const { session, camera, link, time } = await filming();
    link.emit({ kind: 'condition', condition: 'ended' });
    expect(session.state().secondsLeft).toBe(30);
    time.advance(LINK_LOSS_LIMIT_MILLISECONDS - 1);
    expect(stops(camera)).toBe(0);
    time.advance(1);
    expect(stops(camera)).toBe(1);
    expect(session.state().stopReason).toBe('link-lost');
  });

  it('does not restart the 30 seconds when a lost link then ends — #529', async () => {
    // Lost, then the connection gives up for good: the camera nobody can stop
    // gets the 30 seconds from the LOSS, not a second helping from the end.
    const { camera, link, time } = await filming();
    link.emit({ kind: 'condition', condition: 'lost' });
    time.advance(20_000);
    link.emit({ kind: 'condition', condition: 'ended' });
    time.advance(LINK_LOSS_LIMIT_MILLISECONDS - 20_000);
    expect(stops(camera)).toBe(1);
  });

  it('starts no countdown while a link is still connecting — #529', async () => {
    const { session } = await filming({ condition: 'connecting' });
    expect(session.state().secondsLeft).toBeUndefined();
  });

  it('applies while framing too, because the camera is on then as well', async () => {
    const camera = scriptedCamera();
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
    });
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    const link = scriptedLink();
    const time = virtualTime();
    const session = new SideCameraSession({ camera: controller, link, ...time });
    await session.turnOnForFraming();
    link.emit({ kind: 'condition', condition: 'lost' });
    time.advance(LINK_LOSS_LIMIT_MILLISECONDS);
    expect(stops(camera)).toBe(1);
    expect(session.state().stopReason).toBe('link-lost');
  });

  it('starts from the switch-on when the link was already lost', async () => {
    const { camera, time } = await filming({ condition: 'lost' });
    time.advance(LINK_LOSS_LIMIT_MILLISECONDS - 1);
    expect(stops(camera)).toBe(0);
    time.advance(1);
    expect(stops(camera)).toBe(1);
  });

  it('cannot be restarted by the tablet once it has stopped', async () => {
    const { session, camera, link, time } = await filming();
    link.emit({ kind: 'condition', condition: 'lost' });
    time.advance(LINK_LOSS_LIMIT_MILLISECONDS);
    link.emit({ kind: 'condition', condition: 'connected' });
    link.emit({ kind: 'start' });
    expect(session.state().phase).toBe('stopped');
    expect(camera.calls.filter((call) => call === 'start')).toHaveLength(1);
    // And the pairing is over (D-4: one session).
    expect(link.ended).toBe(1);
  });

  it('matches the consent sentence: the number on screen is the number in the timer', () => {
    // The sentence is what the rider agreed to. A limit changed here without
    // the sentence would make the consent false.
    const seconds = /up to (\d+) seconds/.exec(LINK_LOSS_SENTENCE)?.[1];
    expect(Number(seconds) * 1000).toBe(LINK_LOSS_LIMIT_MILLISECONDS);
  });

  it('quotes the owner’s sentence from ADR 0033 word for word', () => {
    const adr = readFileSync(
      fileURLToPath(new URL('../../../../docs/adr/0033-side-camera-link.md', import.meta.url)),
      'utf8',
    );
    expect(adr).toContain(`> **${LINK_LOSS_SENTENCE}**`);
  });
});

describe('who can start and stop it', () => {
  it('films only when the tablet says start, and only from framing', async () => {
    const camera = scriptedCamera();
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
    });
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    const link = scriptedLink();
    const session = new SideCameraSession({ camera: controller, link, ...virtualTime() });

    // Before the rider has turned the camera on here, a tablet's start does
    // nothing: it cannot turn this phone's camera on by itself.
    link.emit({ kind: 'start' });
    expect(session.state().phase).toBe('off');
    expect(camera.calls).not.toContain('start');

    await session.turnOnForFraming();
    expect(session.state().phase).toBe('framing');
    link.emit({ kind: 'start' });
    expect(session.state().phase).toBe('filming');
    expect(link.reports).toStrictEqual([{ state: 'framing' }, { state: 'filming' }]);
  });

  it('stops on the tablet’s stop, and lets the pairing go', async () => {
    const { session, camera, link } = await filming();
    link.emit({ kind: 'stop' });
    expect(stops(camera)).toBe(1);
    expect(session.state().stopReason).toBe('tablet');
    expect(link.reports.at(-1)).toStrictEqual({ state: 'stopped', reason: 'tablet' });
    expect(link.ended).toBe(1);
  });

  it('stops on the phone’s own control, even with the link lost', async () => {
    const { session, camera, link, time } = await filming();
    link.emit({ kind: 'condition', condition: 'lost' });
    time.advance(5_000);
    session.stopHere();
    expect(stops(camera)).toBe(1);
    expect(session.state().stopReason).toBe('rider');
    // And the 30-second timer is gone with it: no second stop at 30 s.
    time.advance(60_000);
    expect(session.state().stopReason).toBe('rider');
  });

  it('says so when the camera goes out by itself', async () => {
    const { session, camera, link, controller } = await filming();
    camera.endTheTrack();
    // The controller's liveness poll is what notices; revoking consent is the
    // same path and needs no poll.
    controller.revoke();
    expect(session.state().phase).toBe('stopped');
    expect(session.state().stopReason).toBe('camera');
    expect(link.reports.at(-1)).toStrictEqual({ state: 'stopped', reason: 'camera' });
  });

  it('stops the camera when the screen goes away mid-session', async () => {
    const { session, camera, link } = await filming();
    session.dispose();
    expect(stops(camera)).toBe(1);
    expect(link.ended).toBe(1);
  });

  it('turns a camera that arrives after the session ended straight back off', async () => {
    const camera = scriptedCamera();
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
    });
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    const link = scriptedLink();
    const session = new SideCameraSession({ camera: controller, link, ...virtualTime() });
    const on = session.turnOnForFraming();
    link.emit({ kind: 'stop' });
    await on;
    expect(camera.session()?.live).toBe(false);
    expect(session.state().phase).toBe('stopped');
  });

  it('turns the camera back off when the screen goes away during the permission prompt', async () => {
    // #536's review: disposed while still `off`, then permission granted.
    // Before the fix the session went on to `framing` with a live camera and
    // told the tablet so, with nothing left listening to stop it.
    const camera = scriptedCamera();
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
    });
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    const link = scriptedLink();
    const session = new SideCameraSession({ camera: controller, link, ...virtualTime() });
    const on = session.turnOnForFraming();
    session.dispose();
    await on;
    expect(camera.session()?.live).toBe(false);
    expect(controller.state().live).toBe(false);
    expect(session.state().phase).not.toBe('framing');
    expect(link.reports).toStrictEqual([]);
  });

  it('opens no camera the rider has not agreed to', async () => {
    const camera = scriptedCamera();
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
    });
    const session = new SideCameraSession({ camera: controller, ...virtualTime() });
    await session.turnOnForFraming();
    expect(camera.calls).toStrictEqual([]);
    expect(session.state().phase).toBe('off');
    expect(session.state().problem).toBe('no-consent');
  });

  it('works unpaired for framing, with no countdown and nothing to report to', async () => {
    const camera = scriptedCamera();
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
    });
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    const session = new SideCameraSession({ camera: controller, ...virtualTime() });
    await session.turnOnForFraming();
    expect(session.state()).toMatchObject({
      phase: 'framing',
      paired: false,
      linkCondition: undefined,
      secondsLeft: undefined,
    });
  });
});

describe('the reference and the verdict (D-7)', () => {
  const reference = {
    aspect: 16 / 9,
    landmarks: [
      { name: 'shoulder', x: 0.5, y: 0.3 },
      { name: 'hip', x: 0.42, y: 0.45 },
      { name: 'knee', x: 0.5, y: 0.62 },
    ],
  };

  it('holds the tablet’s reference and verdict', async () => {
    const { session, link } = await filming();
    link.emit({ kind: 'reference', reference });
    link.emit({ kind: 'verdict', verdict: 'differs' });
    expect(session.state().reference?.landmarks).toHaveLength(3);
    expect(session.state().verdict).toBe('differs');
  });

  it('drops a malformed reference and keeps the one it had', async () => {
    const { session, link } = await filming();
    link.emit({ kind: 'reference', reference });
    link.emit({ kind: 'reference', reference: { ...reference, landmarks: 'everything' } });
    expect(session.state().reference?.landmarks).toHaveLength(3);
  });

  it('drops a verdict that is not one of the two and keeps the one it had', async () => {
    const { session, link } = await filming();
    link.emit({ kind: 'verdict', verdict: 'matches' });
    for (const verdict of ['constructor', 'toString', 'MATCHES', 1, null, undefined, {}]) {
      link.emit({ kind: 'verdict', verdict });
      expect(session.state().verdict).toBe('matches');
    }
  });

  it('gives the same state object until something changes', async () => {
    const { session } = await filming();
    expect(session.state()).toBe(session.state());
  });
});

describe('keeps nothing (D-8)', () => {
  it('names no storage in the session or its screen', () => {
    const sources = [
      new URL('./side-camera.ts', import.meta.url),
      new URL('./side-camera-link-port.ts', import.meta.url),
      new URL('../views/SideCameraView.tsx', import.meta.url),
    ].map((url) => readFileSync(fileURLToPath(url), 'utf8'));
    for (const source of sources) {
      const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\b|@onyourleft\/store/);
    }
  });
});

describe('taking a link after the camera is on — #529', () => {
  async function framingUnpaired() {
    const camera = scriptedCamera();
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
    });
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    const time = virtualTime();
    const session = new SideCameraSession({ camera: controller, ...time });
    await session.turnOnForFraming();
    return { session, camera, time };
  }

  it('takes a connected link, tells the tablet where it is, and obeys it', async () => {
    const { session } = await framingUnpaired();
    const link = scriptedLink();
    expect(session.pair(link)).toBe(true);
    expect(session.state().paired).toBe(true);
    expect(link.reports).toStrictEqual([{ state: 'framing' }]);
    link.emit({ kind: 'start' });
    expect(session.state().phase).toBe('filming');
  });

  it('takes one link only, never one that is not connected, and none once stopped', async () => {
    const { session } = await framingUnpaired();
    expect(session.pair(scriptedLink('connecting'))).toBe(false);
    expect(session.pair(scriptedLink('ended'))).toBe(false);
    expect(session.pair(scriptedLink())).toBe(true);
    expect(session.pair(scriptedLink())).toBe(false);
    session.stopHere();
    const { session: stopped } = await framingUnpaired();
    stopped.stopHere();
    expect(stopped.pair(scriptedLink())).toBe(false);
  });

  it('runs the 30 seconds on a link it was handed late, exactly as on one it began with', async () => {
    const { session, camera, time } = await framingUnpaired();
    const link = scriptedLink();
    session.pair(link);
    link.emit({ kind: 'condition', condition: 'lost' });
    time.advance(LINK_LOSS_LIMIT_MILLISECONDS);
    expect(stops(camera)).toBe(1);
  });
});

describe('the pictures — #530, ADR 0033 D-3, D-5 and D-8', () => {
  /** Let a tick's picture be taken and handed over. */
  async function settle(): Promise<void> {
    for (let round = 0; round < 10; round += 1) {
      await Promise.resolve();
    }
  }

  /** Advance one picture interval at a time, letting each picture land. */
  async function pass(time: ReturnType<typeof virtualTime>, milliseconds: number): Promise<void> {
    for (let left = milliseconds; left > 0; left -= PICTURE_INTERVAL_MILLISECONDS) {
      time.advance(Math.min(PICTURE_INTERVAL_MILLISECONDS, left));
      await settle();
    }
  }

  it('takes five a second while filming, numbered from nought and timed from the start of filming', async () => {
    const { link, time, camera } = await filming();
    await pass(time, 1000);
    expect(link.pictures.map((picture) => [picture.sequence, picture.milliseconds])).toEqual([
      [0, 200],
      [1, 400],
      [2, 600],
      [3, 800],
      [4, 1000],
    ]);
    // Each is the small capture, and not the full-size one a kept frame would be.
    expect(camera.calls.filter((call) => call === 'side-frame')).toHaveLength(5);
    expect(camera.calls).not.toContain('capture');
    // A sequence number, milliseconds and the picture: nothing else crosses (D-3).
    for (const picture of link.pictures) {
      expect(Object.keys(picture).sort()).toEqual(['bytes', 'milliseconds', 'sequence']);
    }
  });

  it('takes none while framing, before the tablet says start', async () => {
    const camera = scriptedCamera();
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
    });
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    const link = scriptedLink();
    const time = virtualTime();
    const session = new SideCameraSession({ camera: controller, link, ...time });
    await session.turnOnForFraming();
    await pass(time, 2000);
    expect(link.pictures).toEqual([]);
  });

  it('takes none while the link is lost, and goes on numbering where it left off when it returns', async () => {
    const { link, time, camera } = await filming();
    await pass(time, 400);
    link.emit({ kind: 'condition', condition: 'lost' });
    await pass(time, 2000);
    expect(link.pictures).toHaveLength(2);
    // The camera was asked for nothing while there was nobody to send it to.
    expect(camera.calls.filter((call) => call === 'side-frame')).toHaveLength(2);
    link.emit({ kind: 'condition', condition: 'connected' });
    await pass(time, 200);
    expect(link.pictures.map((picture) => picture.sequence)).toEqual([0, 1, 2]);
  });

  it('drops, at once, a picture that was being taken when the link went', async () => {
    const { link, time } = await filming();
    time.advance(PICTURE_INTERVAL_MILLISECONDS);
    // The picture is being taken; the link goes before it is ready.
    link.emit({ kind: 'condition', condition: 'lost' });
    await settle();
    expect(link.pictures).toEqual([]);
  });

  it('does not count a picture the link would not take, and the next one reuses its number', async () => {
    const { link, time } = await filming();
    link.answer = 'busy';
    await pass(time, 200);
    link.answer = 'sent';
    await pass(time, 200);
    expect(link.pictures.map((picture) => picture.sequence)).toEqual([0, 0]);
  });

  it('takes one picture at a time: a slow one makes the next ticks wait, not queue', async () => {
    const camera = scriptedCamera();
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
    });
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    let asked = 0;
    let release: () => void = () => undefined;
    const slow = {
      turnOn: async () => controller.turnOn(),
      turnOff: () => {
        controller.turnOff();
      },
      state: () => controller.state(),
      subscribe: (listener: () => void) => controller.subscribe(listener),
      captureSideFrame: async () => {
        asked += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return controller.captureSideFrame();
      },
    };
    const link = scriptedLink();
    const time = virtualTime();
    const session = new SideCameraSession({ camera: slow, link, ...time });
    await session.turnOnForFraming();
    link.emit({ kind: 'start' });
    await pass(time, 1000);
    expect(asked).toBe(1);
    release();
    await settle();
    expect(link.pictures).toHaveLength(1);
    await pass(time, 200);
    expect(asked).toBe(2);
  });

  it('times each picture from the start of filming, not from when the phone was switched on', async () => {
    const camera = scriptedCamera();
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
    });
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    const link = scriptedLink();
    const time = virtualTime();
    time.advance(90_000);
    const session = new SideCameraSession({ camera: controller, link, ...time });
    await session.turnOnForFraming();
    time.advance(5_000);
    link.emit({ kind: 'start' });
    await pass(time, 200);
    expect(link.pictures.map((picture) => picture.milliseconds)).toEqual([200]);
  });

  it('leaves no picture timer running once stopped', async () => {
    const { session, time } = await filming();
    await pass(time, 200);
    session.stopHere();
    expect(time.active()).toBe(0);
  });

  it('takes no more once stopped, or once the screen has gone', async () => {
    const stopped = await filming();
    await pass(stopped.time, 200);
    stopped.session.stopHere();
    await pass(stopped.time, 2000);
    expect(stopped.link.pictures).toHaveLength(1);

    const gone = await filming();
    await pass(gone.time, 200);
    gone.session.dispose();
    await pass(gone.time, 2000);
    expect(gone.link.pictures).toHaveLength(1);
  });

  it('takes a picture every interval the owner named: five a second', () => {
    expect(1000 / PICTURE_INTERVAL_MILLISECONDS).toBe(5);
  });
});
