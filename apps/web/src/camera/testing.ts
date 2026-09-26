// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A scripted camera, for the tests that cannot have a real one.
 *
 * jsdom implements no `getUserMedia`, no media playback and no 2D canvas
 * context, so every state this feature has — a granted camera, a refused one, a
 * device that has none, a track that ends by itself — is reachable only through
 * a double. That is not a limitation of the tests: it is the reason
 * `camera-port.ts` is a port at all, and it is the same relationship
 * `packages/sensors/web-bluetooth/testing` has to a real adapter.
 *
 * ⚠️ **What a double cannot say is whether a real camera behaves like this**,
 * and the one thing that matters most — the re-encode from raw pixels that
 * ADR 0029 D-9 rests on — is measured in a real Chromium instead:
 * `browser/shell.browser.spec.ts` §"the camera, in a real engine". A fake that
 * returned bytes the test author chose would be proving nothing about a JPEG
 * the browser actually wrote.
 */

import type {
  CameraAvailability,
  CameraPermission,
  CameraPort,
  CameraProblemKind,
  CameraSession,
  CapturedFrame,
  CodePixels,
  LuminanceGrid,
} from './camera-port';
import { CameraCaptureError } from './camera-port';
import type {
  PhoneReport,
  SideCameraLinkPort,
  SideLinkCondition,
  SideLinkEvent,
  SidePictureSent,
} from './side-camera-link-port';
import { capturedFrame } from './frame';
import type { SidePicture } from './side-link-pictures';
import { sidePeerParametersFrom, type SidePeerParameters } from './side-link-sdp';
import type { SideChannel, SideDescription, SidePeer } from './side-link-transport';
import { cameraProblemMessage } from './notice';

/** What the scripted camera should do. Every member has a usable default. */
export interface ScriptedCameraOptions {
  readonly availability?: CameraAvailability['kind'];
  readonly permission?: CameraPermission['kind'];
  /** Thrown from `startCamera()`. */
  readonly startFails?: CameraProblemKind;
  /** Thrown from `captureFrame()`. */
  readonly captureFails?: CameraProblemKind;
  /** The bytes a capture yields. Clean by default; see {@link cleanFrameBytes}. */
  readonly bytes?: Uint8Array;
  /**
   * What each presence sample returns, in turn — #390. A function so a test
   * can change the room mid-ride; the default is one fixed, readable grid,
   * which reads as "nothing moved".
   */
  readonly luminance?: (sample: number) => LuminanceGrid;
  /** Thrown from `sampleLuminance()`. */
  readonly sampleFails?: CameraProblemKind;
  /** What each pairing-code read returns, in turn — #529. Default: a blank picture. */
  readonly codePixels?: ((read: number) => CodePixels) | undefined;
}

/** What a scripted camera recorded about how it was used. */
export interface ScriptedCamera {
  readonly port: CameraPort;
  /** Every method call, in order, so a test can assert one never happened. */
  readonly calls: string[];
  /** The live session, if one was started. */
  session(): CameraSession | undefined;
  /** Ends the track from outside, as an operating system or another app would. */
  endTheTrack(): void;
}

/**
 * Bytes shaped like a re-encoded JPEG: a JFIF header and no metadata.
 *
 * ⚠️ Not random noise, because `frame.ts` scans the first few kilobytes for
 * signatures and random bytes would produce a flaky refusal roughly one run in
 * some millions. A fixed, structured buffer has no such tail.
 */
export function cleanFrameBytes(length = 1024): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00], 0);
  for (let index = 32; index < length; index += 1) {
    bytes[index] = (index * 37) % 251;
  }
  // A JPEG's end-of-image marker, so the side link's picture decoder
  // (`side-link-pictures.ts` §`sidePictureFrom`, #530) reads it as whole.
  bytes.set([0xff, 0xd9], length - 2);
  return bytes;
}

