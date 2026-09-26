// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The side-camera link, both ends, driven through the real codes** — #529.
 *
 * Every pairing here goes offer code → phone → answer code → tablet, through
 * `side-link-code.ts` and the SDP `side-link-sdp.ts` rebuilds, over
 * `testing.ts` §`sidePeerNetwork`: peers that connect only when each holds the
 * OTHER's credentials and fingerprint. The drop — #529's *"a test drives the
 * drop and asserts both ends"* — is §"when the link is lost", with the phone's
 * real `SideCameraSession` and a real `CameraController` on a scripted camera,
 * so the assertion on the phone is that the CAMERA stopped, not a flag.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { CameraController } from './session';
import { LINK_LOSS_LIMIT_MILLISECONDS, SideCameraSession } from './side-camera';
import { PAIRING_CODE_PREFIX, type PairingRefusal } from './side-link-code';
import {
  COMMAND_ACK_MILLISECONDS,
  CONNECT_LIMIT_MILLISECONDS,
  OFFER_LIFETIME_MILLISECONDS,
  SIDE_PAIRING_END_TEXT,
  SILENCE_IS_LOST_MILLISECONDS,
  sideCommandText,
  sidePairingPort,
  SIDE_PHONE_STATE_TEXT,
} from './side-link';
import type { PhoneSidePairing, TabletSidePairing } from './side-pairing-port';
import type { SideLinkEvent } from './side-camera-link-port';
import {
  flushSideLink,
  scriptedCamera,
  sidePeerNetwork,
  virtualTime,
  type SidePeerNetworkOptions,
} from './testing';

const SECRET = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

function setUp(options: SidePeerNetworkOptions = {}) {
  const network = sidePeerNetwork(options);
  const time = virtualTime();
  const port = sidePairingPort({
    peer: network.peer,
    randomBytes: (length) => SECRET.slice(0, length),
    clock: time.clock,
    after: time.after,
    every: time.every,
  });
  /** Advance the clock a quarter-second at a time, letting messages land between. */
  const pass = async (milliseconds: number): Promise<void> => {
    for (let left = milliseconds; left > 0; left -= 250) {
      time.advance(Math.min(250, left));
      await flushSideLink();
    }
  };
  return { network, time, port, pass };
}

function isPairing<T extends object>(value: T | PairingRefusal): value is T {
  return typeof value === 'object';
}

async function offer(port: ReturnType<typeof setUp>['port']): Promise<TabletSidePairing> {
  const made = await port.offerSideCamera();
  if (!isPairing(made)) {
    throw new Error(`no offer: ${made}`);
  }
  return made;
}

async function answer(
  port: ReturnType<typeof setUp>['port'],
  code: string,
): Promise<PhoneSidePairing> {
  const made = await port.answerSideCamera(code);
  if (!isPairing(made)) {
    throw new Error(`no answer: ${made}`);
  }
  return made;
}

/** Both ends, paired through both codes, the phone's secret proved. */
async function paired(options: SidePeerNetworkOptions = {}) {
  const context = setUp(options);
  const tablet = await offer(context.port);
  const phone = await answer(context.port, tablet.offerCode);
  expect(await tablet.acceptSidePhoneCode(phone.answerCode)).toBeUndefined();
  await flushSideLink();
  return { ...context, tablet, phone };
}

/** A phone's side-camera session on a scripted camera, framing. */
async function framingPhone(time: ReturnType<typeof virtualTime>) {
  const camera = scriptedCamera();
  const controller = new CameraController({ port: camera.port, schedule: () => () => undefined });
  controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
  const session = new SideCameraSession({
    camera: controller,
    clock: time.clock,
    after: time.after,
    every: time.every,
  });
  await session.turnOnForFraming();
  return { camera, controller, session };
}

const sessions: SideCameraSession[] = [];
afterEach(() => {
  for (const session of sessions.splice(0)) {
    session.dispose();
  }
});

