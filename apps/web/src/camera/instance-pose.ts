// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The side camera's pictures, looked at by a model on the rider's
 * instance** — [#1106](https://github.com/openzigs/onyourleft/issues/1106),
 * [ADR 0046](../../../../docs/adr/0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md)'s
 * amendment of 2026-10-12, and the owner's rulings there.
 *
 * {@link instancePoseEstimator} is a third `SidePoseEstimator`, beside the
 * tablet's own model (`pose-estimator.ts`) and the rider's computer
 * (`computer-pose.ts`). `side-analyser.ts` chooses between them, and only when
 * the rider has switched this on.
 *
 * ## What leaves, and how
 *
 * {@link sidePoseRequest} is the ONE builder of the body: the picture, which
 * model, and — for a hosted model — the origin the rider's consent names. No
 * other key: no id, no time, no pose, no name. It leaves through a
 * {@link SidePictureChannel}, which production fills with
 * `instance/instance-transport.ts` §`sealedInstance` — the one module the
 * client reaches an instance through (#777) — and with NOTHING else: there is
 * no unsealed way to call this route here, and
 * `camera/no-picture-reachable.test.ts` §"a picture reaches an instance by one
 * path" holds that this is the only module that puts a picture in an
 * instance's request. This module names no network primitive.
 *
 * - **Sealed, or not sent** (ruling 1). The channel is a sealed session
 *   (`instance-port.ts` §`heldSealedSession`); when there is none — no
 *   sign-in, a copy of the app loaded from a website (ADR 0047 D-11), keys
 *   that do not verify — nothing is sent and the screen says so.
 * - **Stripped first** (ruling 5, ADR 0029 D-9). A picture that is not a
 *   clean JPEG, one carrying location or device metadata included, is
 *   `unreadable` and **is not sent** (`frame.ts` §`capturedFrame`).
 * - **One at a time, and no faster than one a second**
 *   ({@link INSTANCE_POSE_INTERVAL_MILLISECONDS}).
 *
 * ## Two consents, both off until the rider turns them on
 *
 * - {@link SIDE_INSTANCE_CONSENT}: pictures of the rider leave the room for
 *   their instance. Its own switch, its own stored answer.
 * - {@link sideInstanceHostedConsent}: the instance sends them on to a hosted
 *   service — **named** — on the rider's own key. A second switch on top of
 *   the first, stored as the ORIGIN it named, and sent with every picture, so
 *   a key later moved to another service is refused by the instance until the
 *   rider has read a sentence naming the new one. It is not the write-up's
 *   hosted consent (#1104), which says nothing about a photograph.
 *
 * ## The answer is untrusted input (ADR 0029 D-8)
 *
 * A model's words, attacker-influenceable through the picture. They are read
 * by `computer-pose.ts` §`sidePoseFromAnswer` — numbers inside the picture
 * that could be a person on a bicycle, or nothing — and reach nothing else.
 */

import type { UntrustedText } from '@onyourleft/analysis';

import { INSTANCE_AGREEMENT_STORAGE_KEYS, type HeldSealedSession } from '../instance/instance-port';
import type { EndpointStorage } from './analysis-endpoint';
import { deviceEndpointStorage } from './analysis-endpoint';
import { jpegDimensions, sidePoseFromAnswer } from './computer-pose';
import { capturedFrame, FRAME_MEDIA_TYPE } from './frame';
import type {
  SidePoseEstimator,
  SidePoseOutcome,
  SideUnavailableReason,
} from './side-analysis-port';

/** The instance's one picture route (`apps/instance` §`camera/routes.ts`). */
export const SIDE_POSE_PATH = '/v1/camera/side-pose';

/**
 * How long one picture may wait for the instance's answer: thirty seconds —
 * past the 25 s the instance gives its model, so the instance's own reason
 * arrives before this gives up without one.
 *
 * ## Provenance — ⚠️ the author's choice, not a measurement
 */
export const INSTANCE_POSE_DEADLINE_MILLISECONDS = 30_000;

/**
 * The least time between two pictures sent: one second.
 *
 * ## Provenance — measured, spike 0025
 *
 * An instance allows one session 120 sealed requests a minute, and every
 * sealed request of the app counts: sync, a write-up's stream, a room's
 * ticket. Offered a picture every 200 ms with a model that answered at once,
 * a loopback instance refused 180 of 450 `rate_limited` in ninety seconds
 * ([spike 0025](../../../../docs/spikes/0025-side-camera-pictures-through-the-instance.md)).
 * One a second is half that allowance, and a model on a box at home is slower
 * than that anyway.
 */
export const INSTANCE_POSE_INTERVAL_MILLISECONDS = 1_000;

/**
 * How many pictures in a row may fail — no answer, a model that failed, a
 * refusal for being too many — before nothing more is sent this session:
 * three.
 *
 * ## Provenance — ⚠️ the author's choice, not a measurement
 *
 * The first picture also waits for the model to load, so one failure is not a
 * dead instance; any answer about a picture resets the count.
 */
export const MAXIMUM_CONSECUTIVE_INSTANCE_FAILURES = 3;

/** Which model the instance is asked to use, and for a hosted one the origin the rider agreed to. */
export type InstancePictureChoice =
  | { readonly source: 'instance-local' }
  | { readonly source: 'instance-hosted'; readonly endpoint: string };

/**
 * The key the instance switch lives under: the ORIGIN of the instance the
 * rider agreed to send pictures to, or absent.
 *
 * ⚠️ **An origin, not `on`.** *"Your instance"* in the consent is one
 * instance. A device that later signs in to another — the project's, say,
 * after the rider's own — holds no agreement for it: the switch reads off
 * there until the rider ticks it beside the sentence again.
 * `instance-port.ts` §`instanceEraser` removes both keys with the sign-in on
 * *Erase this device*.
 */
export const SIDE_INSTANCE_STORAGE_KEY = INSTANCE_AGREEMENT_STORAGE_KEYS[0];

/** The key the hosted consent lives under: the origin of the SERVICE it named, or absent. */
export const SIDE_INSTANCE_HOSTED_STORAGE_KEY = INSTANCE_AGREEMENT_STORAGE_KEYS[1];

/**
 * What the section says before any switch — what is sent, where, sealed, and
 * not kept. Never tucked (`views/CameraView.tsx` §`CAMERA_AGREED_KEPT_VISIBLE`).
 *
 * ⚠️ **DRAFT, for the owner's approval before merge** (#1106's ruling: *"wording
 * approved by the owner before merge"*). So are the two consents below.
 */
export const SIDE_INSTANCE_WHAT_IS_SENT =
  'Your instance can look at the side camera’s pictures instead of this tablet. Nothing is sent ' +
  'until you switch it on here. Each picture is then sealed on this tablet so that only your ' +
  'instance can open it, sent to your instance, looked at by a model there, and not kept there: ' +
  'not in its database, not in a file and not in its logs. If the sealed connection is not ' +
  'available, no picture is sent.';

/** The consent beside the first switch, verbatim. DRAFT: see {@link SIDE_INSTANCE_WHAT_IS_SENT}. */
export const SIDE_INSTANCE_CONSENT =
  'While the side camera is filming, pictures of you leave this room, about one a second, and go ' +
  'to your instance instead of being looked at on this tablet. They are sealed before they ' +
  'leave, so nobody between this tablet and your instance can see them, including the tunnel ' +
  'service a home instance is reached through. That service can still see that something is ' +
  'being sent, how often and roughly how large. Your instance shows each picture to the model ' +
  'its operator set up on that machine, and does not keep it. That is a promise about the ' +
  'software this project publishes: whoever runs your instance controls that machine.';

/**
 * The host a hosted service is named by in its consent: the host of the URL
 * the rider's own key was stored with. ⚠️ The app ships no list of vendors and
 * no vendor's name (ADR 0031 D-4), so the name a rider reads is the one they
 * typed. `undefined` for anything that is not an `https:` origin.
 */
export function hostedServiceHost(origin: string): string | undefined {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.origin === origin ? url.host : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The consent beside the second switch, naming the service by `host`.
 * DRAFT: see {@link SIDE_INSTANCE_WHAT_IS_SENT}.
 *
 * The owner's ruling 3: it *"names the vendor and says that pictures of the
 * rider go to that company and that what it keeps is under its terms"*, and
 * *"'never stored' is a promise about the instance only, and the wording must
 * not imply more"*.
 */
export function sideInstanceHostedConsent(host: string): readonly string[] {
  return [
    `This sends pictures of you to ${host}.`,
    `If you turn this on, your instance sends each side-camera picture on to ${host}, the ` +
      'service your own key is for, using your key. That is a company that is not you and not ' +
      'us. What it does with your pictures, and how long it keeps them, is under its terms and ' +
      'not ours. We cannot see that, and we cannot delete them for you afterwards.',
    `“Not kept” is a promise about your instance only. It says nothing about ${host}.`,
    'Your instance sends the picture and one fixed question, and nothing else: not your name, ' +
      'not your rides, not where you were.',
    'You do not need this. This tablet can look at the pictures itself, and so can the model ' +
      'on your instance. This is off, and it stays off until you turn it on.',
  ];
}

/**
 * What the rider has switched on FOR `instanceOrigin` — the instance this
 * device is signed in to now — or `undefined` for off: which is every device
 * until they do, a device signed in to nothing, and a device signed in to
 * another instance than the one they agreed to.
 */
export function readSideInstanceChoice(
  instanceOrigin: string | undefined,
  storage: EndpointStorage | undefined = deviceEndpointStorage(),
): InstancePictureChoice | undefined {
  try {
    if (
      instanceOrigin === undefined ||
      instanceOrigin === '' ||
      storage?.getItem(SIDE_INSTANCE_STORAGE_KEY) !== instanceOrigin
    ) {
      return undefined;
    }
    const origin = storage.getItem(SIDE_INSTANCE_HOSTED_STORAGE_KEY);
    return origin !== null && hostedServiceHost(origin) !== undefined
      ? { source: 'instance-hosted', endpoint: origin }
      : { source: 'instance-local' };
  } catch {
    return undefined;
  }
}

/**
 * Stores the first switch, ON for the instance at `instanceOrigin`, or — with
 * `undefined` — off. Switching off REMOVES it and the hosted consent with it:
 * a consent to send pictures on must not outlive the switch it sits under.
 * Switching on for an instance also drops a hosted consent given under
 * another. `false` when this device would not keep the answer, which leaves
 * it off.
 */
export function writeSideInstanceSwitch(
  instanceOrigin: string | undefined,
  storage: EndpointStorage | undefined = deviceEndpointStorage(),
): boolean {
  if (storage === undefined || instanceOrigin === '') {
    return false;
  }
  try {
    if (instanceOrigin !== undefined) {
      if (storage.getItem(SIDE_INSTANCE_STORAGE_KEY) !== instanceOrigin) {
        storage.removeItem(SIDE_INSTANCE_HOSTED_STORAGE_KEY);
      }
      storage.setItem(SIDE_INSTANCE_STORAGE_KEY, instanceOrigin);
    } else {
      storage.removeItem(SIDE_INSTANCE_STORAGE_KEY);
      storage.removeItem(SIDE_INSTANCE_HOSTED_STORAGE_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Stores the hosted consent as the origin of the service it named, or removes
 * it. Refused — `false`, and nothing stored — for anything that is not an
 * `https:` origin, and while the first switch is off.
 */
export function writeSideInstanceHostedConsent(
  origin: string | undefined,
  storage: EndpointStorage | undefined = deviceEndpointStorage(),
): boolean {
  if (storage === undefined) {
    return false;
  }
  try {
    if (origin === undefined) {
      storage.removeItem(SIDE_INSTANCE_HOSTED_STORAGE_KEY);
      return true;
    }
    if (
      hostedServiceHost(origin) === undefined ||
      storage.getItem(SIDE_INSTANCE_STORAGE_KEY) === null
    ) {
      return false;
    }
    storage.setItem(SIDE_INSTANCE_HOSTED_STORAGE_KEY, origin);
    return true;
  } catch {
    return false;
  }
}

/** A request's body: exactly these keys (`apps/instance` §`camera/side-pose.ts`). */
export interface SidePoseRequest {
  /** The JPEG, standard base64. */
  readonly picture: string;
  readonly source: InstancePictureChoice['source'];
  /** The origin the rider's hosted consent names — only with `instance-hosted`. */
  readonly endpoint?: string;
}

function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

/**
 * The ONE builder of a picture request — see the file comment. A new key is a
 * change here, and the instance refuses any key it does not name.
 */
export function sidePoseRequest(
  picture: Uint8Array,
  choice: InstancePictureChoice,
): SidePoseRequest {
  return {
    picture: base64Of(picture),
    source: choice.source,
    ...(choice.source === 'instance-hosted' ? { endpoint: choice.endpoint } : {}),
  };
}

/** What a picture's call goes through: a SEALED instance, and nothing else, in production. */
export interface SidePictureChannel {
  call(
    method: 'POST',
    path: string,
    options: {
      readonly body: Readonly<Record<string, unknown>>;
      readonly token: string;
      readonly timeoutMilliseconds: number;
    },
  ): Promise<{ readonly status: number; readonly body: unknown }>;
}

/** The sealed session pictures go through, or none — and then none is sent. */
export type SidePictureSession =
  | { readonly kind: 'open'; readonly channel: SidePictureChannel; readonly token: string }
  | { readonly kind: 'closed' };

/**
 * The sealed session this device holds (`instance-port.ts`
 * §`heldSealedSession`) as pictures go through it — or none, for no sign-in,
 * a copy of the app loaded from a website (ADR 0047 D-11) or keys that do not
 * verify. There is no other way to make an open session: an unsealed call is
 * not something this module can be handed.
 */
export function sidePictureSessionOf(held: HeldSealedSession): SidePictureSession {
  return held.kind === 'open'
    ? { kind: 'open', channel: held.sealed, token: held.token }
    : { kind: 'closed' };
}

/** Timers the estimator uses, so a test can move time by hand. */
export interface InstancePoseTimers {
  /** Milliseconds, from any fixed start. */
  readonly now: () => number;
  /** Resolves `milliseconds` from now. */
  readonly wait: (milliseconds: number) => Promise<void>;
}

const realTimers: InstancePoseTimers = {
  now: () => performance.now(),
  wait: (milliseconds) =>
    new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    }),
};

/**
 * The instance's refusals after which nothing more is sent this session, and
 * what the screen then says. Everything else is one picture's, and the next
 * is tried — up to {@link MAXIMUM_CONSECUTIVE_INSTANCE_FAILURES} in a row.
 */
const REFUSALS_THAT_STOP: Readonly<Record<string, SideUnavailableReason>> = {
  pictures_off: 'pictures-off',
  picture_source_unavailable: 'no-hosted-service',
  model_without_pictures: 'model-without-pictures',
  sealed_required: 'not-sealed',
  unauthenticated: 'not-sealed',
  unavailable: 'not-sealed',
  account_suspended: 'not-sealed',
  registration_pending: 'not-sealed',
  // An instance from before this route: it has nothing at that path.
  not_found: 'instance-without-pictures',
};

function codeOf(body: unknown): string | undefined {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * A pose estimator that sends each picture to the rider's instance.
 *
 * ⚠️ **`choice` is asked again for EVERY picture**, after any wait and just
 * before the send. When it answers `undefined` — the rider switched it off —
 * nothing is sent, the picture is `unavailable`, and so is every one after it
 * this session. That is what makes *"switch it off … nothing is sent
 * afterwards"* true of a side camera that is already filming. A change from
 * one model to the other takes effect at the next picture, as the switch says.
 *
 * The session is opened ONCE, at the first picture: opening it reads and
 * checks the instance's keys, which is not a thing to do five times a second.
 *
 * ⚠️ **Closing only stops THIS side waiting.** A picture already sent is still
 * looked at by the instance, and its answer is dropped here unread.
 */
export function instancePoseEstimator(
  input: {
    readonly choice: () => InstancePictureChoice | undefined;
    readonly session: () => Promise<SidePictureSession>;
  },
  timers: InstancePoseTimers = realTimers,
): SidePoseEstimator {
  let stopped: SideUnavailableReason | undefined;
  let closed = false;
  let failuresInARow = 0;
  let session: Promise<SidePictureSession> | undefined;
  let lastSentAt: number | undefined;

  const unavailable = (why: SideUnavailableReason): SidePoseOutcome => {
    stopped ??= why;
    return { kind: 'unavailable', why: stopped };
  };
  const failed = (): SidePoseOutcome => {
    failuresInARow += 1;
    return failuresInARow >= MAXIMUM_CONSECUTIVE_INSTANCE_FAILURES
      ? unavailable('not-answering')
      : { kind: 'unreadable' };
  };

  return {
    async estimateSidePose(picture: Uint8Array): Promise<SidePoseOutcome> {
      if (stopped !== undefined || closed) {
        return { kind: 'unavailable', why: stopped ?? 'switched-off' };
      }
      const size = jpegDimensions(picture);
      if (size === undefined) {
        return { kind: 'unreadable' };
      }
      try {
        capturedFrame({ bytes: picture, mediaType: FRAME_MEDIA_TYPE, ...size });
      } catch {
        // Not a clean JPEG — metadata included. Never sent.
        return { kind: 'unreadable' };
      }
      if (lastSentAt !== undefined) {
        const early = lastSentAt + INSTANCE_POSE_INTERVAL_MILLISECONDS - timers.now();
        if (early > 0) {
          await timers.wait(early);
        }
      }
      // Read now, after the wait: a switch turned off meanwhile stops THIS picture.
      const choice = closed ? undefined : input.choice();
      if (choice === undefined) {
        return unavailable('switched-off');
      }
      session ??= input.session();
      let open: SidePictureSession;
      try {
        open = await session;
      } catch {
        open = { kind: 'closed' };
      }
      if (open.kind !== 'open') {
        return unavailable('not-sealed');
      }
      lastSentAt = timers.now();
      let answer: { readonly status: number; readonly body: unknown };
      try {
        answer = await open.channel.call('POST', SIDE_POSE_PATH, {
          body: { ...sidePoseRequest(picture, choice) },
          token: open.token,
          timeoutMilliseconds: INSTANCE_POSE_DEADLINE_MILLISECONDS,
        });
      } catch {
        // No answer in time, or none at all: one picture's, counted.
        return closed ? { kind: 'unavailable', why: 'switched-off' } : failed();
      }
      if (closed) {
        return { kind: 'unavailable', why: 'switched-off' };
      }
      if (answer.status !== 200) {
        const stop = REFUSALS_THAT_STOP[codeOf(answer.body) ?? ''];
        return stop === undefined ? failed() : unavailable(stop);
      }
      const said = (answer.body as { answer?: unknown } | null)?.answer;
      if (typeof said !== 'string') {
        return failed();
      }
      failuresInARow = 0;
      return sidePoseFromAnswer(said as UntrustedText, size.width / size.height);
    },
    closeSidePoseModel(): void {
      closed = true;
    },
  };
}
