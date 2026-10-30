// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Which hosted service the rider's own key on their instance is for** —
 * [#1106](https://github.com/openzigs/onyourleft/issues/1106), read from
 * `GET /v1/analysis/hosted` (#1199), sealed.
 *
 * The side camera's hosted consent has to NAME the service a picture would be
 * sent on to (the owner's ruling 3), and this app ships no list of services
 * and no vendor's name (ADR 0031 D-4). So the name is the host of the URL the
 * rider stored their key with, read back from their instance — never the key,
 * which the instance does not send (`apps/instance` §`hosted-settings.ts`).
 *
 * ⚠️ **No picture module is reachable from here**, and
 * `camera/no-picture-reachable.test.ts` holds it: this module calls an
 * instance, and the one module that may put a picture in an instance's
 * request is `camera/instance-pose.ts`.
 *
 * It goes through a sealed session (`instance-port.ts` §`heldSealedSession`),
 * so it names no network primitive and sends nothing when there is none.
 */

import type { HeldSealedSession } from './instance-port';
import { InstanceUnreachableError } from './instance-transport';

/**
 * Which hosted service the rider's own key on their instance is for.
 *
 * Declared here and not beside its one reader (`camera/side-instance-port.ts`):
 * no module in `instance/` imports from the camera, or names a picture in its
 * code (`instance-transport.test.ts` §"no camera type can reach the instance
 * module") — which is why nothing below is named for what the camera does
 * with the answer.
 */
export type HostedKeyService =
  /** A key of the rider's own is held, for the service at `origin` — named to the rider as `host`. */
  | { readonly kind: 'held'; readonly origin: string; readonly host: string }
  /** The rider holds no key of their own there. */
  | { readonly kind: 'none' }
  /** The instance could not be asked, with the sentence to show. */
  | { readonly kind: 'unavailable'; readonly text: string };

/** The instance's own route for a rider's hosted key and consent (#1199). */
export const HOSTED_SETTINGS_PATH = '/v1/analysis/hosted';

/** Said when the instance did not answer, or answered something this cannot read. */
export const HOSTED_SERVICE_UNREADABLE =
  'Your instance did not say which service your key is for. Nothing was changed, and nothing was sent on.';

/** Said by an instance from before a rider could store a key of their own. */
export const HOSTED_SERVICE_NOT_OFFERED =
  'Your instance does not hold riders’ own keys, so there is no hosted service for it to use.';

/**
 * The `https:` origin and host of a stored key's URL, or `undefined` for
 * anything else — an instance is untrusted input here, and a name shown in a
 * consent must be one a picture could really be sent to.
 */
function serviceOf(url: unknown): { readonly origin: string; readonly host: string } | undefined {
  if (typeof url !== 'string') return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === ''
      ? { origin: parsed.origin, host: parsed.host }
      : undefined;
  } catch {
    return undefined;
  }
}

/** Ask the signed-in instance which service the rider's own key is for. Sends one sealed request. */
export function hostedKeyServiceReader(
  session: () => Promise<HeldSealedSession>,
): () => Promise<HostedKeyService> {
  return async () => {
    let held: HeldSealedSession;
    try {
      held = await session();
    } catch {
      return { kind: 'unavailable', text: HOSTED_SERVICE_UNREADABLE };
    }
    if (held.kind !== 'open') return { kind: 'unavailable', text: held.text };
    let answer: { readonly status: number; readonly body: unknown };
    try {
      answer = await held.sealed.call('GET', HOSTED_SETTINGS_PATH, { token: held.token });
    } catch (error) {
      if (!(error instanceof InstanceUnreachableError)) throw error;
      return { kind: 'unavailable', text: HOSTED_SERVICE_UNREADABLE };
    }
    if (answer.status === 404 || answer.status === 503) {
      return { kind: 'unavailable', text: HOSTED_SERVICE_NOT_OFFERED };
    }
    const body = answer.body as { key?: unknown } | null;
    if (answer.status !== 200 || body === null || typeof body !== 'object' || !('key' in body)) {
      return { kind: 'unavailable', text: HOSTED_SERVICE_UNREADABLE };
    }
    if (body.key === null) return { kind: 'none' };
    const service = serviceOf((body.key as { url?: unknown } | null)?.url);
    return service === undefined
      ? { kind: 'unavailable', text: HOSTED_SERVICE_UNREADABLE }
      : { kind: 'held', ...service };
  };
}
