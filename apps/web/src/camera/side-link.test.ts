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
import { SideAnalysis } from './side-analysis';
import { sidePictureMessage, type SidePicture } from './side-link-pictures';
import { LINK_LOSS_LIMIT_MILLISECONDS, SideCameraSession } from './side-camera';
import { PAIRING_CODE_PREFIX, type PairingRefusal } from './side-link-code';
import {
  CONTROL_CHANNEL,
  FRAMES_CHANNEL,
  COMMAND_ACK_MILLISECONDS,
  CONNECT_LIMIT_MILLISECONDS,
  HEARTBEAT_MILLISECONDS,
  OFFER_LIFETIME_MILLISECONDS,
  SIDE_PAIRING_END_TEXT,
  SILENCE_IS_LOST_MILLISECONDS,
  sideCommandText,
  sidePairingPort,
  SIDE_PHONE_STATE_TEXT,
  TABLET_READ_LIMIT_MILLISECONDS,
} from './side-link';
import type { PhoneSidePairing, TabletSidePairing } from './side-pairing-port';
import type { SideLinkEvent } from './side-camera-link-port';
import {
  browserScreenLockSource,
  type ScreenLock,
  type ScreenLockSource,
} from '../game/hud/wake-lock';
import { hideablePage } from '../game/hud/wake-lock-testing';
import {
  cleanFrameBytes,
  flushSideLink,
  scriptedCamera,
  sidePeerNetwork,
  virtualTime,
  type SidePeerNetworkOptions,
} from './testing';
import { browserSecureWindow } from './secure-window-testing';

const SECRET = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

