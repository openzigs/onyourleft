// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Which model a job runs on** — #1097, ADR 0046 D-9's two sources.
 *
 * A job names its source, and the source is the DEVICE's consent, per job
 * (#1102, #1104): nothing here falls from one source to the other.
 *
 * - `instance-local` — the model on the rider's own box (`model.ts`
 *   §`createLocalModel`), or `local_unavailable` when none is configured.
 * - `instance-hosted` — the hosted service the instance holds a key for
 *   (`hosted-key.ts`), and ONLY when the job asks for it. With no key held, a
 *   key this secret cannot open, or no masking, it fails `hosted_unavailable`
 *   and nothing is sent.
 *
 * ⚠️ **No hosted request without masking.** Everything a hosted model is sent
 * is masked first (#1101), so the hosted connection is built ONLY by
 * {@link SourceOptions.behindMasking} — the seam #1101 supplies. Until it
 * lands nothing supplies it, and `instance-hosted` fails `hosted_unavailable`
 * whatever key is held (`source.test.ts`). Its caller is the job engine
 * (#1095), which is not built yet either.
 */

import type { HostedKeyState } from './hosted-key.ts';
import type { ModelConnection } from './model-turn.ts';

/** The two sources a job may name. */
export type AnalysisSource = 'instance-local' | 'instance-hosted';

/** Why a job's source could not be used. Closed, and naming no host, model or key. */
export type SourceFailure = 'local_unavailable' | 'hosted_unavailable';

/** The held key, opened: what {@link SourceOptions.behindMasking} is handed. */
export type OpenedHostedKey = Extract<HostedKeyState, { readonly kind: 'held' }>;

export interface SourceOptions {
  /** The local model, or `undefined` when the instance has none configured. */
  readonly local: ModelConnection | undefined;
  /** The held key, opened with the instance's secret if it can be (`hosted-key.ts`). */
  readonly hostedKey: () => Promise<HostedKeyState>;
  /**
   * Builds the hosted connection behind #1101's masking. `undefined` on this
   * tree, so `instance-hosted` fails `hosted_unavailable`.
   */
  readonly behindMasking?: (key: OpenedHostedKey) => ModelConnection;
}

/** The model for a job's source, or why there is none. */
export async function modelForSource(
  source: AnalysisSource,
  options: SourceOptions,
): Promise<
  | { readonly ok: true; readonly model: ModelConnection }
  | { readonly ok: false; readonly failure: SourceFailure }
> {
  if (source === 'instance-local') {
    return options.local === undefined
      ? { ok: false, failure: 'local_unavailable' }
      : { ok: true, model: options.local };
  }
  const held = await options.hostedKey();
  if (held.kind !== 'held' || options.behindMasking === undefined) {
    return { ok: false, failure: 'hosted_unavailable' };
  }
  return { ok: true, model: options.behindMasking(held) };
}