/** A {@link CameraPort} that does what it is told and records what it was asked. */
export function scriptedCamera(options: ScriptedCameraOptions = {}): ScriptedCamera {
  const calls: string[] = [];
  let live = false;
  let session: CameraSession | undefined;
  let samples = 0;
  let codeReads = 0;

  const port: CameraPort = {
    cameraAvailability: async () => {
      calls.push('availability');
      return Promise.resolve({ kind: options.availability ?? 'available' });
    },
    requestCameraAccess: async () => {
      calls.push('request');
      return Promise.resolve({ kind: options.permission ?? 'granted' });
    },
    startCamera: async () => {
      calls.push('start');
      if (options.startFails !== undefined) {
        throw new CameraCaptureError(options.startFails, cameraProblemMessage(options.startFails));
      }
      live = true;
      session = {
        get live(): boolean {
          return live;
        },
        captureFrame: async (): Promise<CapturedFrame> => {
          calls.push('capture');
          if (options.captureFails !== undefined) {
            throw new CameraCaptureError(
              options.captureFails,
              cameraProblemMessage(options.captureFails),
            );
          }
          return Promise.resolve(
            capturedFrame({
              bytes: options.bytes ?? cleanFrameBytes(),
              mediaType: 'image/jpeg',
              width: 640,
              height: 480,
            }),
          );
        },
        sampleLuminance: async (): Promise<LuminanceGrid> => {
          calls.push('sample');
          if (options.sampleFails !== undefined) {
            throw new CameraCaptureError(
              options.sampleFails,
              cameraProblemMessage(options.sampleFails),
            );
          }
          const index = samples;
          samples += 1;
          return Promise.resolve((options.luminance ?? (() => stillRoom()))(index));
        },
        captureSideFrame: async (): Promise<CapturedFrame> => {
          calls.push('side-frame');
          if (options.captureFails !== undefined) {
            throw new CameraCaptureError(
              options.captureFails,
              cameraProblemMessage(options.captureFails),
            );
          }
          return Promise.resolve(
            capturedFrame({
              bytes: options.bytes ?? cleanFrameBytes(),
              mediaType: 'image/jpeg',
              width: 256,
              height: 144,
            }),
          );
        },
        readCodePixels: async (): Promise<CodePixels> => {
          calls.push('code');
          const index = codeReads;
          codeReads += 1;
          return Promise.resolve(
            options.codePixels?.(index) ?? {
              width: 4,
              height: 4,
              rgba: new Uint8ClampedArray(64).fill(255),
            },
          );
        },
        attachCameraPreview: () => {
          calls.push('preview');
          return () => {
            calls.push('preview-detached');
          };
        },
        stopCamera: () => {
          calls.push('stop');
          live = false;
        },
      };
      return Promise.resolve(session);
    },
  };

  return {
    port,
    calls,
    session: () => session,
    endTheTrack: () => {
      live = false;
    },
  };
}

/**
 * A readable room in which nothing moves: a left-to-right ramp of brightness,
 * well inside `presence.ts`' dark, bright and flat limits — #390.
 *
 * `shift` moves the whole picture brighter or darker, and `moved` changes that
 * many cells by a large step, which is the smallest fixture that is "a thing
 * moved" rather than "the light changed".
 */
export function stillRoom(
  options: { readonly shift?: number; readonly moved?: number } = {},
): LuminanceGrid {
  const columns = 32;
  const rows = 24;
  const values = new Uint8Array(columns * rows);
  for (let cell = 0; cell < values.length; cell += 1) {
    values[cell] = 60 + (cell % columns) * 4 + (options.shift ?? 0);
  }
  for (let cell = 0; cell < (options.moved ?? 0); cell += 1) {
    values[cell * 7] = (values[cell * 7] ?? 0) + 60;
  }
  return { columns, rows, values };
}

/**
 * `modules` — a pairing code, from `side-link-qr.ts` §`pairingCodeModules` —
 * as a camera would see a screen showing them: `scale` pixels a module, the
 * four-module quiet zone, dark `ink` on light `paper` — #529.
 */
export function photographedCode(
  modules: readonly (readonly boolean[])[],
  scale = 4,
  ink = 20,
  paper = 245,
): CodePixels {
  const quiet = 4;
  const size = (modules.length + quiet * 2) * scale;
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dark = modules[Math.floor(y / scale) - quiet]?.[Math.floor(x / scale) - quiet] === true;
      const value = dark ? ink : paper;
      const at = (y * size + x) * 4;
      rgba[at] = value;
      rgba[at + 1] = value;
      rgba[at + 2] = value;
      rgba[at + 3] = 255;
    }
  }
  return { width: size, height: size, rgba };
}