function setUp(options: SidePeerNetworkOptions = {}, screenLock?: ScreenLockSource) {
  const network = sidePeerNetwork(options);
  const time = virtualTime();
  const port = sidePairingPort({
    screenLock,
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
async function paired(options: SidePeerNetworkOptions = {}, screenLock?: ScreenLockSource) {
  const context = setUp(options, screenLock);
  const tablet = await offer(context.port);
  const phone = await answer(context.port, tablet.offerCode);
  expect(await tablet.acceptSidePhoneCode(phone.answerCode)).toBeUndefined();
  await flushSideLink();
  return { ...context, tablet, phone };
}

/** A phone's side-camera session on a scripted camera, framing. */
async function framingPhone(time: ReturnType<typeof virtualTime>) {
  const camera = scriptedCamera();
  const controller = new CameraController({
    secureWindow: browserSecureWindow(),
    port: camera.port,
    schedule: () => () => undefined,
  });
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

  it('pairs when the engine loses what the phone sends inside ondatachannel — #568', async () => {
    // Chromium did this to the phone's secret about one pairing in a hundred
    // in CI: sent, `open`, nothing buffered, never delivered. A phone that
    // spoke first was then ended as `not-our-phone` by its next message.
    const { tablet, phone, pass } = await paired({ losesSendsInDataChannelEvent: true });
    expect(phone.link.sideLinkCondition()).toBe('connected');
    phone.link.reportToTablet({ state: 'framing' });
    await flushSideLink();
    await pass(HEARTBEAT_MILLISECONDS);
    expect(tablet.control.sideControlState().ended).toBeUndefined();
    expect(tablet.control.sideControlState().phone).toBe('framing');
  });

  it('keeps its secret while its channel says it cannot answer, and pairs once it can — #568', async () => {
    // Blink hands the phone its channel `open` without asking the engine, and
    // can then leave it saying `connecting` while the tablet's pings still
    // arrive. A secret sent then is dropped before it leaves the page, and
    // the phone's next message would end a genuine pairing as not-our-phone.
    const context = setUp({ strandsHandedChannels: true });
    const tablet = await offer(context.port);
    const phone = await answer(context.port, tablet.offerCode);
    await tablet.acceptSidePhoneCode(phone.answerCode);
    await flushSideLink();
    const phoneControl = context.network.peers[1]?.channels.find(
      (channel) => channel.label === CONTROL_CHANNEL,
    );
    expect(phoneControl?.readyState).toBe('connecting');
    expect(phoneControl?.sent).toEqual([]);
    expect(phone.link.sideLinkCondition()).toBe('connecting');
    // The engine puts the channel right; the next ping is answered.
    context.network.reopen();
    await context.pass(HEARTBEAT_MILLISECONDS);
    expect(JSON.parse(phoneControl?.sent[0] ?? '{}')).toMatchObject({ t: 'hello' });
    expect(phone.link.sideLinkCondition()).toBe('connected');
    phone.link.reportToTablet({ state: 'framing' });
    await flushSideLink();
    expect(tablet.control.sideControlState()).toMatchObject({ phone: 'framing', ended: undefined });
    // And well past the bound, nothing ends it: the channel can answer now.
    await context.pass(CONNECT_LIMIT_MILLISECONDS);
    expect(tablet.control.sideControlState().ended).toBeUndefined();
    expect(phone.link.sideLinkCondition()).toBe('connected');
    // A bound that ran out on a channel that had come right is not spent:
    // stranded again, the phone still lets go.
    Object.assign(phoneControl ?? {}, { stranded: true, readyState: 'connecting' });
    await context.pass(HEARTBEAT_MILLISECONDS + SILENCE_IS_LOST_MILLISECONDS);
    expect(phone.link.sideLinkCondition()).toBe('ended');
  });

  it('does not sit unproved when the phone’s channel never comes right — CI run 36252687970, reproduced (#568)', async () => {
    // The state CI saw ten seconds after the phone connected:
    // `{"phone":"pairing","answered":true}`, nothing ended, nothing from the
    // phone ever arriving while the tablet's pings did. With the phone's
    // channel stranded and never put right, both ends now end within the
    // silence bound, and the tablet says why in words that do not blame the
    // network.
    const context = setUp({ strandsHandedChannels: true });
    const tablet = await offer(context.port);
    const phone = await answer(context.port, tablet.offerCode);
    await tablet.acceptSidePhoneCode(phone.answerCode);
    await flushSideLink();
    const phoneControl = context.network.peers[1]?.channels.find(
      (channel) => channel.label === CONTROL_CHANNEL,
    );
    await context.pass(SILENCE_IS_LOST_MILLISECONDS);
    expect(tablet.control.sideControlState()).toMatchObject({
      phone: 'pairing',
      answered: true,
      ended: 'unanswered',
    });
    expect(phone.link.sideLinkCondition()).toBe('ended');
    // It spent nothing, and it never called itself connected.
    expect(phoneControl?.sent).toEqual([]);
    expect(context.network.peers.every((peer) => peer.closed)).toBe(true);
  });

  it('ends a pairing whose phone never answers three seconds after control opened, and says so — #568', async () => {
    // #568's second mode, from the tablet's side: pings going out, nothing
    // coming back. It used to wait out the connect limit and then say the
    // devices could not reach each other — which they had.
    const context = setUp();
    const tablet = await offer(context.port);
    const phone = await answer(context.port, tablet.offerCode);
    // Nothing crosses once connected: the phone hears no ping, so answers
    // nothing, and its own limit is the connect limit, far past this.
    context.network.drop();
    await tablet.acceptSidePhoneCode(phone.answerCode);
    await flushSideLink();
    await context.pass(SILENCE_IS_LOST_MILLISECONDS - 250);
    expect(tablet.control.sideControlState().ended).toBeUndefined();
    await context.pass(250);
    expect(tablet.control.sideControlState().ended).toBe('unanswered');
    expect(SIDE_PAIRING_END_TEXT.unanswered).toMatch(/Pair again/);
    expect(SIDE_PAIRING_END_TEXT.unanswered).not.toMatch(/Wi-Fi/);
    expect(context.network.peers[0]?.closed).toBe(true);
  });

  it('calls a pairing that opened and then closed before proof unanswered, not a network with no path — #568', async () => {
    const context = setUp();
    const tablet = await offer(context.port);
    const phone = await answer(context.port, tablet.offerCode);
    context.network.drop();
    await tablet.acceptSidePhoneCode(phone.answerCode);
    await flushSideLink();
    // The phone goes, before it has said anything: the channel closes.
    phone.link.endSideLink();
    await flushSideLink();
    expect(tablet.control.sideControlState().ended).toBe('unanswered');
  });

  it('ends the phone’s end of a link whose channel hears the tablet and cannot answer — #568', async () => {
    // Proved, then left saying `connecting`: every report and heartbeat is
    // dropped before it leaves the page, and the tablet's pings still arrive,
    // so the phone would otherwise call itself connected for ever while the
    // tablet shows it lost — and never start D-5's 30 seconds.
    const { network, tablet, phone, pass } = await paired();
    const phoneControl = network.peers[1]?.channels.find(
      (channel) => channel.label === CONTROL_CHANNEL,
    );
    Object.assign(phoneControl ?? {}, { stranded: true, readyState: 'connecting' });
    await pass(HEARTBEAT_MILLISECONDS);
    expect(phone.link.sideLinkCondition()).toBe('connected');
    await pass(SILENCE_IS_LOST_MILLISECONDS);
    expect(phone.link.sideLinkCondition()).toBe('ended');
    await flushSideLink();
    expect(tablet.control.sideControlState().ended).toBe('link-lost');
  });

  it('lets nothing the phone says overtake its secret: a lost secret ends the pairing unanswered, never as not-our-phone — #568', async () => {
    // #568 as reported: the tablet heard the phone's first REPORT before its
    // secret, and D-4 ended a genuine pairing as an intruder. Here the
    // engine loses the phone's secret wherever it is sent from, and delivers
    // everything after it. Before #568's third fix the phone sent its report
    // and its heartbeat straight after the secret, so one of them reached the
    // tablet first.
    const context = setUp({ losesAnsweringEndsFirstControlMessage: true });
    const tablet = await offer(context.port);
    const phone = await answer(context.port, tablet.offerCode);
    await tablet.acceptSidePhoneCode(phone.answerCode);
    await flushSideLink();
    const phoneControl = context.network.peers[1]?.channels.find(
      (channel) => channel.label === CONTROL_CHANNEL,
    );
    phone.link.reportToTablet({ state: 'framing' });
    await flushSideLink();
    await context.pass(SILENCE_IS_LOST_MILLISECONDS);
    expect(tablet.control.sideControlState().ended).toBe('unanswered');
    // The secret was sent, and it is ALL the phone sent: nothing it could say
    // after it was said before the tablet had welcomed it.
    expect(phoneControl?.sent.map((text) => (JSON.parse(text) as { t: string }).t)).toEqual([
      'hello',
    ]);
    expect(phone.link.sideLinkCondition()).toBe('ended');
  });

  it('says nothing after its secret until the tablet has welcomed it, and is welcomed again every heartbeat until heard — #568', async () => {
    const { port, network, pass } = setUp();
    const tablet = await offer(port);
    const tabletControl = network.peers[0]?.channels.find((c) => c.label === CONTROL_CHANNEL);
    if (tabletControl === undefined) {
      throw new Error('no control channel');
    }
    // The tablet's welcomes are lost; its pings are not.
    const send = tabletControl.send.bind(tabletControl);
    let welcomesLost = 0;
    tabletControl.send = (data) => {
      if (typeof data === 'string' && data.includes('"welcome"')) {
        welcomesLost += 1;
        return;
      }
      send(data);
    };
    const phone = await answer(port, tablet.offerCode);
    await tablet.acceptSidePhoneCode(phone.answerCode);
    await flushSideLink();
    const phoneControl = network.peers[1]?.channels.find((c) => c.label === CONTROL_CHANNEL);
    // Proved on the tablet, and the phone still unwelcomed: it holds its report.
    phone.link.reportToTablet({ state: 'framing' });
    await pass(2 * HEARTBEAT_MILLISECONDS);
    expect(welcomesLost).toBeGreaterThanOrEqual(2);
    expect(phoneControl?.sent.map((text) => (JSON.parse(text) as { t: string }).t)).toEqual([
      'hello',
    ]);
    expect(phone.link.sideLinkCondition()).toBe('connecting');
    expect(
      phone.link.sendPictureToTablet({ sequence: 0, milliseconds: 0, bytes: cleanFrameBytes() }),
    ).toBe('no-link');
    // The next welcome gets through, and only then does the phone speak.
    tabletControl.send = send;
    await pass(HEARTBEAT_MILLISECONDS);
    expect(phone.link.sideLinkCondition()).toBe('connected');
    phone.link.reportToTablet({ state: 'framing' });
    await flushSideLink();
    expect(tablet.control.sideControlState()).toMatchObject({ phone: 'framing', ended: undefined });
  });

  it('takes a command from a proved tablet as its welcome, when every welcome was lost — #568', async () => {
    const { port, network } = setUp();
    const tablet = await offer(port);
    const tabletControl = network.peers[0]?.channels.find((c) => c.label === CONTROL_CHANNEL);
    if (tabletControl === undefined) {
      throw new Error('no control channel');
    }
    const send = tabletControl.send.bind(tabletControl);
    tabletControl.send = (data) => {
      if (!(typeof data === 'string' && data.includes('"welcome"'))) {
        send(data);
      }
    };
    const phone = await answer(port, tablet.offerCode);
    await tablet.acceptSidePhoneCode(phone.answerCode);
    await flushSideLink();
    expect(phone.link.sideLinkCondition()).toBe('connecting');
    tablet.control.commandSideCamera('start');
    await flushSideLink();
    expect(phone.link.sideLinkCondition()).toBe('connected');
    expect(tablet.control.sideControlState().command).toEqual({
      kind: 'start',
      status: 'acknowledged',
    });
  });

  // Every message the tablet sends only once it has proved the phone, not
  // only the welcome: the rule is "anything but a ping", and a future special
  // case for `welcome` must not reopen the path for the others.
  it.each([
    ['a welcome', '{"t":"welcome"}'],
    ['a command', '{"t":"start","n":1}'],
    ['a framing reference', '{"t":"reference","reference":{}}'],
  ])(
    'ends the phone’s link on anything but a ping before it has sent its secret — %s (#568)',
    async (_, message) => {
      const { port, network } = setUp();
      const tablet = await offer(port);
      network.drop();
      const phone = await answer(port, tablet.offerCode);
      await tablet.acceptSidePhoneCode(phone.answerCode);
      await flushSideLink();
      network.restore();
      // Only a tablet that has proved the phone welcomes, commands or shares,
      // and it cannot have proved a phone that has not sent its secret.
      network.peers[1]?.channels.find((c) => c.label === CONTROL_CHANNEL)?.deliver(message);
      await flushSideLink();
      expect(phone.link.sideLinkCondition()).toBe('ended');
    },
  );

  it('says nothing until the tablet has spoken, and answers its repeated opening ping', async () => {
    const context = setUp();
    const tablet = await offer(context.port);
    const phone = await answer(context.port, tablet.offerCode);
    // The tablet's first ping is lost with everything else.
    context.network.drop();
    await tablet.acceptSidePhoneCode(phone.answerCode);
    await flushSideLink();
    const phoneControl = context.network.peers[1]?.channels.find(
      (channel) => channel.label === CONTROL_CHANNEL,
    );
    expect(phoneControl?.readyState).toBe('open');
    // Not even a report the phone is asked to make: nothing before the secret.
    phone.link.reportToTablet({ state: 'framing' });
    expect(phoneControl?.sent).toEqual([]);
    expect(phone.link.sideLinkCondition()).toBe('connecting');
    // The next ping gets through, and the secret answers it.
    context.network.restore();
    await context.pass(HEARTBEAT_MILLISECONDS);
    expect(JSON.parse(phoneControl?.sent[0] ?? '{}')).toMatchObject({ t: 'hello' });
    expect(phone.link.sideLinkCondition()).toBe('connected');
    phone.link.reportToTablet({ state: 'framing' });
    await flushSideLink();
    expect(tablet.control.sideControlState()).toMatchObject({ phone: 'framing', ended: undefined });
  });

  it('stops its opening ping once the phone has proved itself — one ping a heartbeat, not two (#573)', async () => {
    const { network, pass } = await paired();
    const control = network.peers[0]?.channels.find((c) => c.label === CONTROL_CHANNEL);
    // A heartbeat is a `ping`, or a `welcome` until the phone is heard (#568).
    const pings = (): number =>
      (control?.sent ?? []).filter((m) => m === '{"t":"ping"}' || m === '{"t":"welcome"}').length;
    const before = pings();
    const heartbeats = 10;
    await pass(heartbeats * HEARTBEAT_MILLISECONDS);
    // The heartbeat alone. With the opening ping left running beside it, the
    // tablet would send twice this for the whole pairing.
    expect(pings() - before).toBe(heartbeats);
    // And once the phone has been heard, it is a ping again: the welcome is
    // repeated only until it is known to have landed (#568).
    expect(control?.sent.at(-1)).toBe('{"t":"ping"}');
  });

  it('lets go of the channel’s open handler when it ends, and an open after the end sends nothing (#573)', async () => {
    const { port, network } = setUp();
    const tablet = await offer(port);
    const control = network.peers[0]?.channels.find((c) => c.label === CONTROL_CHANNEL);
    // Not yet open, so the tablet is waiting on its `open` to invite.
    const opened = control?.onopen;
    expect(opened).toBeTypeOf('function');
    tablet.control.endSidePairing();
    await flushSideLink();
    expect(control?.onopen).toBeNull();
    // An engine that fires the old handler anyway, on a channel it calls open:
    // `#invite` returns on the end rather than pinging a pairing that is over.
    Object.assign(control ?? {}, { readyState: 'open' });
    opened?.();
    expect(control?.sent).toEqual([]);
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

  it('does not expire an offer that was answered — a live pairing outlasts the offer’s five minutes', async () => {
    // #550's review: with the `#answered` guard on the expiry replaced by
    // `true`, every live pairing ended five minutes in, mid-ride, and no test
    // noticed. The link is kept talking a quarter-second at a time so that
    // nothing but the expiry could end it.
    const { tablet, pass } = await paired();
    await pass(OFFER_LIFETIME_MILLISECONDS + 1000);
    expect(tablet.control.sideControlState().ended).toBeUndefined();
    tablet.control.commandSideCamera('start');
    await flushSideLink();
    expect(tablet.control.sideControlState().command).toEqual({
      kind: 'start',
      status: 'acknowledged',
    });
  });

  it('gives up on a phone the tablet never answers — after a person’s wait, not a machine’s (#1108)', async () => {
    const context = setUp();
    const tablet = await offer(context.port);
    // The tablet's own (its offer's lifetime), which the phone's end must not add to once it ends.
    const tabletTimers = context.time.active();
    const phone = await answer(context.port, tablet.offerCode);
    // The owner's report: the phone gave up at fifteen seconds while the rider
    // was still holding it up to the tablet. It is still waiting at that point.
    context.time.advance(CONNECT_LIMIT_MILLISECONDS);
    expect(phone.link.sideLinkCondition()).toBe('connecting');
    context.time.advance(TABLET_READ_LIMIT_MILLISECONDS - CONNECT_LIMIT_MILLISECONDS - 1);
    expect(phone.link.sideLinkCondition()).toBe('connecting');
    expect(phone.secondsForTabletToRead()).toBe(1);
    context.time.advance(1);
    expect(phone.link.sideLinkCondition()).toBe('ended');
    // Zero, not nothing: the screen tells a wait that ran out from any other end.
    expect(phone.secondsForTabletToRead()).toBe(0);
    // And no timer of the phone's is left running: not the wait, not the countdown.
    expect(context.time.active()).toBe(tabletTimers);
  });

  it('waits two minutes for the tablet to read the phone’s code, inside the offer’s own five (#1108)', () => {
    expect(TABLET_READ_LIMIT_MILLISECONDS).toBe(2 * 60 * 1000);
    expect(TABLET_READ_LIMIT_MILLISECONDS).toBeGreaterThan(CONNECT_LIMIT_MILLISECONDS);
    expect(TABLET_READ_LIMIT_MILLISECONDS).toBeLessThan(OFFER_LIFETIME_MILLISECONDS);
  });

  it('counts the wait down once a second, and stops counting once the tablet has read the code (#1108)', async () => {
    const context = setUp();
    const tablet = await offer(context.port);
    const phone = await answer(context.port, tablet.offerCode);
    let told = 0;
    const unsubscribe = phone.onTabletReadCountdown(() => {
      told += 1;
    });
    expect(phone.secondsForTabletToRead()).toBe(TABLET_READ_LIMIT_MILLISECONDS / 1000);
    context.time.advance(3000);
    expect(told).toBe(3);
    expect(phone.secondsForTabletToRead()).toBe(TABLET_READ_LIMIT_MILLISECONDS / 1000 - 3);
    await tablet.acceptSidePhoneCode(phone.answerCode);
    await context.pass(HEARTBEAT_MILLISECONDS);
    expect(phone.link.sideLinkCondition()).toBe('connected');
    expect(phone.secondsForTabletToRead()).toBeUndefined();
    const after = told;
    // Read, then nothing more to count: the countdown's timer is gone.
    await context.pass(TABLET_READ_LIMIT_MILLISECONDS);
    expect(told).toBe(after);
    expect(phone.link.sideLinkCondition()).toBe('connected');
    unsubscribe();
  });

  it('once the tablet has the code, waits only the machine handshake for it to finish (#1108)', async () => {
    const context = setUp();
    const tablet = await offer(context.port);
    const phone = await answer(context.port, tablet.offerCode);
    context.time.advance(60_000);
    // A `control` channel arriving is the phone's sign that the tablet read
    // its code. One on which the tablet never says anything is a handshake
    // that never finished, and it is bounded by the machine's limit again.
    const phonePeer = context.network.peers[1];
    const stray = context.network.peer().createDataChannel(CONTROL_CHANNEL, { ordered: true });
    phonePeer?.ondatachannel?.({ channel: stray });
    expect(phone.secondsForTabletToRead()).toBeUndefined();
    context.time.advance(CONNECT_LIMIT_MILLISECONDS - 1);
    expect(phone.link.sideLinkCondition()).toBe('connecting');
    context.time.advance(1);
    expect(phone.link.sideLinkCondition()).toBe('ended');
  });

  it('ends an answered pairing whose answer is never applied — the bound starts at the answer, not after it (#568)', async () => {
    // The offer's own expiry stops once an answer is accepted, so the connect
    // limit is the only bound left; it used to be set only once the engine
    // had applied the answer, and an engine that never settled left the
    // tablet `answered`, unproved and never ended.
    const context = setUp();
    const tablet = await offer(context.port);
    const phone = await answer(context.port, tablet.offerCode);
    Object.assign(context.network.peers[0] ?? {}, {
      setRemoteDescription: async () => new Promise<void>(() => undefined),
    });
    void tablet.acceptSidePhoneCode(phone.answerCode);
    await flushSideLink();
    expect(tablet.control.sideControlState()).toMatchObject({ answered: true, ended: undefined });
    context.time.advance(CONNECT_LIMIT_MILLISECONDS - 1);
    expect(tablet.control.sideControlState().ended).toBeUndefined();
    context.time.advance(1);
    expect(tablet.control.sideControlState().ended).toBe('no-path');
    expect(context.network.peers[0]?.closed).toBe(true);
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

  it('on the phone, for a second channel of a name it already has', async () => {
    const { phone, network } = await paired();
    // #530: the tablet's offer carries `control` AND `frames`, so a THIRD
    // channel — a second `frames` — is what D-3 does not list.
    network.peers[1]?.ondatachannel?.({
      channel: {
        label: 'frames',
        readyState: 'open',
        bufferedAmount: 0,
        binaryType: 'arraybuffer',
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

/**
 * A screen-lock source that records what it was asked, and can hold its answer
 * back until a test lets it go.
 */
function recordingScreenLock(options: { readonly late?: boolean } = {}) {
  let acquired = 0;
  let released = 0;
  let arrive: () => void = () => undefined;
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  const source: ScreenLockSource = {
    acquire: async (): Promise<ScreenLock> => {
      acquired += 1;
      if (options.late === true) {
        await arrived;
      }
      let held = true;
      return {
        get held(): boolean {
          return held;
        },
        release: async (): Promise<void> => {
          if (held) {
            held = false;
            released += 1;
          }
          return Promise.resolve();
        },
      };
    },
  };
  return {
    source,
    acquired: () => acquired,
    released: () => released,
    arrive: () => {
      arrive();
    },
  };
}

describe('the tablet stays awake while it pairs and while it is paired — #557', () => {
  it('takes the lock with the offer, holds it once paired, and gives it back when the rider ends it', async () => {
    const lock = recordingScreenLock();
    const { tablet } = await paired({}, lock.source);
    await flushSideLink();
    expect(lock.acquired()).toBe(1);
    expect(lock.released()).toBe(0);
    tablet.control.endSidePairing();
    await flushSideLink();
    expect(lock.released()).toBe(1);
    // A second end gives nothing back twice.
    tablet.control.endSidePairing();
    await flushSideLink();
    expect(lock.released()).toBe(1);
  });

  it('gives it back when an offer nobody answered expires', async () => {
    const lock = recordingScreenLock();
    const context = setUp({}, lock.source);
    await offer(context.port);
    await flushSideLink();
    expect(lock.acquired()).toBe(1);
    context.time.advance(OFFER_LIFETIME_MILLISECONDS);
    await flushSideLink();
    expect(lock.released()).toBe(1);
  });

  it('gives it back when the connection fails', async () => {
    const lock = recordingScreenLock();
    const { tablet, network } = await paired({}, lock.source);
    network.peers[0]?.setConnection('failed');
    await flushSideLink();
    expect(tablet.control.sideControlState().ended).toBe('link-lost');
    expect(lock.released()).toBe(1);
  });

  it('gives back a lock that only arrived after the pairing had ended', async () => {
    const lock = recordingScreenLock({ late: true });
    const { tablet } = await paired({}, lock.source);
    tablet.control.endSidePairing();
    await flushSideLink();
    expect(lock.released()).toBe(0);
    lock.arrive();
    await flushSideLink();
    expect(lock.released()).toBe(1);
  });

  it('takes the lock again when the tablet comes back into view, and not once the pairing has ended — #566’s review', async () => {
    // The platform lets a screen lock go whenever the page is hidden. A rider
    // who switched away for a moment used to come back to a tablet that slept
    // on its own timeout, and D-4 then dropped the link.
    const platform = hideablePage();
    const { tablet } = await paired({}, browserScreenLockSource(platform.api, platform.page));
    await flushSideLink();
    expect(platform.live()).toBe(1);
    platform.hide();
    platform.show();
    await flushSideLink();
    expect(platform.requests()).toBe(2);
    expect(platform.live()).toBe(1);
    tablet.control.endSidePairing();
    await flushSideLink();
    expect(platform.live()).toBe(0);
    platform.hide();
    platform.show();
    await flushSideLink();
    expect(platform.requests()).toBe(2);
    expect(platform.live()).toBe(0);
  });

  it('makes a pairing with no lock source at all', async () => {
    const { tablet } = await paired();
    tablet.control.endSidePairing();
    await flushSideLink();
    expect(tablet.control.sideControlState().ended).toBe('ended-here');
  });
});

describe('who ended it, said the same on both devices — #557', () => {
  it('Stop filming on the tablet: the phone says the tablet ended it, and so does the tablet', async () => {
    const { tablet, phone, time } = await paired();
    const { session } = await framingPhone(time);
    sessions.push(session);
    session.pair(phone.link);
    await flushSideLink();
    tablet.control.commandSideCamera('start');
    await flushSideLink();
    tablet.control.commandSideCamera('stop');
    await flushSideLink();
    expect(session.state().stopReason).toBe('tablet');
    expect(tablet.control.sideControlState()).toMatchObject({
      phone: 'stopped',
      stopReason: 'tablet',
      ended: 'ended-here',
    });
  });
});

describe('pictures, phone → tablet — #530, ADR 0033 D-3 and D-4', () => {
  const PICTURE = { sequence: 0, milliseconds: 200, bytes: cleanFrameBytes(2000) };

  it('opens the pictures channel beside control, unordered and with no retransmission', async () => {
    const { network } = await paired();
    const [control, frames] = network.peers[0]?.channels ?? [];
    expect(control?.label).toBe(CONTROL_CHANNEL);
    expect(control?.init).toEqual({ ordered: true });
    expect(frames?.label).toBe(FRAMES_CHANNEL);
    expect(frames?.init).toEqual({ ordered: false, maxRetransmits: 0 });
    // Both ends read a picture as an ArrayBuffer, never as a Blob.
    expect(frames?.binaryType).toBe('arraybuffer');
    expect(network.peers[1]?.channels.find((c) => c.label === FRAMES_CHANNEL)?.binaryType).toBe(
      'arraybuffer',
    );
  });

  it('carries a picture across, whole, with its number and time and nothing else', async () => {
    const { tablet, phone } = await paired();
    const heard: SidePicture[] = [];
    tablet.control.onSideCameraPicture((picture) => heard.push(picture));
    expect(phone.link.sendPictureToTablet(PICTURE)).toBe('sent');
    await flushSideLink();
    expect(heard).toEqual([PICTURE]);
  });

  it('sends nothing on the control channel for a picture', async () => {
    const { phone, network } = await paired();
    const control = network.peers[1]?.channels.find((c) => c.label === CONTROL_CHANNEL);
    const before = control?.sent.length ?? 0;
    phone.link.sendPictureToTablet(PICTURE);
    expect(control?.sent.length).toBe(before);
    expect(
      network.peers[1]?.channels.find((c) => c.label === FRAMES_CHANNEL)?.sentBinary,
    ).toHaveLength(1);
  });

  it('refuses, and says why, a picture it cannot send — with no link, behind a stalled one, or too big', async () => {
    const small = await paired({ maxMessageSize: 1500 });
    // Too big for what THIS connection says it carries, though well inside 64 KiB.
    expect(small.phone.link.sendPictureToTablet(PICTURE)).toBe('too-large');
    expect(small.phone.link.sendPictureToTablet({ ...PICTURE, bytes: cleanFrameBytes(1000) })).toBe(
      'sent',
    );

    const { phone, network } = await paired();
    const frames = network.peers[1]?.channels.find((c) => c.label === FRAMES_CHANNEL);
    if (frames === undefined) {
      throw new Error('no frames channel');
    }
    frames.bufferedAmount = 2009;
    expect(phone.link.sendPictureToTablet(PICTURE)).toBe('busy');
    frames.bufferedAmount = 0;
    network.drop();
    await flushSideLink();
    phone.link.endSideLink();
    expect(phone.link.sendPictureToTablet(PICTURE)).toBe('no-link');
    expect(frames.sentBinary).toHaveLength(0);
  });

  it('sends no picture before the tablet has connected', async () => {
    const { port } = setUp();
    const tablet = await offer(port);
    const phone = await answer(port, tablet.offerCode);
    expect(phone.link.sendPictureToTablet(PICTURE)).toBe('no-link');
  });

  it('ends the pairing on the tablet for a picture before the phone proved itself', async () => {
    const { port, network } = setUp();
    const tablet = await offer(port);
    const frames = network.peers[0]?.channels.find((c) => c.label === FRAMES_CHANNEL);
    frames?.onmessage?.({ data: sidePictureMessage(PICTURE) });
    expect(tablet.control.sideControlState().ended).toBe('not-our-phone');
  });

  it('ends the pairing on the tablet for anything on the pictures channel that is not a picture', async () => {
    const { tablet, network } = await paired();
    const frames = network.peers[0]?.channels.find((c) => c.label === FRAMES_CHANNEL);
    frames?.deliver('{"t":"state","s":"filming"}');
    await flushSideLink();
    expect(tablet.control.sideControlState().ended).toBe('broken');
  });

  it('ends the pairing on the phone for anything the tablet sends on the pictures channel', async () => {
    const { phone, network } = await paired();
    const frames = network.peers[1]?.channels.find((c) => c.label === FRAMES_CHANNEL);
    frames?.deliver(sidePictureMessage(PICTURE));
    await flushSideLink();
    expect(phone.link.sideLinkCondition()).toBe('ended');
  });

  it('hands no picture to anybody once the pairing has ended, even one already on its way', async () => {
    const { tablet, network } = await paired();
    const frames = network.peers[0]?.channels.find((c) => c.label === FRAMES_CHANNEL);
    if (frames === undefined) {
      throw new Error('no pictures channel');
    }
    // The handler as it was while the pairing was up: a message the platform
    // had already dispatched to it when the pairing ended.
    const inFlight = frames.onmessage;
    const before: SidePicture[] = [];
    tablet.control.onSideCameraPicture((picture) => before.push(picture));
    tablet.control.endSidePairing();
    const after: SidePicture[] = [];
    tablet.control.onSideCameraPicture((picture) => after.push(picture));
    inFlight?.({ data: sidePictureMessage(PICTURE) });
    frames.onmessage?.({ data: sidePictureMessage(PICTURE) });
    await flushSideLink();
    expect(before).toEqual([]);
    expect(after).toEqual([]);
  });

  it('counts a picture as hearing from the phone, so a filming phone is not called lost', async () => {
    const { tablet, phone, network, pass } = await paired();
    // Only the pictures get through: the heartbeat on control does not.
    const phoneControl = network.peers[1]?.channels.find((c) => c.label === CONTROL_CHANNEL);
    if (phoneControl === undefined) {
      throw new Error('no control channel');
    }
    phoneControl.send = () => undefined;
    for (let second = 0; second < 5; second += 1) {
      phone.link.sendPictureToTablet({ ...PICTURE, sequence: second });
      await pass(1000);
    }
    expect(tablet.control.sideControlState().phone).not.toBe('lost');
  });

  it('shares the reference and the verdict with the phone, and only once it has proved itself', async () => {
    const { port } = setUp();
    const early = await offer(port);
    const reference = { aspect: 16 / 9, landmarks: [{ name: 'hip' as const, x: 0.4, y: 0.5 }] };
    // Before an answer: nothing to share with, and nothing breaks.
    early.control.shareFramingReference(reference);
    early.control.shareFramingVerdict('matches');

    const { tablet, phone } = await paired();
    const heard: SideLinkEvent[] = [];
    phone.link.onSideLinkEvent((event) => heard.push(event));
    tablet.control.shareFramingReference(reference);
    tablet.control.shareFramingVerdict('differs');
    await flushSideLink();
    expect(heard).toEqual([
      { kind: 'reference', reference },
      { kind: 'verdict', verdict: 'differs' },
    ]);
  });

  it('shares nothing over a connection whose device has not proved itself (D-4)', async () => {
    const { port, network } = setUp();
    const tablet = await offer(port);
    const phone = await answer(port, tablet.offerCode);
    // Connected, and the tablet's channel open — but the phone's secret never
    // arrives, so whoever is at the other end is not yet the phone.
    network.drop();
    await tablet.acceptSidePhoneCode(phone.answerCode);
    await flushSideLink();
    const control = network.peers[0]?.channels.find((c) => c.label === CONTROL_CHANNEL);
    expect(control?.readyState).toBe('open');
    tablet.control.shareFramingReference({
      aspect: 1,
      landmarks: [{ name: 'hip', x: 0.5, y: 0.5 }],
    });
    tablet.control.shareFramingVerdict('matches');
    // The tablet's opening ping (#568) carries nothing, and is all it sent.
    expect(control?.sent).toEqual(['{"t":"ping"}']);
  });

  it('hands every picture to the analysis the pairing port was given, and ends it with the pairing', async () => {
    const network = sidePeerNetwork();
    const time = virtualTime();
    const looked: Uint8Array[] = [];
    let closed = 0;
    const port = sidePairingPort({
      peer: network.peer,
      randomBytes: (length) => SECRET.slice(0, length),
      ...time,
      analyse: (control) =>
        new SideAnalysis({
          control,
          estimator: () => ({
            estimateSidePose: async (picture) => {
              looked.push(picture);
              return Promise.resolve({ kind: 'no-rider', cause: 'said-nobody' });
            },
            closeSidePoseModel: () => {
              closed += 1;
            },
          }),
        }),
    });
    const tablet = await offer(port);
    const phone = await answer(port, tablet.offerCode);
    await tablet.acceptSidePhoneCode(phone.answerCode);
    await flushSideLink();
    phone.link.sendPictureToTablet(PICTURE);
    await flushSideLink();
    expect(looked.map((bytes) => bytes.length)).toEqual([PICTURE.bytes.length]);
    expect(tablet.analysis?.sideAnalysisState()).toMatchObject({ noRider: 1, finished: false });
    tablet.control.endSidePairing();
    await flushSideLink();
    expect(tablet.analysis?.sideAnalysisState().finished).toBe(true);
    expect(closed).toBe(1);
  });

  it('has no analysis where the port was given none', async () => {
    const { tablet } = await paired();
    expect(tablet.analysis).toBeUndefined();
  });
});
