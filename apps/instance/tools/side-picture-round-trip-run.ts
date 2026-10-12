// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The side-camera picture measurement's device (#1106) —
 * `side-picture-round-trip.ts` is the command. Exported apart from it so
 * `side-picture-round-trip.test.ts` can run the same code against an instance
 * on this machine whose model is scripted.
 *
 * A throwaway device signs in (`replan-round-trip-run.ts` §`signedInDevice`)
 * and offers `POST /v1/camera/side-pose` a picture every `intervalMs` — 200 ms
 * is the side camera's five a second (ADR 0033 D-3) — the way the tablet
 * does: **one at a time**. A picture that falls due while the last is still
 * with the instance is `skipped`, unsent, as `side-analysis.ts` drops it. What
 * is written down is what the criterion asks for: how many of the pictures
 * offered were looked at, how long each took, and how many bytes each cost on
 * the wire in each direction.
 *
 * ⚠️ **No picture here is of anybody.** {@link syntheticPicture} is a JPEG's
 * opening segment and filler of the size asked for. A sealed envelope is
 * padded to a bucket (ADR 0047 D-9), so its size on the wire depends on the
 * picture's size and not on what is in it; a model's time over a real picture
 * is NOT measured by this and is whatever the instance's model takes.
 *
 * ⚠️ **"Sealed" here is less than the app's**, for `replan-round-trip-run.ts`'s
 * reason: this pins nothing and seals to whatever key the URL serves.
 */

import { signedInDevice, summarise, type Device, type Summary } from './replan-round-trip-run.ts';

/** The route measured (`src/camera/routes.ts` §`SIDE_POSE_PATH`). */
const SIDE_POSE_PATH = '/v1/camera/side-pose';

/**
 * How many pictures with a rider in them the tablet's framing check waits for
 * (`apps/web/src/camera/side-analysis.ts` §`FRAMING_CHECK_POSES`): the one
 * figure the side analysis NEEDS, and the reason a rate matters at all.
 */
export const FRAMING_CHECK_PICTURES = 10;

/**
 * A picture of `bytes` bytes that `src/camera/picture.ts` takes: a JFIF
 * opening, filler, and an end-of-image marker. `variant` changes the filler so
 * no two are the same bytes.
 */
export function syntheticPicture(bytes: number, variant: number): Uint8Array {
  const opening = [
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00,
  ];
  const picture = new Uint8Array(Math.max(bytes, opening.length + 2));
  picture.set(opening);
  for (let index = opening.length; index < picture.length - 2; index += 1) {
    // Never 0xff: filler must not read as a marker.
    picture[index] = (index * 31 + variant * 17) % 0xff;
  }
  picture[picture.length - 2] = 0xff;
  picture[picture.length - 1] = 0xd9;
  return picture;
}

export interface PictureMeasureOptions {
  /** Where the instance is reached. */
  readonly url: string;
  /** The origin the instance states (`OYL_INSTANCE_ORIGIN`); the URL's own unless given. */
  readonly origin?: string;
  /** How many pictures are offered. */
  readonly pictures: number;
  /** How often one is offered: 200 ms is five a second. */
  readonly intervalMs: number;
  /** Each picture's size in bytes, at most 64 KiB. */
  readonly pictureBytes: number;
  /** Which model the instance is asked to use. `instance-hosted` needs `endpoint`. */
  readonly source: 'instance-local' | 'instance-hosted';
  /** The origin a hosted picture consent names, for `instance-hosted`. */
  readonly endpoint?: string;
  readonly log?: (line: string) => void;
  /** The clock and the wait, for a test that moves time by hand. */
  readonly now?: () => number;
  readonly wait?: (milliseconds: number) => Promise<void>;
}

export interface PictureMeasureReport {
  readonly startedAt: string;
  readonly url: string;
  readonly source: string;
  readonly pictureBytes: number;
  readonly intervalMs: number;
  /** Pictures that fell due. */
  readonly offered: number;
  /** Pictures sent: every one offered while none was with the instance. */
  readonly sent: number;
  /** Pictures the instance answered 200. */
  readonly answered: number;
  /** Pictures that fell due while one was with the instance, and were dropped unsent. */
  readonly skipped: number;
  /** Every other answer, by its error code (or its status). */
  readonly refused: Readonly<Record<string, number>>;
  /** From the first picture offered to the last answer. */
  readonly elapsedMs: number;
  /** Answered pictures a second, over {@link elapsedMs}. */
  readonly answeredPerSecond: number;
  /**
   * From the first picture offered to the tenth answered: how long the
   * framing check waits when every answered picture has a rider in it.
   * `null` when fewer than ten were answered.
   */
  readonly framingCheckMs: number | null;
  /** Over the answered pictures. */
  readonly summary: {
    /** Sent to answer opened, sealing and opening included. */
    readonly roundTripMs: Summary | null;
    readonly sealMs: Summary | null;
    readonly openMs: Summary | null;
    /** The sealed envelope's body, as sent. */
    readonly bytesUp: Summary | null;
    /** The sealed reply's body, as received. */
    readonly bytesDown: Summary | null;
  };
  /** Bytes a second in each direction over {@link elapsedMs}, counting every picture sent. */
  readonly bytesPerSecond: { readonly up: number; readonly down: number };
}