describe('pairing, through both codes', () => {
  it('connects, and the phone proves it read the offer before the tablet calls it paired', async () => {
    const { tablet, phone } = await paired();
    expect(tablet.offerCode.startsWith(PAIRING_CODE_PREFIX)).toBe(true);
    expect(phone.link.sideLinkCondition()).toBe('connected');
    // Proved, but the phone has not said where it is: still `pairing`.
    expect(tablet.control.sideControlState()).toEqual({
      phone: 'pairing',
      answered: true,
      stopReason: undefined,
      command: undefined,
      ended: undefined,
    });
    phone.link.reportToTablet({ state: 'framing' });
    await flushSideLink();
    expect(tablet.control.sideControlState().phone).toBe('framing');
  });

  it('carries the offer’s secret as the phone’s first message', async () => {
    const { network } = await paired();
    const phoneChannel = network.peers[1]?.channels[0];
    expect(JSON.parse(phoneChannel?.sent[0] ?? '{}')).toEqual({
      t: 'hello',
      k: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA',
    });
  });

  it('points every peer at nothing but the other device — the offer carries no server', async () => {
    const context = setUp();
    const tablet = await offer(context.port);
    expect(tablet.offerCode).not.toMatch(/stun|turn|relay|srflx/i);
  });

  it('accepts an answer ONCE — a second, or one after the pairing ended, is refused as used', async () => {
    const { tablet, phone } = await paired();
    expect(await tablet.acceptSidePhoneCode(phone.answerCode)).toBe('used');
    tablet.control.endSidePairing();
    expect(await tablet.acceptSidePhoneCode(phone.answerCode)).toBe('used');
  });

  it('keeps the offer up when the tablet is shown the wrong code', async () => {
    const context = setUp();
    const tablet = await offer(context.port);
    expect(await tablet.acceptSidePhoneCode(tablet.offerCode)).toBe('wrong-code');
    expect(await tablet.acceptSidePhoneCode('hello')).toBe('not-a-pairing-code');
    // Not used up: the real answer still pairs.
    const phone = await answer(context.port, tablet.offerCode);
    expect(await tablet.acceptSidePhoneCode(phone.answerCode)).toBeUndefined();
  });

  it('refuses, on the phone, anything that is not an offer', async () => {
    const context = setUp();
    const tablet = await offer(context.port);
    const phone = await answer(context.port, tablet.offerCode);
    expect(await context.port.answerSideCamera(phone.answerCode)).toBe('wrong-code');
    expect(await context.port.answerSideCamera('https://example.com')).toBe('not-a-pairing-code');
  });

  it('closes a connection whose first message is not this pairing’s secret', async () => {
    const context = setUp();
    const tablet = await offer(context.port);
    // The same offer with a different secret: every credential matches, so the
    // connection opens — and the secret is the only thing that is wrong.
    const forged = tablet.offerCode.replace(/"k":"[^"]+"/, `"k":"${'A'.repeat(42)}w"`);
    const phone = await answer(context.port, forged);
    await tablet.acceptSidePhoneCode(phone.answerCode);
    await flushSideLink();
    expect(tablet.control.sideControlState().ended).toBe('not-our-phone');
    expect(context.network.peers[0]?.closed).toBe(true);
  });

  it('holds the tablet’s pairing for the next screen, and replaces it with the next offer', async () => {
    const context = setUp();
    expect(context.port.currentSideCamera()).toBeUndefined();
    const first = await offer(context.port);
    expect(context.port.currentSideCamera()).toBe(first);
    const second = await offer(context.port);
    expect(context.port.currentSideCamera()).toBe(second);
    // One side camera at a time: the first was ended, not left dangling.
    expect(first.control.sideControlState().ended).toBe('ended-here');
    expect(context.network.peers[0]?.closed).toBe(true);
  });

  it('says it is unavailable where there is no WebRTC, and makes no code', async () => {
    const port = sidePairingPort({ peer: () => undefined });
    expect(await port.offerSideCamera()).toBe('unavailable');
  });

  it('refuses to show a code with no candidate on the rider’s own network', async () => {
    const context = setUp({ addresses: () => ['203.0.113.9'] });
    expect(await context.port.offerSideCamera()).toBe('no-candidate');
    expect(context.network.peers[0]?.closed).toBe(true);
  });

  it('goes on with what it has when gathering never says it finished', async () => {
    const context = setUp({ gathers: false });
    const made = context.port.offerSideCamera();
    await flushSideLink();
    context.time.advance(5000);
    expect(isPairing(await made)).toBe(true);
  });

  it('lets an unanswered offer expire, and says so', async () => {
    const context = setUp();
    const tablet = await offer(context.port);
    context.time.advance(OFFER_LIFETIME_MILLISECONDS - 1);
    expect(tablet.control.sideControlState().ended).toBeUndefined();
    context.time.advance(1);
    expect(tablet.control.sideControlState().ended).toBe('offer-expired');
    expect(context.network.peers[0]?.closed).toBe(true);
  });

  it('gives up on a phone the tablet never answers', async () => {
    const context = setUp();
    const tablet = await offer(context.port);
    const phone = await answer(context.port, tablet.offerCode);
    context.time.advance(CONNECT_LIMIT_MILLISECONDS);
    expect(phone.link.sideLinkCondition()).toBe('ended');
  });

  it('says there is no path when the devices cannot reach each other', async () => {
    const { tablet, phone } = await paired({ connects: false });
    await flushSideLink();
    expect(tablet.control.sideControlState().ended).toBe('no-path');
    expect(phone.link.sideLinkCondition()).toBe('ended');
  });

  it('says why when both ends offered only names — after ICE, never at decode', async () => {
    const { tablet } = await paired({
      connects: false,
      addresses: (index) => [`${String(index)}aaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.local`],
    });
    await flushSideLink();
    expect(tablet.control.sideControlState().ended).toBe('names-only');
  });
});