/** A scheduler a test drives by hand. @see CameraControllerOptions.schedule */
export interface ManualSchedule {
  readonly schedule: (tick: () => void, everyMilliseconds: number) => () => void;
  /** Runs every live tick once. */
  fire(): void;
  /** How many schedules are outstanding. */
  readonly running: number;
}

export function manualSchedule(): ManualSchedule {
  const ticks = new Set<() => void>();
  return {
    schedule: (tick) => {
      ticks.add(tick);
      return () => {
        ticks.delete(tick);
      };
    },
    fire: () => {
      for (const tick of [...ticks]) {
        tick();
      }
    },
    get running(): number {
      return ticks.size;
    },
  };
}

/** A clock and two timers a test moves by hand, in milliseconds. */
export function virtualTime(): {
  readonly clock: () => number;
  readonly after: (task: () => void, milliseconds: number) => () => void;
  readonly every: (task: () => void, milliseconds: number) => () => void;
  advance(milliseconds: number): void;
  /** How many timers are still set — a repeating one left running is a leak (#530). */
  active(): number;
} {
  let now = 0;
  interface Timer {
    due: number;
    readonly task: () => void;
    readonly period: number | undefined;
    cancelled: boolean;
  }
  const timers: Timer[] = [];
  const add = (
    task: () => void,
    milliseconds: number,
    period: number | undefined,
  ): (() => void) => {
    const timer: Timer = { due: now + milliseconds, task, period, cancelled: false };
    timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };
  return {
    clock: () => now,
    after: (task, milliseconds) => add(task, milliseconds, undefined),
    every: (task, milliseconds) => add(task, milliseconds, milliseconds),
    active: () => timers.filter((timer) => !timer.cancelled).length,
    advance(milliseconds: number): void {
      const until = now + milliseconds;
      for (;;) {
        const next = timers
          .filter((timer) => !timer.cancelled && timer.due <= until)
          .sort((a, b) => a.due - b.due)[0];
        if (next === undefined) {
          break;
        }
        now = next.due;
        if (next.period === undefined) {
          next.cancelled = true;
        } else {
          next.due += next.period;
        }
        next.task();
      }
      now = until;
    },
  };
}

