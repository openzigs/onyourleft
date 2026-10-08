// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The side camera's pictures, looked at by the rider's own computer instead
 * of this tablet** — [#553](https://github.com/openzigs/onyourleft/issues/553),
 * [ADR 0033](../../../../docs/adr/0033-side-camera-link.md) D-11.
 *
 * {@link computerPoseEstimator} is a second `SidePoseEstimator`, beside
 * `pose-estimator.ts`' worker. `side-analysis.ts` cannot tell them apart and
 * does not need to: both take one picture and answer a `SidePoseOutcome`.
 * `side-analyser.ts` is what chooses between them, and only when the rider has
 * switched this on.
 *
 * ## What the computer is asked, and what it must answer
 *
 * ⚠️ **Decided by #553's implementation, not by the owner, and recorded as
 * such in ADR 0033's 2026-09-26 amendment.** The owner's ruling on #553 settled
 * the transport; the question it left open was what the computer is asked. The
 * answer taken is the narrowest one that needs no second protocol:
 *
 * - **the same request #387 sends** — the same OpenAI-compatible path, the same
 *   body shape, through `analysis-transport.ts` and nowhere else — with a fixed
 *   question, `analysis-port.ts` §`ANALYSIS_PROMPTS` `side-pose`, that asks for
 *   the near side's nine landmarks as JSON;
 * - **an answer shape this repository owns**, read by {@link sidePoseFromAnswer}
 *   and nothing else. A pose server of the rider's own can answer it directly;
 *   a general vision model can be asked to.
 *
 * ⚠️ **Whether a general vision model answers it WELL is not measured**, and
 * the issue said so first: *"a general vision model asked for coordinates as
 * JSON is an unmeasured claim"*. That is why this is a switch the rider turns
 * on, off by default, and why the tablet's own model stays the default.
 *
 * ## The answer is untrusted input (ADR 0029 D-8)
 *
 * A vision model's words are attacker-influenceable through the picture. So
 * the answer becomes numbers or nothing: it is parsed as JSON, every key is
 * one this file names — an unknown key is **refused rather than ignored**
 * (ADR 0017 D-4's rule) — every coordinate is a finite number inside the
 * picture, and anything else is `unreadable`. What survives is a
 * `SidePoseOutcome`, the same type the tablet's model produces, which reaches
 * `side-analysis.ts` and the post-ride report's arithmetic and nothing else: no
 * trainer, no URL, no path, no screen. `analysis-safety.test.ts` holds this
 * module to that alongside the rest of the camera's analysis.
 *
 * ## Visibility
 *
 * A vision model reports no visibility. A point it gave is recorded as seen
 * (`1`) and a point it answered `null` is left out, so `pose-landmarks.ts`'
 * rule — fewer than `framing.ts` §`MINIMUM_SHARED_LANDMARKS` points is nobody
 * — applies unchanged.
 */

import type { AnalysisPort } from './analysis-port';
import type { AnalysisCall, AnalysisFailure, UntrustedText } from '@onyourleft/analysis';
import { capturedFrame, FRAME_MEDIA_TYPE } from './frame';
import { MINIMUM_SHARED_LANDMARKS } from './framing';
import { implausibility } from './pose-plausibility';
import {
  SIDE_POSE_LANDMARKS,
  type SidePoseEstimator,
  type SidePoseLandmark,
  type SidePoseMark,
  type SidePoseOutcome,
} from './side-analysis-port';

/**
 * How long one picture may wait for the computer's answer before it is given
 * up as unreadable: thirty seconds.
 *
 * ## Provenance — ⚠️ the author's choice, not a measurement
 *
 * A small vision model on a laptop takes seconds to tens of seconds over a
 * picture, and the first answer also waits for the model to load. Pictures
 * arriving meanwhile are dropped by `side-analysis.ts` (ADR 0033 D-6), so a
 * slow computer means fewer pictures looked at, not a queue. This bound only
 * stops one lost answer holding the analysis for the rest of the session.
 */
export const COMPUTER_POSE_DEADLINE_MILLISECONDS = 30_000;

/**
 * How many pictures in a row may run out {@link COMPUTER_POSE_DEADLINE_MILLISECONDS}
 * before nothing more is sent this session: two.
 *
 * A deadline is not one of {@link FAILURES_THAT_STOP}: the first answer also
 * waits for the model to load, so one slow picture is not a dead computer. But
 * a computer that NEVER answers inside the deadline was never stopped. Every
 * picture was sent, waited on and given up, for the whole ride. Inside the
 * shell that is worse than it looks. A native request cannot be aborted from
 * here (`analysis-transport.ts` §`nativeAnalysisPort`), so each abandoned
 * picture's upload kept running for up to the plugin's read timeout, with
 * several in flight at once.
 *
 * ## Provenance — ⚠️ the author's choice, not a measurement
 *
 * Two lets a cold model load cost one picture and not the session. Any answer
 * inside the deadline, even a failure, resets the count.
 */
export const MAXIMUM_CONSECUTIVE_DEADLINES = 2;

/**
 * The failures after which nothing more is sent this session: the computer is
 * not there, will not talk to this app, or is not a model server. Every other
 * failure is one picture's, and the next is tried.
 */
const FAILURES_THAT_STOP: ReadonlySet<AnalysisFailure> = new Set<AnalysisFailure>([
  'not-configured',
  'unreachable',
  'refused',
  'not-a-model-server',
  'failed-on-machine',
  'address-not-numeric',
]);

/** Timers the estimator uses, so a test can move time by hand. */
export interface ComputerPoseTimers {
  readonly after: (task: () => void, milliseconds: number) => () => void;
}

const realTimers: ComputerPoseTimers = {
  after: (task, milliseconds) => {
    const handle = setTimeout(task, milliseconds);
    return () => {
      clearTimeout(handle);
    };
  },
};

/**
 * A JPEG's width and height, read from its frame header, or `undefined`.
 *
 * The side picture carries no dimensions of its own, and a pose needs the
 * picture's shape. This walks the marker segments from the start of the file
 * to the first start-of-frame and reads two numbers out of it; it decodes
 * nothing, and stops at the scan.
 */
export function jpegDimensions(
  bytes: Uint8Array,
): { readonly width: number; readonly height: number } | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return undefined;
  }
  let at = 2;
  while (at + 3 < bytes.length) {
    if (bytes[at] !== 0xff) {
      return undefined;
    }
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      // A fill byte before the marker.
      at += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) {
      // The end of the image, or the scan: no frame header came first.
      return undefined;
    }
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    if (length < 2) {
      return undefined;
    }
    const startOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (startOfFrame) {
      if (at + 8 >= bytes.length || length < 7) {
        return undefined;
      }
      const height = ((bytes[at + 5] ?? 0) << 8) | (bytes[at + 6] ?? 0);
      const width = ((bytes[at + 7] ?? 0) << 8) | (bytes[at + 8] ?? 0);
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    at += 2 + length;
  }
  return undefined;
}