describe('start and stop, acknowledged or reported', () => {
  it('delivers a start, and the tablet hears it acknowledged', async () => {
    const { tablet, phone } = await paired();
    const heard: SideLinkEvent[] = [];
    phone.link.onSideLinkEvent((event) => heard.push(event));
    tablet.control.commandSideCamera('start');
    expect(tablet.control.sideControlState().command).toEqual({ kind: 'start', status: 'waiting' });
    await flushSideLink();
    expect(heard).toEqual([{ kind: 'start' }]);
    expect(tablet.control.sideControlState().command).toEqual({
      kind: 'start',
      status: 'acknowledged',
    });
  });

  it('reports a command nobody acknowledged, and does not assume it arrived', async () => {
    const { tablet, network, time } = await paired();
    network.drop();
    tablet.control.commandSideCamera('stop');
    time.advance(COMMAND_ACK_MILLISECONDS - 1);
    expect(tablet.control.sideControlState().command?.status).toBe('waiting');
    time.advance(1);
    expect(tablet.control.sideControlState().command).toEqual({
      kind: 'stop',
      status: 'unacknowledged',
    });
  });

  it('sends nothing before the phone has proved itself, and nothing after the end', async () => {
    const context = setUp();
    const tablet = await offer(context.port);
    tablet.control.commandSideCamera('start');
    expect(tablet.control.sideControlState().command).toBeUndefined();
  });

  it('obeys a command number once, however many times it arrives', async () => {
    const { phone, network } = await paired();
    const heard: SideLinkEvent[] = [];
    phone.link.onSideLinkEvent((event) => heard.push(event));
    const tabletChannel = network.peers[0]?.channels[0];
    tabletChannel?.send('{"t":"start","n":4}');
    tabletChannel?.send('{"t":"start","n":4}');
    tabletChannel?.send('{"t":"stop","n":2}');
    await flushSideLink();
    expect(heard).toEqual([{ kind: 'start' }]);
    // …and acknowledges all three: an ack says it arrived.
    const acks = network.peers[1]?.channels[0]?.sent.filter((text) => text.includes('"ack"'));
    expect(acks).toHaveLength(3);
  });

  it('words every status without a number or an address', () => {
    for (const kind of ['start', 'stop'] as const) {
      for (const status of ['waiting', 'acknowledged', 'unacknowledged'] as const) {
        expect(sideCommandText(kind, status)).toContain(kind);
      }
    }
    expect(sideCommandText('start', 'unacknowledged')).toMatch(/did not confirm/);
  });
});

describe('untrusted input ends the pairing (D-4)', () => {
  it('on the phone, for a message D-3 does not list', async () => {
    const { phone, network } = await paired();
    network.peers[0]?.channels[0]?.send('{"t":"format","disk":"all"}');
    await flushSideLink();
    expect(phone.link.sideLinkCondition()).toBe('ended');
  });

  it('on the tablet, for a message D-3 does not list, a second hello included', async () => {
    const { tablet, network } = await paired();
    network.peers[1]?.channels[0]?.send('{"t":"hello","k":"again"}');
    await flushSideLink();
    expect(tablet.control.sideControlState().ended).toBe('broken');
  });

  it('on the phone, for a second channel', async () => {
    const { phone, network } = await paired();
    network.peers[1]?.ondatachannel?.({
      channel: {
        label: 'frames',
        readyState: 'open',
        send: () => undefined,
        close: () => undefined,
        onopen: null,
        onclose: null,
        onmessage: null,
      },
    });
    expect(phone.link.sideLinkCondition()).toBe('ended');
  });
});

