// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The side-camera link: two QR codes, one data channel, and what each end
 * does when the other goes quiet** — #529,
 * [ADR 0033](../../../../docs/adr/0033-side-camera-link.md) D-1, D-3, D-4 and
 * D-5.
 *
 * Both ends of one pairing, over {@link SidePeer} — a WebRTC peer connection
 * with no ICE server of any kind (`side-link-transport.ts`) — and a clock.
 *
 * 1. **The tablet offers.** It opens a peer connection, makes the `control`
 *    channel (reliable, ordered: D-3), gathers its host candidates, and shows
 *    an offer code carrying the ICE credentials, its DTLS fingerprint, its
 *    candidates and a fresh 32-byte one-time secret.
 * 2. **The phone answers.** It reads the offer, builds the tablet's
 *    description from the code's checked fields (`side-link-sdp.ts`), answers,
 *    and shows the answer code.
 * 3. **The tablet reads the answer** — once — and the two connect directly.
 * 4. **The phone proves it read the offer**: its first message is the secret.
 *    Anything else first, or a wrong secret, and the tablet ends the pairing
 *    before it reads another byte (D-4).
 *
 * ## Why neither end waits for the connection to say it is gone
 *
 * #529: *"the tablet says so at once"*. A peer connection's own
 * `disconnected` arrives after its consent checks have failed for several
 * seconds, and on a link that simply stops delivering it may take longer. So
 * each end sends a `ping` every {@link HEARTBEAT_MILLISECONDS} and calls the
 * link lost once it has heard NOTHING for {@link SILENCE_IS_LOST_MILLISECONDS}
 * — whichever of that and the connection's own word comes first. The phone's
 * 30 seconds start there (`side-camera.ts`); the tablet shows *link lost*.
 *
 * ## What a command is owed
 *
 * `start` and `stop` are numbered and acknowledged. One that is not
 * acknowledged within {@link COMMAND_ACK_MILLISECONDS} is reported as
 * `unacknowledged` — **never assumed to have arrived**, which is the trainer
 * control point's posture (`CLAUDE.md` §4h) applied to a camera.
 *
 * ## What neither end keeps
 *
 * Nothing (D-4, D-8). The secret, the codes and the connection live in these
 * objects and go with them; nothing here names a store.
 */

import {
  base64Url,
  candidateAccepted,
  PAIRING_SECRET_BYTES,
  pairingCodeText,
  readPairingCode,
  type PairingCode,
  type PairingRefusal,
} from './side-link-code';
import {
  controlMessageText,
  phoneMessageFrom,
  tabletMessageFrom,
  type PhoneCommand,
  type PhoneMessage,
  type TabletMessage,
} from './side-link-messages';
import {
  MAXIMUM_SIDE_PICTURE_MESSAGE_BYTES,
  sidePictureFrom,
  sidePictureMessage,
  type SidePicture,
} from './side-link-pictures';
import { sdpFromSidePeerParameters, sidePeerParametersFrom, SideSdpError } from './side-link-sdp';
import { createSidePeer, type SideChannel, type SidePeer } from './side-link-transport';
import { browserAfter, browserEvery } from './side-camera';
import type { FramingReference, FramingVerdict } from './framing';
import type { SideAnalysisPort } from './side-analysis-port';
import { NO_SCREEN_LOCK, type ScreenLock, type ScreenLockSource } from '../game/hud/wake-lock';
import type {
  PhoneReport,
  SideCameraLinkPort,
  SideCameraStopReason,
  SideLinkCondition,
  SideLinkEvent,
  SidePictureSent,
} from './side-camera-link-port';
import type {
  PhoneSidePairing,
  SideCameraControlPort,
  SideCommandStatus,
  SideControlState,
  SidePairingEnd,
  SidePairingPort,
  SidePhoneState,
  TabletSidePairing,
} from './side-pairing-port';

/** The channel for commands and state: reliable and ordered (ADR 0033 D-3). */
export const CONTROL_CHANNEL = 'control';

/**
 * The channel for pictures, phone → tablet only — #530, ADR 0033 D-3:
 * *"unordered, no retransmission. A late picture is worth nothing to a pose
 * model and would only queue behind newer ones."* The tablet makes it beside
 * `control`, so both are in the one offer the QR code carries.
 */
export const FRAMES_CHANNEL = 'frames';

/**
 * How often each end says it is still there: once a second. Spike 0012 measured
 * this link at 64–72 ms p50 and 136–153 ms p99 round trip between two Android
 * WebViews, so a second is several round trips even at the tail.
 */
