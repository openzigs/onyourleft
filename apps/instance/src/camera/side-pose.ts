// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **One side-camera picture, shown to a model the rider chose, and
 * forgotten** — #1106, ADR 0050.
 *
 * The owner's ruling (#1092 ruling 1, 2026-10-04) moves the side camera's
 * *"pose on your computer"* path to the rider's instance; the ruling of
 * 2026-10-12 on #1106 says how. Each point is held here or in the route:
 *
 * 1. **Sealed, or refused.** `routes.ts` answers `sealed_required` to any
 *    request that did not arrive inside `POST /v1/sealed` — on EVERY
 *    instance, one with no keys included, which seals nothing and so takes
 *    no picture at all. Cloudflare terminates TLS on the tunnel; the seal is
 *    what keeps a photograph of a rider from being readable there.
 * 2. **Never stored.** This module is handed no store and no log, and
 *    imports neither. A picture is the argument of {@link SidePose.look}:
 *    decoded, checked, shown to one model and dropped with the call. There is
 *    no job, no queue and no row. A refusal is a code and a fixed sentence,
 *    and a model server's own error text never leaves `analysis/model.ts`.
 * 3. **Which model.** `instance-local` is the model on the box the operator
 *    named for pictures, at a local address. `instance-hosted` is a hosted
 *    service on the rider's OWN key (`analysis/hosted-key.ts`
 *    §`ownHostedKeyState`) — never the operator's, never another rider's —
 *    and only when the request's `endpoint`, which is the origin the rider's
 *    own picture consent on their device names, is the origin that key goes
 *    to. A key moved to another service is therefore refused until the rider
 *    has read and agreed to a sentence naming the new one.
 * 4. **A model that takes no picture is refused, saying so**:
 *    `model_without_pictures`.
 * 5. **Stripped first.** The device strips a picture at capture; `picture.ts`
 *    refuses one that still carries location or device metadata.
 *
 * ⚠️ **The consent is the device's, sent with every picture.** It is not a
 * row here, unlike the write-up's hosted consent (`athlete_hosted_consent`,
 * ADR 0046 Q10): the request is sealed to this instance and signed by the
 * rider's device key, so nobody on the way can assert it for them, and a
 * consent the instance stored would be one more thing about a rider kept on
 * a server. It is a different consent from the write-up's: that row is never
 * read here.
 *
 * ⚠️ **One picture an athlete at a time.** A second while one is with the
 * model is `rate_limited`, unread: a queue of photographs in memory is
 * refused (ADR 0033 D-6).
 *
 * ⚠️ **What comes back is a model's words, unread** (`route-kit.ts` §`SidePoseAnswer`).
 * They are attacker-influenceable through the picture, so the device reads
 * them as numbers or nothing (`apps/web/src/camera/computer-pose.ts`
 * §`sidePoseFromAnswer`). Here they are bounded in length and passed on.
 */

import { hostedOriginOf, type HostedKeyState } from '../analysis/hosted-key.ts';
import type { OpenedHostedKey } from '../analysis/source.ts';
import type { ErrorCode, FieldProblem } from '../errors.ts';
import type { SidePose, SidePoseOutcome } from '../route-kit.ts';
import { pictureFrom } from './picture.ts';
import type { PictureConnection } from './picture-model.ts';

/**
 * How long the model may take over one picture: 25 s — inside the 30 s the
 * device waits (`apps/web/src/camera/instance-pose.ts`), so the instance
 * answers with a reason before the device gives up without one.
 *
 * ## Provenance — ⚠️ the author's choice, not a measurement
 */
export const SIDE_POSE_MODEL_TIMEOUT_MS = 25_000;

/** The longest answer passed on, in characters. Nine landmarks as JSON are about 300. */
export const MAXIMUM_SIDE_POSE_ANSWER = 4096;

/** The two models a picture may be shown to. The device names one with every picture. */
export const PICTURE_SOURCES = ['instance-local', 'instance-hosted'] as const;
export type PictureSource = (typeof PICTURE_SOURCES)[number];

export interface SidePoseOptions {
  /** The local model for pictures, or `undefined` when the operator named none. */
  readonly local: PictureConnection | undefined;
  /** `athleteId`'s OWN hosted key, opened if it can be. Asked only for `instance-hosted`. */
  readonly hostedKey: (athleteId: string) => Promise<HostedKeyState>;
  /** `hosted-pictures.ts` §`hostedForPictures`: the one builder of a picture's hosted connection. */
  readonly hosted: (key: OpenedHostedKey) => PictureConnection;
}

const FIELDS: readonly string[] = ['picture', 'source', 'endpoint'];

function invalid(...fields: FieldProblem[]): SidePoseOutcome {
  return { ok: false, code: 'validation_failed', fields };
}

export function createSidePose(options: SidePoseOptions): SidePose {
  /** The athletes with a picture at a model now. */
  const looking = new Set<string>();

  async function connectionFor(
    source: PictureSource,
    athleteId: string,
    endpoint: string | undefined,
  ): Promise<PictureConnection | ErrorCode> {
    if (source === 'instance-local') return options.local ?? 'pictures_off';
    const consented = endpoint === undefined ? undefined : hostedOriginOf(endpoint);
    if (consented === undefined) return 'picture_source_unavailable';
    const held = await options.hostedKey(athleteId);
    if (
      held.kind !== 'held' ||
      held.athleteId !== athleteId ||
      hostedOriginOf(held.url) !== consented
    ) {
      return 'picture_source_unavailable';
    }
    return options.hosted(held);
  }

  return {
    async look(caller, body, signal) {
      const unknown = Object.keys(body).filter((field) => !FIELDS.includes(field));
      if (unknown.length > 0) {
        return invalid(
          ...unknown.map((field) => ({ field, problem: 'is not a field of this request' })),
        );
      }
      const { source, endpoint } = body;
      if (source !== 'instance-local' && source !== 'instance-hosted') {
        return invalid({ field: 'source', problem: 'must be instance-local or instance-hosted' });
      }
      // The consent names a service only when a picture goes to one.
      if (source === 'instance-hosted' ? typeof endpoint !== 'string' : endpoint !== undefined) {
        return invalid({
          field: 'endpoint',
          problem:
            source === 'instance-hosted'
              ? 'must be the https: origin your consent names'
              : 'is not a field of an instance-local request',
        });
      }
      if (looking.has(caller.athleteId)) return { ok: false, code: 'rate_limited' };
      const picture = pictureFrom(body.picture);
      if (!picture.ok) return invalid({ field: 'picture', problem: picture.problem });
      looking.add(caller.athleteId);
      try {
        const connection = await connectionFor(
          source,
          caller.athleteId,
          endpoint as string | undefined,
        );
        if (typeof connection === 'string') return { ok: false, code: connection };
        const looked = await connection.look({
          picture: picture.bytes,
          timeoutMilliseconds: SIDE_POSE_MODEL_TIMEOUT_MS,
          signal,
        });
        if (!looked.ok) {
          return {
            ok: false,
            code:
              looked.failure === 'model-without-pictures'
                ? 'model_without_pictures'
                : 'picture_model_failed',
          };
        }
        if (looked.text.length > MAXIMUM_SIDE_POSE_ANSWER) {
          return { ok: false, code: 'picture_model_failed' };
        }
        return { ok: true, value: { answer: looked.text } };
      } finally {
        looking.delete(caller.athleteId);
      }
    },
  };
}