const TOP_KEYS_WITH_RIDER: ReadonlySet<string> = new Set(['rider', 'nearSide', 'landmarks']);

/**
 * The fenced JSON a model commonly wraps its answer in, unwrapped — and
 * nothing else about the text changed. Anything that is not exactly one
 * fenced block, or no fence at all, is left as it is and fails to parse.
 */
function unfenced(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isShare(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * What the computer's answer comes to, for a picture of shape `aspect`.
 *
 * - `{"rider":false}` and nothing else is `no-rider`, `said-nobody`.
 * - `{"rider":true,"nearSide":…,"landmarks":{…}}` with exactly those keys,
 *   `nearSide` `left` or `right`, and `landmarks` holding **every one** of
 *   `SIDE_POSE_LANDMARKS` and nothing else, each `null` or `[x, y]` with both
 *   inside the picture, is a pose — or `no-rider`:
 *   - `too-few-points` when fewer than `MINIMUM_SHARED_LANDMARKS` points were
 *     given, or any of `pose-plausibility.ts` §`PLAUSIBILITY_LANDMARKS` is
 *     missing, so the pose cannot be checked;
 *   - `implausible` when the points could not be a person on a bicycle
 *     (`pose-plausibility.ts`, #761).
 * - Everything else is `unreadable`, and nothing of it is kept.
 *
 * ⚠️ **Until #761 a pose passed on shape alone**, and spike 0016 §5.4 found
 * the rider's computer placing whole riders in blank and noise pictures; the
 * plausibility check is what those answers now fail.
 */
export function sidePoseFromAnswer(answer: UntrustedText, aspect: number): SidePoseOutcome {
  const unreadable: SidePoseOutcome = { kind: 'unreadable' };
  if (!Number.isFinite(aspect) || aspect <= 0) {
    return unreadable;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced(answer)) as unknown;
  } catch {
    return unreadable;
  }
  if (!isRecord(parsed)) {
    return unreadable;
  }
  const keys = Object.keys(parsed);
  if (parsed.rider === false) {
    return keys.length === 1 ? { kind: 'no-rider', cause: 'said-nobody' } : unreadable;
  }
  // Every key one this file names. The three it needs are each checked below.
  if (parsed.rider !== true || !keys.every((key) => TOP_KEYS_WITH_RIDER.has(key))) {
    return unreadable;
  }
  const { nearSide, landmarks } = parsed;
  if ((nearSide !== 'left' && nearSide !== 'right') || !isRecord(landmarks)) {
    return unreadable;
  }
  const given = Object.keys(landmarks);
  const known: ReadonlySet<string> = new Set<string>(SIDE_POSE_LANDMARKS);
  // No name it does not know. A name it does know and did not get is refused
  // in the loop below, which reads every one.
  if (!given.every((name) => known.has(name))) {
    return unreadable;
  }
  const marks: SidePoseMark[] = [];
  for (const name of SIDE_POSE_LANDMARKS) {
    const point = landmarks[name];
    if (point === null) {
      continue;
    }
    if (!Array.isArray(point) || point.length !== 2) {
      return unreadable;
    }
    const [x, y] = point as unknown[];
    if (!isShare(x) || !isShare(y)) {
      return unreadable;
    }
    marks.push({ name: name satisfies SidePoseLandmark, x, y, visibility: 1 });
  }
  if (marks.length < MINIMUM_SHARED_LANDMARKS) {
    return { kind: 'no-rider', cause: 'too-few-points' };
  }
  const pose = { aspect, nearSide, landmarks: marks } as const;
  switch (implausibility(pose)) {
    case undefined:
      return { kind: 'pose', pose };
    case 'missing-landmark':
      return { kind: 'no-rider', cause: 'too-few-points' };
    default:
      return { kind: 'no-rider', cause: 'implausible' };
  }
}

/**
 * A pose estimator that sends each picture to the rider's computer through
 * the port `computer` answers — `analysis-transport.ts` §`riderAnalysisPort`,
 * the one way a picture leaves this tablet.
 *
 * ⚠️ **`computer` is asked again for EVERY picture**, the way #387's button
 * looks the endpoint up on every press. When it answers `undefined` — the
 * rider switched either switch off, or forgot the computer — nothing is sent,
 * the picture is `unavailable`, and so is every one after it this session.
 * That is what makes the policy's *"switch it off … nothing is sent
 * afterwards"* true of a side camera that is already filming.
 *
 * One picture at a time, as `side-analysis.ts` already asks. A picture that is
 * not a clean JPEG — one carrying location or device metadata included, which
 * `frame.ts` §`capturedFrame` refuses — is `unreadable` and **is not sent**.
 * After a failure in {@link FAILURES_THAT_STOP} every later picture is
 * `unavailable` without being sent, so an absent computer is not asked five
 * times a second for the rest of the ride.
 */
export function computerPoseEstimator(
  computer: () => AnalysisPort | undefined,
  timers: ComputerPoseTimers = realTimers,
): SidePoseEstimator {
  let dead = false;
  let deadlinesInARow = 0;
  let inFlight: AnalysisCall | undefined;
  return {
    async estimateSidePose(picture: Uint8Array): Promise<SidePoseOutcome> {
      if (dead) {
        return { kind: 'unavailable' };
      }
      const size = jpegDimensions(picture);
      if (size === undefined) {
        return { kind: 'unreadable' };
      }
      let frame;
      try {
        frame = capturedFrame({ bytes: picture, mediaType: FRAME_MEDIA_TYPE, ...size });
      } catch {
        return { kind: 'unreadable' };
      }
      const port = computer();
      if (port === undefined) {
        dead = true;
        return { kind: 'unavailable' };
      }
      const call = port.askAboutFrame({ frame, question: 'side-pose' });
      inFlight = call;
      let timedOut = false;
      // ⚠️ Cancelling only stops THIS side waiting. Through `fetch` the
      // request is aborted; through the shell's native request it is not, and
      // the picture is still sent and its answer discarded
      // (`analysis-transport.ts` §`nativeAnalysisPort`). That is why a run of
      // deadlines stops the session: see `MAXIMUM_CONSECUTIVE_DEADLINES`.
      const stopDeadline = timers.after(() => {
        timedOut = true;
        call.cancel();
      }, COMPUTER_POSE_DEADLINE_MILLISECONDS);
      const outcome = await call.outcome;
      stopDeadline();
      if (inFlight === call) {
        inFlight = undefined;
      }
      if (timedOut) {
        deadlinesInARow += 1;
        if (deadlinesInARow >= MAXIMUM_CONSECUTIVE_DEADLINES) {
          dead = true;
          return { kind: 'unavailable' };
        }
        return dead ? { kind: 'unavailable' } : { kind: 'unreadable' };
      }
      deadlinesInARow = 0;
      if (outcome.kind === 'failed') {
        if (FAILURES_THAT_STOP.has(outcome.failure)) {
          dead = true;
          return { kind: 'unavailable' };
        }
        return dead ? { kind: 'unavailable' } : { kind: 'unreadable' };
      }
      return sidePoseFromAnswer(outcome.description, size.width / size.height);
    },
    closeSidePoseModel(): void {
      dead = true;
      inFlight?.cancel();
      inFlight = undefined;
    },
  };
}