export const HEARTBEAT_MILLISECONDS = 1000;

/**
 * How long an end hears nothing before it calls the link lost: three missed
 * heartbeats. Short enough to be *"at once"* to a rider looking at the tablet;
 * long enough that one late heartbeat at spike 0012's p99 is not a false alarm.
 * ⚠️ It starts the phone's 30 seconds, so it is added to them in the worst
 * case: a phone stops at most 33 seconds after the tablet last heard it, and
 * never more than 30 after it last heard the tablet — D-5's clock is the
 * phone's own, and it counts from here.
 */
export const SILENCE_IS_LOST_MILLISECONDS = 3000;

/**
 * How long a command waits for its acknowledgement before the tablet says it
 * was not acknowledged: three seconds, the same silence that calls the whole
 * link lost — a command that has waited that long is on a link the tablet
 * would already be calling lost.
 */
export const COMMAND_ACK_MILLISECONDS = 3000;

/**
 * How long a tablet's offer stays answerable: five minutes. D-4 asks for a
 * bound and its provenance: long enough to walk to the tripod, turn a phone's
 * camera on, agree to its consent screen and scan, which the owner's own runs
 * of spike 0012's procedure took well under a minute; short enough that a
 * code photographed off the tablet is dead before anybody could do much with
 * it. The offer is also void the moment an answer is accepted and when the
 * pairing screen closes (`views/SideCameraControl.tsx` §`Offer`, since #550's
 * review), which are the rules that do the real work; this bound is what is
 * left for a screen left open.
 */
export const OFFER_LIFETIME_MILLISECONDS = 5 * 60 * 1000;

/**
 * How long a device waits, once it has an answer, for the connection to open
 * and the phone to prove itself. Spike 0012 measured 72–158 ms from applying
 * the answer to both channels open; fifteen seconds is two orders of magnitude
 * over that, and far under the offer's own lifetime.
 */
export const CONNECT_LIMIT_MILLISECONDS = 15_000;

/**
 * How long to wait for candidates. D-1: *"Host candidates gather within
 * milliseconds"*; this bounds a platform that never says it has finished, and
 * whatever was gathered by then is what the code carries.
 */
export const GATHER_LIMIT_MILLISECONDS = 5000;

/**
 * How long a deliberate end waits for the channel to close before the
 * connection is torn down regardless: one second, several of spike 0012's p99
 * round trips.
 *
 * ⚠️ **Why there is a wait at all.** A data channel's `close()` is graceful —
 * what was already sent is delivered first — and a peer connection's is not:
 * it drops anything in flight. So the tablet's last `stop`, and the phone's
 * last *stopped, and why*, would be lost to a `close()` on the connection
 * straight after them, and the other end would show *link lost* for a pairing
 * somebody ended on purpose. `side-link.test.ts` §"ending a pairing" is what
 * went red without it.
 */
export const CLOSE_GRACE_MILLISECONDS = 1000;

/**
 * Let a connection go: the channel closes gracefully, and the connection goes
 * once it has — or after {@link CLOSE_GRACE_MILLISECONDS}, whichever is first.
 */
function letGo(peer: SidePeer, channel: SideChannel | undefined, timers: Resolved): void {
  if (channel?.readyState !== 'open') {
    channel?.close();
    peer.close();
    return;
  }
  const cancel = timers.after(() => {
    peer.close();
  }, CLOSE_GRACE_MILLISECONDS);
  channel.onclose = () => {
    cancel();
    peer.close();
  };
  channel.close();
}

/** What the tablet says, per way a pairing ended. Nothing here names a body (ADR 0030). */
export const SIDE_PAIRING_END_TEXT: Readonly<Record<SidePairingEnd, string>> = {
  'ended-here': 'You ended the session on this tablet.',
  'phone-ended': 'The session was ended on the phone.',
  'link-lost':
    'Lost touch with the phone. If it was filming, it stops by itself within 30 seconds.',
  'no-path':
    'The tablet and the phone could not reach each other. Check that both are on the same Wi-Fi, ' +
    'and that the router lets devices on it talk to each other.',
  'names-only':
    'The tablet and the phone could not reach each other. Both hid their network addresses ' +
    'behind names this phone cannot look up. Open the side camera in the On Your Left app on ' +
    'both devices and pair again.',
  'not-our-phone':
    'A device connected without this pairing’s code, so the tablet closed the connection. ' +
    'Pair again.',
  broken: 'The other device sent something this version does not understand, so the pairing ended.',
  'offer-expired': 'The pairing code was not scanned in time. Pair again to show a fresh one.',
};