function codeOf(body: unknown, status: number): string {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === 'string' ? code : String(status);
}

const round = (value: number): number => Math.round(value * 10) / 10;

/** Offer `device` the pictures and write down what happened. */
export async function measurePicturesWith(
  device: Device,
  options: PictureMeasureOptions,
): Promise<PictureMeasureReport> {
  const now = options.now ?? (() => performance.now());
  const wait =
    options.wait ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const roundTrips: number[] = [];
  const seals: number[] = [];
  const opens: number[] = [];
  const ups: number[] = [];
  const downs: number[] = [];
  const refused: Record<string, number> = {};
  const answeredAt: number[] = [];
  let sent = 0;
  let skipped = 0;
  let totalUp = 0;
  let totalDown = 0;
  let lastAnswerAt = 0;
  let inFlight: Promise<void> | undefined;

  device.takeCrypto();
  device.takeBytes();
  const started = now();
  const startedAt = new Date().toISOString();

  const send = async (index: number): Promise<void> => {
    const picture = Buffer.from(syntheticPicture(options.pictureBytes, index)).toString('base64');
    const before = now();
    const answer = await device.call('POST', SIDE_POSE_PATH, {
      picture,
      source: options.source,
      ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
    });
    const after = now();
    const crypto = device.takeCrypto();
    const bytes = device.takeBytes();
    totalUp += bytes.sent;
    totalDown += bytes.received;
    lastAnswerAt = after - started;
    if (answer.status === 200) {
      roundTrips.push(after - before);
      seals.push(crypto.sealMs);
      opens.push(crypto.openMs);
      ups.push(bytes.sent);
      downs.push(bytes.received);
      answeredAt.push(after - started);
    } else {
      const code = codeOf(answer.body, answer.status);
      refused[code] = (refused[code] ?? 0) + 1;
    }
  };

  for (let index = 0; index < options.pictures; index += 1) {
    // Each picture falls due on the interval's own grid, however long a send took.
    const due = started + index * options.intervalMs;
    const early = due - now();
    if (early > 0) await wait(early);
    if (inFlight !== undefined) {
      skipped += 1;
      continue;
    }
    sent += 1;
    inFlight = send(index).finally(() => {
      inFlight = undefined;
    });
  }
  await inFlight;

  const elapsedMs = Math.max(lastAnswerAt, 1);
  const report: PictureMeasureReport = {
    startedAt,
    url: options.url,
    source: options.source,
    pictureBytes: options.pictureBytes,
    intervalMs: options.intervalMs,
    offered: options.pictures,
    sent,
    answered: roundTrips.length,
    skipped,
    refused,
    elapsedMs: round(elapsedMs),
    answeredPerSecond: Math.round((roundTrips.length / elapsedMs) * 1000 * 100) / 100,
    framingCheckMs:
      answeredAt.length >= FRAMING_CHECK_PICTURES
        ? round(answeredAt[FRAMING_CHECK_PICTURES - 1] ?? 0)
        : null,
    summary: {
      roundTripMs: summarise(roundTrips),
      sealMs: summarise(seals),
      openMs: summarise(opens),
      bytesUp: summarise(ups),
      bytesDown: summarise(downs),
    },
    bytesPerSecond: {
      up: Math.round((totalUp / elapsedMs) * 1000),
      down: Math.round((totalDown / elapsedMs) * 1000),
    },
  };
  options.log?.(
    `${String(report.answered)} of ${String(report.offered)} pictures answered, ${String(report.skipped)} skipped`,
  );
  return report;
}

/** Sign a throwaway device in at `options.url`, sealed, and measure. */
export async function measurePictures(
  options: PictureMeasureOptions,
): Promise<PictureMeasureReport> {
  const origin = options.origin ?? new URL(options.url).origin;
  const device = await signedInDevice(options.url, origin, 'sealed', 'Picture measure');
  return measurePicturesWith(device, options);
}