/** A link the test drives, recording what the phone told the tablet. */
export function scriptedLink(initial: SideLinkCondition = 'connected'): SideCameraLinkPort & {
  readonly reports: PhoneReport[];
  /** Every picture the phone handed over, whatever the answer (#530). */
  readonly pictures: SidePicture[];
  /** What the next picture is answered with. `sent` by default. */
  answer: SidePictureSent;
  ended: number;
  emit(event: SideLinkEvent): void;
} {
  const listeners = new Set<(event: SideLinkEvent) => void>();
  let condition = initial;
  const link = {
    reports: [] as PhoneReport[],
    pictures: [] as SidePicture[],
    answer: 'sent' as SidePictureSent,
    sendPictureToTablet: (picture: SidePicture): SidePictureSent => {
      link.pictures.push(picture);
      return link.answer;
    },
    ended: 0,
    sideLinkCondition: () => condition,
    onSideLinkEvent: (listener: (event: SideLinkEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reportToTablet: (report: PhoneReport) => {
      link.reports.push(report);
    },
    endSideLink: () => {
      link.ended += 1;
      // #529: a link that has ended says so, which is what the screen reads
      // to refuse it to a new session (`SideCameraView.tsx`). Not emitted:
      // the session that ended it is already stopped and hears nothing.
      condition = 'ended';
    },
    emit: (event: SideLinkEvent) => {
      if (event.kind === 'condition') {
        condition = event.condition;
      }
      for (const listener of [...listeners]) {
        listener(event);
      }
    },
  };
  return link;
}

/** How a {@link sidePeerNetwork} behaves. Every member has a usable default. */
export interface SidePeerNetworkOptions {
  /** The host candidates the `index`th peer gathers. Default: one private IPv4 address each. */
  readonly addresses?: ((index: number) => readonly string[]) | undefined;
  /** Whether gathering ever completes. Default `true`. */
  readonly gathers?: boolean | undefined;
  /** Whether two peers with each other's descriptions connect. Default `true`. */
  readonly connects?: boolean | undefined;
  /**
   * What each connected peer's `sctp.maxMessageSize` says. Default 262 144,
   * which is Chromium's (#530).
   */
  readonly maxMessageSize?: number | undefined;
  /**
   * Whether a message the ANSWERING end sends from inside its `ondatachannel`
   * handler is lost, with no error and the channel still `open` — what
   * Chromium did to the phone's first message about one pairing in a hundred
   * in CI (#568). It is still recorded in `sent`, because the sender did send
   * it. Default `false`.
   */
  readonly losesSendsInDataChannelEvent?: boolean | undefined;
}

/** A scripted peer, with what a test needs to see of it. */
export interface ScriptedSidePeer extends SidePeer {
  readonly index: number;
  /** Every channel on this end: the ones it made and the ones it was given. */
  readonly channels: readonly ScriptedSideChannel[];
  readonly closed: boolean;
  /** Move the connection to `state`, firing its change event as the platform would. */
  setConnection(state: string): void;
}

/** A scripted channel. */
export interface ScriptedSideChannel extends SideChannel {
  /** Every string this end sent, in order. */
  readonly sent: readonly string[];
  /** Every binary message this end sent, in order — the side camera's pictures (#530). */
  readonly sentBinary: readonly ArrayBuffer[];
  /** What the channel was made with, on the end that made it. */
  readonly init: { readonly ordered: boolean; readonly maxRetransmits?: number } | undefined;
  /** Set by a test to stand for a stalled link: what `send` would still have queued. */
  bufferedAmount: number;
  /** Deliver `data` to this end as if the other end had sent it — a hostile peer (#530). */
  deliver(data: unknown): void;
}

/**
 * Two (or more) peer connections that find each other in memory — #529.
 *
 * jsdom implements no WebRTC, so this is what `side-link.test.ts` drives the
 * whole pairing through: each peer writes a description in Chromium's shape,
 * and two peers connect when — and only when — each holds a remote description
 * whose ICE credentials and fingerprint are the OTHER's own. So the codes, the
 * SDP rebuilt from them and the single use of an offer are all exercised,
 * rather than a double that connects whatever it is handed.
 *
 * ⚠️ **What it cannot say is whether a real engine connects over what the
 * SDP builder writes.** `browser/sidelink.browser.spec.ts` is where that is
 * measured, in the pinned Chromium.
 *
 * Messages are delivered in a microtask, in order, so a test awaits
 * {@link flushSideLink} before it reads what arrived.
 */
export function sidePeerNetwork(options: SidePeerNetworkOptions = {}): {
  readonly peer: () => ScriptedSidePeer;
  readonly peers: readonly ScriptedSidePeer[];
  /** Stop delivering anything, in either direction, with no event: the link goes quiet. */
  drop(): void;
  /** Deliver again. */
  restore(): void;
  /** Every peer's connection fails, as ICE's own consent checks would end it. */
  fail(): void;
} {
  const peers: FakeSidePeer[] = [];
  const network = {
    dropped: false,
    maxMessageSize: options.maxMessageSize ?? 262_144,
    losesSendsInDataChannelEvent: options.losesSendsInDataChannelEvent ?? false,
    connects: options.connects ?? true,
    gathers: options.gathers ?? true,
    addresses: options.addresses ?? ((index: number) => [`192.168.1.${String(10 + index)}`]),
    tryConnect(): void {
      for (const offerer of peers) {
        for (const answerer of peers) {
          if (offerer === answerer || offerer.twin !== undefined || answerer.twin !== undefined) {
            continue;
          }
          if (
            offerer.local?.type === 'offer' &&
            answerer.local?.type === 'answer' &&
            matches(offerer.remote, answerer) &&
            matches(answerer.remote, offerer)
          ) {
            offerer.twin = answerer;
            answerer.twin = offerer;
            queueMicrotask(() => {
              if (network.connects) {
                connect(offerer, answerer);
              } else {
                offerer.setConnection('failed');
                answerer.setConnection('failed');
              }
            });
          }
        }
      }
    },
  };
  return {
    peer: () => {
      const created = new FakeSidePeer(peers.length, network);
      peers.push(created);
      return created;
    },
    peers,
    drop: () => {
      network.dropped = true;
    },
    restore: () => {
      network.dropped = false;
    },
    fail: () => {
      for (const peer of peers) {
        peer.setConnection('failed');
        for (const channel of peer.channels) {
          channel.shut();
        }
      }
    },
  };
}

/** Let every queued delivery happen. */
export async function flushSideLink(): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    await Promise.resolve();
  }
}