/** What the tablet says about the phone, per state. */
export const SIDE_PHONE_STATE_TEXT: Readonly<Record<SidePhoneState, string>> = {
  pairing: 'Pairing — waiting for the phone.',
  framing: 'Framing — the phone’s camera is on and it is not filming.',
  filming: 'Filming.',
  stopped: 'Stopped.',
  lost: 'Link lost — the tablet cannot hear the phone.',
};

/** What the tablet says about why the phone stopped. */
export const SIDE_STOP_REASON_TEXT: Readonly<Record<SideCameraStopReason, string>> = {
  rider: 'It was stopped on the phone.',
  tablet: 'It was stopped from this tablet.',
  'link-lost': 'It stopped by itself after losing touch with this tablet for 30 seconds.',
  camera: 'Its camera went off.',
};

/** What the tablet says about a command, per status. */
export function sideCommandText(kind: PhoneCommand, status: SideCommandStatus): string {
  const what = kind === 'start' ? 'start' : 'stop';
  switch (status) {
    case 'waiting':
      return `Sent ${what} to the phone. Waiting for it to confirm.`;
    case 'acknowledged':
      return `The phone confirmed the ${what}.`;
    case 'unacknowledged':
      return (
        `The phone did not confirm the ${what}. It may not have heard it — look at the phone, ` +
        'or press it again.'
      );
  }
}

/** A clock and two timers, as `side-camera.ts` takes them. */
export interface SideLinkTimers {
  readonly clock?: (() => number) | undefined;
  readonly after?: ((task: () => void, milliseconds: number) => () => void) | undefined;
  readonly every?: ((task: () => void, milliseconds: number) => () => void) | undefined;
}

/** How a pairing port is built. Every member but `analyse` has a production default. */
export interface SidePairingOptions extends SideLinkTimers {
  /** A new peer connection, or `undefined` with no WebRTC. */
  readonly peer?: (() => SidePeer | undefined) | undefined;
  /** `length` cryptographically random bytes. */
  readonly randomBytes?: ((length: number) => Uint8Array) | undefined;
  /**
   * What the tablet makes of a pairing's pictures — #530. Called once per
   * offer, with that offer's control; `main.tsx` passes `side-analysis.ts`
   * §`SideAnalysis` over the tablet's pose model. Without it the tablet
   * receives pictures and looks at none of them.
   */
  readonly analyse?: ((control: SideCameraControlPort) => SideAnalysisPort) | undefined;
  /**
   * Where the tablet's screen lock comes from — #557. Taken when an offer is
   * made and given back when that pairing ends, however it ends.
   *
   * ⚠️ **The lock belongs to the PAIRING, not to the Camera screen.** A tablet
   * that slept mid-pairing voided the offer or dropped the link (D-4, #550),
   * twice in the owner's first attempt; and the pairing outlives the screen so
   * the rider can ride (`side-pairing-port.ts` §`currentSideCamera`), so a
   * lock held by the screen would have let go the moment they left it.
   * `main.tsx` passes the browser's own; without one, nothing is held.
   */
  readonly screenLock?: ScreenLockSource | undefined;
}

/** A source that never holds anything: no wake lock was supplied. */
const NO_SCREEN_LOCK_SOURCE: ScreenLockSource = {
  acquire: async () => Promise.resolve(NO_SCREEN_LOCK),
};

interface Resolved {
  readonly peer: () => SidePeer | undefined;
  readonly analyse: ((control: SideCameraControlPort) => SideAnalysisPort) | undefined;
  readonly screenLock: ScreenLockSource;
  readonly randomBytes: (length: number) => Uint8Array;
  readonly clock: () => number;
  readonly after: (task: () => void, milliseconds: number) => () => void;
  readonly every: (task: () => void, milliseconds: number) => () => void;
}

function resolve(options: SidePairingOptions): Resolved {
  return {
    peer: options.peer ?? (() => createSidePeer()),
    analyse: options.analyse,
    screenLock: options.screenLock ?? NO_SCREEN_LOCK_SOURCE,
    randomBytes:
      options.randomBytes ??
      ((length) => globalThis.crypto.getRandomValues(new Uint8Array(length))),
    clock: options.clock ?? Date.now,
    after: options.after ?? browserAfter,
    every: options.every ?? browserEvery,
  };
}