describe('when the link is lost — #529’s drop, asserted at both ends', () => {
  it('the tablet says so within the silence, and the phone’s CAMERA stops at 30 seconds', async () => {
    const { tablet, phone, network, time, pass } = await paired();
    const { camera, session } = await framingPhone(time);
    sessions.push(session);
    expect(session.pair(phone.link)).toBe(true);
    await flushSideLink();
    tablet.control.commandSideCamera('start');
    await flushSideLink();
    expect(session.state().phase).toBe('filming');
    expect(tablet.control.sideControlState().phone).toBe('filming');

    // The drop: nothing arrives in either direction, and no event says so.
    network.drop();
    await pass(SILENCE_IS_LOST_MILLISECONDS - 250);
    expect(tablet.control.sideControlState().phone).toBe('filming');
    await pass(250);
    // The tablet: link lost, at once — three missed heartbeats.
    expect(tablet.control.sideControlState().phone).toBe('lost');
    expect(SIDE_PHONE_STATE_TEXT.lost).toMatch(/link lost/i);
    // The phone: lost too, and counting down on its own timer.
    expect(phone.link.sideLinkCondition()).toBe('lost');
    expect(session.state().secondsLeft).toBe(30);
    expect(camera.calls).not.toContain('stop');

    time.advance(LINK_LOSS_LIMIT_MILLISECONDS - 1);
    expect(camera.calls).not.toContain('stop');
    time.advance(1);
    expect(camera.calls).toContain('stop');
    expect(session.state().phase).toBe('stopped');
    expect(session.state().stopReason).toBe('link-lost');
  });

  it('says so at once when the connection itself says it is disconnected', async () => {
    const { tablet, network } = await paired();
    const tabletPeer = network.peers[0];
    if (tabletPeer === undefined) {
      throw new Error('no peer');
    }
    tabletPeer.setConnection('disconnected');
    expect(tablet.control.sideControlState().phone).toBe('lost');
  });

  it('comes back inside the window, and the phone’s countdown goes', async () => {
    const { tablet, phone, network, time, pass } = await paired();
    const { camera, session } = await framingPhone(time);
    sessions.push(session);
    session.pair(phone.link);
    await flushSideLink();
    network.drop();
    await pass(SILENCE_IS_LOST_MILLISECONDS);
    expect(session.state().secondsLeft).toBeDefined();
    network.restore();
    await pass(1000);
    expect(phone.link.sideLinkCondition()).toBe('connected');
    expect(tablet.control.sideControlState().phone).toBe('framing');
    expect(session.state().secondsLeft).toBeUndefined();
    time.advance(LINK_LOSS_LIMIT_MILLISECONDS);
    expect(camera.calls).not.toContain('stop');
  });

  it('ends at both ends when the connection fails, and the phone still stops at 30 seconds', async () => {
    const { tablet, phone, network, time } = await paired();
    const { camera, session } = await framingPhone(time);
    sessions.push(session);
    session.pair(phone.link);
    await flushSideLink();
    network.fail();
    await flushSideLink();
    expect(tablet.control.sideControlState().ended).toBe('link-lost');
    expect(tablet.control.sideControlState().phone).toBe('lost');
    expect(SIDE_PAIRING_END_TEXT['link-lost']).toMatch(/30 seconds/);
    expect(phone.link.sideLinkCondition()).toBe('ended');
    time.advance(LINK_LOSS_LIMIT_MILLISECONDS);
    expect(camera.calls).toContain('stop');
  });
});

describe('ending a pairing, from either device (D-4’s revoking)', () => {
  it('from the tablet: the phone is told to stop first, and stops as told', async () => {
    const { tablet, phone, time } = await paired();
    const { camera, session } = await framingPhone(time);
    sessions.push(session);
    session.pair(phone.link);
    await flushSideLink();
    tablet.control.commandSideCamera('start');
    await flushSideLink();
    tablet.control.endSidePairing();
    await flushSideLink();
    expect(tablet.control.sideControlState().ended).toBe('ended-here');
    expect(session.state().stopReason).toBe('tablet');
    expect(camera.calls).toContain('stop');
    expect(phone.link.sideLinkCondition()).toBe('ended');
    tablet.control.commandSideCamera('start');
    expect(tablet.control.sideControlState().command?.kind).toBe('start');
    expect(tablet.control.sideControlState().command?.status).toBe('acknowledged');
  });

  it('from the phone: the tablet shows why it stopped, and that the phone ended it', async () => {
    const { tablet, phone, time } = await paired();
    const { session } = await framingPhone(time);
    sessions.push(session);
    session.pair(phone.link);
    await flushSideLink();
    session.stopHere();
    await flushSideLink();
    expect(tablet.control.sideControlState()).toMatchObject({
      phone: 'stopped',
      stopReason: 'rider',
      ended: 'phone-ended',
    });
  });

  it('a used pairing cannot be reused: an ended link is refused by a new session', async () => {
    const { tablet, phone, time } = await paired();
    tablet.control.endSidePairing();
    await flushSideLink();
    const { session } = await framingPhone(time);
    sessions.push(session);
    expect(session.pair(phone.link)).toBe(false);
    expect(session.state().paired).toBe(false);
  });
});