interface FakeNetwork {
  readonly dropped: boolean;
  readonly maxMessageSize: number;
  readonly losesSendsInDataChannelEvent: boolean;
  readonly gathers: boolean;
  readonly addresses: (index: number) => readonly string[];
  tryConnect(): void;
}

function matches(remote: SidePeerParameters | undefined, peer: FakeSidePeer): boolean {
  return (
    remote !== undefined &&
    remote.ufrag === peer.ufrag &&
    remote.password === peer.password &&
    remote.fingerprint.every((byte) => byte === peer.index + 1)
  );
}

function connect(offerer: FakeSidePeer, answerer: FakeSidePeer): void {
  for (const peer of [offerer, answerer]) {
    peer.sctp = { maxMessageSize: peer.network.maxMessageSize };
  }
  offerer.setConnection('connected');
  answerer.setConnection('connected');
  for (const channel of [...offerer.channels]) {
    const twin = new FakeSideChannel(channel.label, channel.network, undefined);
    twin.twin = channel;
    channel.twin = twin;
    twin.readyState = 'open';
    answerer.channels.push(twin);
    twin.handedOver = offerer.network.losesSendsInDataChannelEvent;
    answerer.ondatachannel?.({ channel: twin });
    twin.handedOver = false;
    channel.readyState = 'open';
    channel.onopen?.();
  }
}

class FakeSideChannel implements ScriptedSideChannel {
  readonly label: string;
  readonly network: FakeNetwork;
  readonly init: { readonly ordered: boolean; readonly maxRetransmits?: number } | undefined;
  readonly sent: string[] = [];
  readonly sentBinary: ArrayBuffer[] = [];
  bufferedAmount = 0;
  binaryType = 'blob';
  readyState = 'connecting';
  twin: FakeSideChannel | undefined;
  /** Inside the answerer's `ondatachannel`, where a send may be lost (#568). */
  handedOver = false;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;

  constructor(
    label: string,
    network: FakeNetwork,
    init: { readonly ordered: boolean; readonly maxRetransmits?: number } | undefined,
  ) {
    this.label = label;
    this.network = network;
    this.init = init;
  }

  send(data: string | ArrayBuffer): void {
    if (this.readyState !== 'open') {
      throw new Error('InvalidStateError');
    }
    // A real channel refuses a message over the connection's limit rather
    // than truncating it; so does this one, so a sender that did not check
    // the size fails here as it would on a device.
    const size = typeof data === 'string' ? data.length : data.byteLength;
    if (size > this.network.maxMessageSize) {
      throw new TypeError('OperationError: message too large');
    }
    // What arrives is a copy, as it is off a real network: the sender's
    // buffer is not the receiver's.
    const delivered = typeof data === 'string' ? data : data.slice(0);
    if (typeof data === 'string') {
      this.sent.push(data);
    } else {
      this.sentBinary.push(data.slice(0));
    }
    const twin = this.twin;
    if (this.network.dropped || twin === undefined || this.handedOver) {
      return;
    }
    queueMicrotask(() => {
      if (twin.readyState === 'open' && !this.network.dropped) {
        twin.onmessage?.({ data: delivered });
      }
    });
  }

  deliver(data: unknown): void {
    queueMicrotask(() => {
      if (this.readyState === 'open') {
        this.onmessage?.({ data });
      }
    });
  }