/** The pairing port over WebRTC. `main.tsx` builds one per tab. */
export function sidePairingPort(options: SidePairingOptions = {}): SidePairingPort {
  const resolved = resolve(options);
  let current: TabletSidePairing | undefined;
  return {
    offerSideCamera: async () => {
      current?.control.endSidePairing();
      current = undefined;
      const made = await offerFrom(resolved);
      if (typeof made === 'object') {
        current = made;
      }
      return made;
    },
    currentSideCamera: () => current,
    answerSideCamera: async (offerCode) => answerFrom(offerCode, resolved),
  };
}

/** Wait until `peer` has gathered, or {@link GATHER_LIMIT_MILLISECONDS} has passed. */
async function gathered(peer: SidePeer, timers: Resolved): Promise<void> {
  if (peer.iceGatheringState === 'complete') {
    return;
  }
  await new Promise<void>((done) => {
    const cancel = timers.after(() => {
      peer.onicegatheringstatechange = null;
      done();
    }, GATHER_LIMIT_MILLISECONDS);
    peer.onicegatheringstatechange = () => {
      if (peer.iceGatheringState === 'complete') {
        peer.onicegatheringstatechange = null;
        cancel();
        done();
      }
    };
  });
}

/** This end's fields, once its description is set and its candidates gathered. */
async function localParameters(
  peer: SidePeer,
  timers: Resolved,
): Promise<ReturnType<typeof sidePeerParametersFrom> | undefined> {
  await gathered(peer, timers);
  const sdp = peer.localDescription?.sdp;
  if (sdp === undefined) {
    return undefined;
  }
  try {
    return sidePeerParametersFrom(sdp);
  } catch (error) {
    if (error instanceof SideSdpError) {
      return undefined;
    }
    throw error;
  }
}

/** Whether every candidate a code carries is an mDNS name. */
function namesOnly(code: PairingCode): boolean {
  return code.parameters.candidates.every((candidate) => candidate.address.endsWith('.local'));
}

/** A comparison whose time does not depend on where two equal-length strings first differ. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

async function offerFrom(timers: Resolved): Promise<TabletSidePairing | PairingRefusal> {
  const peer = timers.peer();
  if (peer === undefined) {
    return 'unavailable';
  }
  const channel = peer.createDataChannel(CONTROL_CHANNEL, { ordered: true });
  const frames = peer.createDataChannel(FRAMES_CHANNEL, { ordered: false, maxRetransmits: 0 });
  frames.binaryType = 'arraybuffer';
  try {
    await peer.setLocalDescription(await peer.createOffer());
  } catch {
    peer.close();
    return 'unavailable';
  }
  const parameters = await localParameters(peer, timers);
  if (parameters === undefined) {
    peer.close();
    return 'unavailable';
  }
  const secret = timers.randomBytes(PAIRING_SECRET_BYTES);
  const made = pairingCodeText('offer', parameters, secret);
  if ('refusal' in made) {
    peer.close();
    return made.refusal;
  }
  // Over the candidates the code actually carries, which are the ones the
  // phone was given — not the ones the encoder left out.
  const offerOnlyNames = parameters.candidates
    .filter(candidateAccepted)
    .every((candidate) => candidate.address.endsWith('.local'));
  const control = new TabletSideLink(peer, channel, frames, base64Url(secret), timers);
  return {
    offerCode: made.text,
    acceptSidePhoneCode: async (answerCode) => control.accept(answerCode, offerOnlyNames),
    control,
    analysis: timers.analyse?.(control),
  };
}

/**
 * The tablet's end — {@link SideCameraControlPort}.
 *
 * Exported for its test, which drives it through {@link sidePairingPort} like
 * the screen does; nothing else constructs one.
 */
export class TabletSideLink implements SideCameraControlPort {
  readonly #peer: SidePeer;
  readonly #channel: SideChannel;
  readonly #frames: SideChannel;
  readonly #secret: string;
  readonly #timers: Resolved;
  readonly #listeners = new Set<() => void>();
  readonly #pictureListeners = new Set<(picture: SidePicture) => void>();
  readonly #cancels: (() => void)[] = [];

  /** Whether an answer has been accepted — D-4's single use. */
  #answered = false;
  /** Whether both codes carried only names, for the failure's wording. */
  #namesOnly = false;
  /** Whether the phone has proved it read this offer. */
  #proved = false;
  #phone: Exclude<SidePhoneState, 'lost'> = 'pairing';
  #lost = false;
  #stopReason: SideCameraStopReason | undefined;
  #command: { kind: PhoneCommand; number: number; status: SideCommandStatus } | undefined;
  #cancelAck: (() => void) | undefined;
  #nextCommand = 0;
  #lastHeard = 0;
  #ended: SidePairingEnd | undefined;
  #snapshot: SideControlState;
  /** The screen lock this pairing holds (#557), given back in {@link #end}. */
  readonly #screenLock: Promise<ScreenLock>;

  constructor(
    peer: SidePeer,
    channel: SideChannel,
    frames: SideChannel,
    secret: string,
    timers: Resolved,
  ) {
    this.#peer = peer;
    this.#channel = channel;
    this.#frames = frames;
    this.#secret = secret;
    this.#timers = timers;
    this.#snapshot = this.#build();
    // Not awaited: a platform that is slow to answer, or refuses, must not
    // hold up the offer. `acquire` resolves rather than rejects when it cannot
    // (`wake-lock.ts`), and the catch is for a source that breaks that.
    this.#screenLock = timers.screenLock.acquire().catch(() => NO_SCREEN_LOCK);
    this.#cancels.push(
      timers.after(() => {
        if (!this.#answered) {
          this.#end('offer-expired');
        }
      }, OFFER_LIFETIME_MILLISECONDS),
    );
    channel.onmessage = (event) => {
      this.#hear(event.data);
    };
    frames.onmessage = (event) => {
      this.#hearPicture(event.data);
    };
    channel.onclose = () => {
      this.#end(this.#phone === 'stopped' ? this.#stoppedEnd() : this.#failure());
    };
    peer.onconnectionstatechange = () => {
      const state = peer.connectionState;
      if (state === 'disconnected' && this.#proved) {
        this.#setLost(true);
      } else if (state === 'failed' || state === 'closed') {
        this.#end(this.#failure());
      }
    };
  }

  sideControlState(): SideControlState {
    return this.#snapshot;
  }

  onSideControlChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async accept(answerCode: string, offerOnlyNames: boolean): Promise<PairingRefusal | undefined> {
    if (this.#answered || this.#ended !== undefined) {
      return 'used';
    }
    const read = readPairingCode(answerCode, 'answer');
    if ('refusal' in read) {
      // Not this pairing's answer: the offer stays up and the rider can scan
      // again. A refusal does not use the offer.
      return read.refusal;
    }
    this.#answered = true;
    this.#namesOnly = offerOnlyNames && namesOnly(read.code);
    this.#announce();
    try {
      await this.#peer.setRemoteDescription({
        type: 'answer',
        sdp: sdpFromSidePeerParameters(read.code.parameters),
      });
    } catch {
      this.#end('broken');
      return undefined;
    }
    this.#cancels.push(
      this.#timers.after(() => {
        if (!this.#proved) {
          this.#end(this.#failure());
        }
      }, CONNECT_LIMIT_MILLISECONDS),
    );
    return undefined;
  }

  commandSideCamera(command: PhoneCommand): void {
    if (this.#ended !== undefined || !this.#proved) {
      return;
    }
    const number = this.#nextCommand;
    this.#nextCommand += 1;
    this.#cancelAck?.();
    const sent = this.#send({ t: command, n: number });
    this.#command = { kind: command, number, status: sent ? 'waiting' : 'unacknowledged' };
    if (sent) {
      this.#cancelAck = this.#timers.after(() => {
        if (this.#command?.number === number && this.#command.status === 'waiting') {
          this.#command = { ...this.#command, status: 'unacknowledged' };
          this.#announce();
        }
      }, COMMAND_ACK_MILLISECONDS);
    }
    this.#announce();
  }

  endSidePairing(): void {
    if (this.#ended !== undefined) {
      return;
    }
    // A camera still on is told to stop before the connection goes, so the
    // phone stops now rather than 30 seconds from now. Not waited for: if it
    // does not arrive, the phone's own 30 seconds are the backstop (D-5).
    if (this.#proved && (this.#phone === 'framing' || this.#phone === 'filming')) {
      this.#send({ t: 'stop', n: this.#nextCommand });
      this.#nextCommand += 1;
    }
    this.#end('ended-here');
  }

  onSideCameraPicture(listener: (picture: SidePicture) => void): () => void {
    this.#pictureListeners.add(listener);
    return () => {
      this.#pictureListeners.delete(listener);
    };
  }

  shareFramingReference(reference: FramingReference): void {
    if (this.#ended === undefined && this.#proved) {
      this.#send({ t: 'reference', reference });
    }
  }

  shareFramingVerdict(verdict: FramingVerdict): void {
    if (this.#ended === undefined && this.#proved) {
      this.#send({ t: 'verdict', verdict });
    }
  }

  /**
   * One message on `frames`. D-4 applies to it exactly as to `control`: a
   * picture before the phone has proved itself, or anything that is not a
   * picture, ends the pairing before another byte is read.
   */
  #hearPicture(data: unknown): void {
    if (this.#ended !== undefined) {
      return;
    }
    if (!this.#proved) {
      this.#end('not-our-phone');
      return;
    }
    const picture = sidePictureFrom(data);
    if (picture === undefined) {
      this.#end('broken');
      return;
    }
    this.#heard();
    for (const listener of [...this.#pictureListeners]) {
      listener(picture);
    }
  }

  /**
   * Who ended a pairing the phone closed after saying it had stopped — #557.
   *
   * ⚠️ **The phone's own reason decides it**, because the phone is the one
   * that knows. *Stop filming* on this tablet makes the phone stop with reason
   * `tablet` and then close — one session per pairing (D-4) — and this used to
   * read every close after a stop as `phone-ended`, so the tablet said *"The
   * phone ended the pairing"* while the phone said *"Your tablet ended the
   * session"*: the owner's fifth finding on #557.
   */
  #stoppedEnd(): SidePairingEnd {
    return this.#stopReason === 'tablet' ? 'ended-here' : 'phone-ended';
  }

  /** The failure's reason, by how far the pairing got. */
  #failure(): SidePairingEnd {
    if (this.#proved) {
      return 'link-lost';
    }
    return this.#namesOnly ? 'names-only' : 'no-path';
  }

  #hear(data: unknown): void {
    if (this.#ended !== undefined) {
      return;
    }
    const message = phoneMessageFrom(data);
    if (!this.#proved) {
      // D-4: the secret is the FIRST message. Anything else first — a valid
      // message included — and the connection is closed before another byte
      // of it is read.
      if (message?.t === 'hello' && sameSecret(message.k, this.#secret)) {
        this.#proved = true;
        this.#heard();
        this.#cancels.push(
          this.#timers.every(() => {
            this.#beat();
          }, HEARTBEAT_MILLISECONDS),
        );
        this.#announce();
        return;
      }
      this.#end('not-our-phone');
      return;
    }
    if (message === undefined || message.t === 'hello') {
      this.#end('broken');
      return;
    }
    this.#heard();
    this.#apply(message);
  }

  #apply(message: Exclude<PhoneMessage, { t: 'hello' }>): void {
    switch (message.t) {
      case 'state':
        this.#phone = message.report.state;
        this.#stopReason = message.report.state === 'stopped' ? message.report.reason : undefined;
        this.#announce();
        return;
      case 'ack':
        if (this.#command?.number === message.n) {
          this.#cancelAck?.();
          this.#cancelAck = undefined;
          this.#command = { ...this.#command, status: 'acknowledged' };
          this.#announce();
        }
        return;
      case 'ping':
        return;
    }
  }

  #heard(): void {
    this.#lastHeard = this.#timers.clock();
    this.#setLost(false);
  }

  #beat(): void {
    this.#send({ t: 'ping' });
    if (this.#timers.clock() - this.#lastHeard >= SILENCE_IS_LOST_MILLISECONDS) {
      this.#setLost(true);
    }
  }

  #setLost(lost: boolean): void {
    if (this.#lost !== lost) {
      this.#lost = lost;
      this.#announce();
    }
  }

  /** Send one message. @returns whether the channel took it. Never throws. */
  #send(message: TabletMessage): boolean {
    if (this.#channel.readyState !== 'open') {
      return false;
    }
    try {
      this.#channel.send(controlMessageText(message));
      return true;
    } catch {
      return false;
    }
  }

  #end(reason: SidePairingEnd): void {
    if (this.#ended !== undefined) {
      return;
    }
    this.#ended = reason;
    if (reason === 'link-lost') {
      this.#lost = true;
    }
    this.#cancelAck?.();
    for (const cancel of this.#cancels.splice(0)) {
      cancel();
    }
    this.#channel.onmessage = null;
    this.#channel.onclose = null;
    this.#frames.onmessage = null;
    this.#peer.onconnectionstatechange = null;
    letGo(this.#peer, this.#channel, this.#timers);
    // ⚠️ **Released on EVERY end, and that is the half that matters** (#557,
    // `wake-lock.ts`'s own emphasis): a lock leaked here keeps the tablet
    // awake on a stand until its battery is flat, and nothing about that
    // looks like this feature's fault. Through the promise, so a lock that
    // arrives after the pairing ended is given back as soon as it does.
    void this.#screenLock.then(async (lock) => lock.release()).catch(() => undefined);
    this.#announce();
    // ⚠️ No `#pictureListeners.clear()` here, and one was removed in #555's
    // review: `#hearPicture` returns on `#ended` before it reads a byte, and
    // the handler above is gone too, so a picture after this reaches nobody —
    // whether they subscribed before the end or after it. `side-link.test.ts`
    // §"hands no picture to anybody once the pairing has ended" is the pin,
    // and deleting the `#ended` guard turns it red where the clear could not.
  }

  #build(): SideControlState {
    return {
      phone: this.#lost ? 'lost' : this.#phone,
      answered: this.#answered,
      stopReason: this.#stopReason,
      command:
        this.#command === undefined
          ? undefined
          : { kind: this.#command.kind, status: this.#command.status },
      ended: this.#ended,
    };
  }

  #announce(): void {
    this.#snapshot = this.#build();
    for (const listener of [...this.#listeners]) {
      listener();
    }
  }
}