  /**
   * A GRACEFUL close, as a real channel's is: what was already sent is
   * delivered first, then both ends close. ⚠️ **A peer connection's own
   * `close()` is not graceful** — {@link FakeSidePeer.close} shuts at once and
   * drops anything in flight, as the real one does — which is the difference
   * `side-link.ts` §`letGo` exists for.
   */
  close(): void {
    if (this.readyState === 'closing' || this.readyState === 'closed') {
      return;
    }
    this.readyState = 'closing';
    queueMicrotask(() => {
      this.shut();
    });
  }

  /** Closes both ends at once, each hearing its own `close`. */
  shut(): void {
    for (const end of [this, this.twin]) {
      if (end === undefined || end.readyState === 'closed') {
        continue;
      }
      end.readyState = 'closed';
      queueMicrotask(() => {
        end.onclose?.();
      });
    }
  }
}

class FakeSidePeer implements ScriptedSidePeer {
  readonly index: number;
  readonly network: FakeNetwork;
  readonly channels: FakeSideChannel[] = [];
  readonly ufrag: string;
  readonly password: string;
  local: SideDescription | undefined;
  remote: SidePeerParameters | undefined;
  twin: FakeSidePeer | undefined;
  closed = false;
  sctp: { readonly maxMessageSize: number } | null = null;
  iceGatheringState = 'new';
  connectionState = 'new';
  onicegatheringstatechange: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((event: { readonly channel: SideChannel }) => void) | null = null;

  constructor(index: number, network: FakeNetwork) {
    this.index = index;
    this.network = network;
    this.ufrag = `uf${String(index)}AB`;
    this.password = `pw${String(index)}`.padEnd(24, 'x');
  }

  get localDescription(): SideDescription | null {
    return this.local ?? null;
  }

  createDataChannel(
    label: string,
    init: { readonly ordered: boolean; readonly maxRetransmits?: number },
  ): SideChannel {
    const channel = new FakeSideChannel(label, this.network, init);
    this.channels.push(channel);
    return channel;
  }

  async createOffer(): Promise<SideDescription> {
    return Promise.resolve({ type: 'offer', sdp: this.#sdp('actpass') });
  }

  async createAnswer(): Promise<SideDescription> {
    return Promise.resolve({ type: 'answer', sdp: this.#sdp('active') });
  }

  async setLocalDescription(description: SideDescription): Promise<void> {
    this.local = description;
    if (this.network.gathers) {
      queueMicrotask(() => {
        this.iceGatheringState = 'complete';
        this.onicegatheringstatechange?.();
      });
    } else {
      this.iceGatheringState = 'gathering';
    }
    this.network.tryConnect();
    return Promise.resolve();
  }

  async setRemoteDescription(description: SideDescription): Promise<void> {
    if (this.closed) {
      throw new Error('InvalidStateError');
    }
    this.remote = sidePeerParametersFrom(description.sdp);
    this.network.tryConnect();
    return Promise.resolve();
  }

  setConnection(state: string): void {
    if (this.closed || this.connectionState === state) {
      return;
    }
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }

  close(): void {
    // A real peer connection fires no state change on its own `close()`.
    this.closed = true;
    this.connectionState = 'closed';
    for (const channel of this.channels) {
      channel.shut();
    }
  }

  #sdp(setup: string): string {
    const fingerprint = Array.from({ length: 32 }, () =>
      (this.index + 1).toString(16).toUpperCase().padStart(2, '0'),
    ).join(':');
    return [
      'v=0',
      'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'a=group:BUNDLE 0',
      'a=extmap-allow-mixed',
      'a=msid-semantic: WMS',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 0.0.0.0',
      ...this.network
        .addresses(this.index)
        .map(
          (address, candidate) =>
            `a=candidate:${String(candidate + 100)} 1 udp 2113937151 ${address} ${String(50_000 + this.index)} typ host generation 0 network-cost 999`,
        ),
      `a=ice-ufrag:${this.ufrag}`,
      `a=ice-pwd:${this.password}`,
      'a=ice-options:trickle',
      `a=fingerprint:sha-256 ${fingerprint}`,
      `a=setup:${setup}`,
      'a=mid:0',
      'a=sctp-port:5000',
      'a=max-message-size:262144',
      '',
    ].join('\r\n');
  }
}