async function answerFrom(
  offerCode: string,
  timers: Resolved,
): Promise<PhoneSidePairing | PairingRefusal> {
  const read = readPairingCode(offerCode, 'offer');
  if ('refusal' in read) {
    return read.refusal;
  }
  const { code } = read;
  const peer = timers.peer();
  if (peer === undefined) {
    return 'unavailable';
  }
  const link = new PhoneSideLink(peer, base64Url(code.secret), timers);
  try {
    await peer.setRemoteDescription({
      type: 'offer',
      sdp: sdpFromSidePeerParameters(code.parameters),
    });
    await peer.setLocalDescription(await peer.createAnswer());
  } catch {
    link.endSideLink();
    return 'unavailable';
  }
  const parameters = await localParameters(peer, timers);
  if (parameters === undefined) {
    link.endSideLink();
    return 'unavailable';
  }
  const made = pairingCodeText('answer', parameters);
  if ('refusal' in made) {
    link.endSideLink();
    return made.refusal;
  }
  return { answerCode: made.text, link };
}

/**
 * The phone's end — `side-camera-link-port.ts` §`SideCameraLinkPort`.
 *
 * Exported for its test, which drives it through {@link sidePairingPort};
 * nothing else constructs one.
 */
export class PhoneSideLink implements SideCameraLinkPort {
  readonly #peer: SidePeer;
  readonly #secret: string;
  readonly #timers: Resolved;
  readonly #listeners = new Set<(event: SideLinkEvent) => void>();
  readonly #cancels: (() => void)[] = [];

  #channel: SideChannel | undefined;
  /** The `frames` channel, which this phone only ever sends on. */
  #frames: SideChannel | undefined;
  #condition: SideLinkCondition = 'connecting';
  #lastHeard = 0;
  /** The last command number obeyed, so a repeated one is not obeyed twice. */
  #lastCommand = -1;

  constructor(peer: SidePeer, secret: string, timers: Resolved) {
    this.#peer = peer;
    this.#secret = secret;
    this.#timers = timers;
    this.#cancels.push(
      timers.after(() => {
        if (this.#condition === 'connecting') {
          this.endSideLink();
        }
      }, CONNECT_LIMIT_MILLISECONDS),
    );
    peer.ondatachannel = (event) => {
      this.#adopt(event.channel);
    };
    peer.onconnectionstatechange = () => {
      const state = peer.connectionState;
      if (state === 'disconnected' && this.#condition === 'connected') {
        this.#setCondition('lost');
      } else if (state === 'failed' || state === 'closed') {
        this.endSideLink();
      }
    };
  }

  sideLinkCondition(): SideLinkCondition {
    return this.#condition;
  }

  onSideLinkEvent(listener: (event: SideLinkEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  reportToTablet(report: PhoneReport): void {
    this.#send({ t: 'state', report });
  }

  sendPictureToTablet(picture: SidePicture): SidePictureSent {
    const frames = this.#frames;
    if (this.#condition !== 'connected' || frames?.readyState !== 'open') {
      return 'no-link';
    }
    // ⚠️ **One picture in memory, not a queue** — ADR 0033 D-6's rule, on
    // the sending end. Anything still buffered is the last picture not yet
    // handed to the network, and a new one would queue behind it.
    if (frames.bufferedAmount > 0) {
      return 'busy';
    }
    const message = sidePictureMessage(picture, this.#pictureRoom());
    if (message === undefined) {
      return 'too-large';
    }
    try {
      frames.send(message);
      return 'sent';
    } catch {
      return 'no-link';
    }
  }

  /**
   * How long a message this connection will carry — D-3's *"checks the size
   * rather than assuming it"*. The connection's own figure where it states a
   * finite positive one, and {@link MAXIMUM_SIDE_PICTURE_MESSAGE_BYTES}
   * otherwise; `side-link-pictures.ts` §`sidePictureMessage` takes the smaller
   * of that and its own bound.
   */
  #pictureRoom(): number {
    const stated = this.#peer.sctp?.maxMessageSize;
    return typeof stated === 'number' && Number.isFinite(stated) && stated > 0
      ? stated
      : MAXIMUM_SIDE_PICTURE_MESSAGE_BYTES;
  }

  endSideLink(): void {
    if (this.#condition === 'ended') {
      return;
    }
    for (const cancel of this.#cancels.splice(0)) {
      cancel();
    }
    this.#peer.ondatachannel = null;
    this.#peer.onconnectionstatechange = null;
    if (this.#channel !== undefined) {
      this.#channel.onmessage = null;
      this.#channel.onclose = null;
      this.#channel.onopen = null;
    }
    if (this.#frames !== undefined) {
      this.#frames.onmessage = null;
    }
    letGo(this.#peer, this.#channel, this.#timers);
    this.#setCondition('ended');
  }

  #adopt(channel: SideChannel): void {
    // Two channels, each named, each once (D-3). A third, a second of either,
    // or one by another name is not something D-3 lists, and the pairing ends
    // (D-4). They may arrive in either order.
    if (channel.label === FRAMES_CHANNEL && this.#frames === undefined) {
      this.#frames = channel;
      channel.binaryType = 'arraybuffer';
      // Phone → tablet only: the tablet never sends a picture, or anything
      // else, on `frames`, so anything that arrives on it is not the tablet.
      channel.onmessage = () => {
        this.endSideLink();
      };
      return;
    }
    if (this.#channel !== undefined || channel.label !== CONTROL_CHANNEL) {
      channel.close();
      this.endSideLink();
      return;
    }
    this.#channel = channel;
    const opened = (): void => {
      // D-4: the secret first, before anything else this phone says.
      this.#send({ t: 'hello', k: this.#secret });
      this.#heard();
      this.#cancels.push(
        this.#timers.every(() => {
          this.#beat();
        }, HEARTBEAT_MILLISECONDS),
      );
    };
    channel.onmessage = (event) => {
      this.#hear(event.data);
    };
    channel.onclose = () => {
      this.endSideLink();
    };
    if (channel.readyState === 'open') {
      opened();
    } else {
      channel.onopen = opened;
    }
  }

  #hear(data: unknown): void {
    if (this.#condition === 'ended') {
      return;
    }
    const message = tabletMessageFrom(data);
    if (message === undefined) {
      this.endSideLink();
      return;
    }
    this.#heard();
    switch (message.t) {
      case 'start':
      case 'stop':
        // Acknowledged whether or not it is obeyed: the ack says it ARRIVED,
        // and the phone's state report says what it did about it.
        this.#send({ t: 'ack', n: message.n });
        if (message.n > this.#lastCommand) {
          this.#lastCommand = message.n;
          this.#emit({ kind: message.t });
        }
        return;
      case 'reference':
        this.#emit({ kind: 'reference', reference: message.reference });
        return;
      case 'verdict':
        this.#emit({ kind: 'verdict', verdict: message.verdict });
        return;
      case 'ping':
        return;
    }
  }

  #heard(): void {
    this.#lastHeard = this.#timers.clock();
    if (this.#condition !== 'connected') {
      this.#setCondition('connected');
    }
  }

  #beat(): void {
    this.#send({ t: 'ping' });
    if (
      this.#condition === 'connected' &&
      this.#timers.clock() - this.#lastHeard >= SILENCE_IS_LOST_MILLISECONDS
    ) {
      this.#setCondition('lost');
    }
  }

  #setCondition(condition: SideLinkCondition): void {
    if (this.#condition === 'ended' || this.#condition === condition) {
      return;
    }
    this.#condition = condition;
    this.#emit({ kind: 'condition', condition });
  }

  /** Never throws: on a lost link there is nobody to tell (the port's rule). */
  #send(message: PhoneMessage): void {
    const channel = this.#channel;
    if (channel?.readyState !== 'open') {
      return;
    }
    try {
      channel.send(controlMessageText(message));
    } catch {
      // Nothing to do: the heartbeat is what notices a link that has gone.
    }
  }

  #emit(event: SideLinkEvent): void {
    for (const listener of [...this.#listeners]) {
      listener(event);
    }
  }
}
