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
 *   (`hosted-key.ts`), and ONLY when the job asks for it. With no recorded
 *   consent naming the endpoint, no key held, a key this secret cannot open,
 *   or no masking guard that can be read, it fails `hosted_unavailable` and
 *   nothing is sent.
 *
 * ⚠️ **No hosted job without the athlete's own recorded consent — the
 * operator's included.** ADR 0046 D-9 §"A rider's own consent", point 1:
 * *"A hosted job runs only for an athlete whose own hosted consent is
 * recorded on the instance … A job without it is refused, before a key is
 * read."* Only the Ollama source is exempt (point 4). The operator is an
 * athlete, so their own jobs need it too. The check is
 * {@link SourceOptions.recordedConsent} — the store's `athlete_hosted_consent`
 * row on a running instance (#1199) — asked BEFORE
 * {@link SourceOptions.hostedKey}, and it must name the ORIGIN the key goes
 * to. Both sides are read through `hosted-key.ts` §`hostedOriginOf`, so a
 * consent stored as a full URL or with a trailing slash still matches.
 *
 * ⚠️ **A hosted job runs on the athlete's OWN key and nobody else's.** The
 * owner's ruling of 2026-10-09 withdrew D-9's Share mode: *"Operator key is
 * not shared with riders. If it is hosted they need to bring their own key."*
 * {@link SourceOptions.hostedKey} is asked for `athleteId`'s key
 * (`hosted-key.ts` §`ownHostedKeyState`: the key the rider stored, or the
 * operator's one key for the operator's own jobs), and a key held for any
 * other athlete is refused here as well, so a rider with no key of their own
 * gets `hosted_unavailable` whatever the operator holds. The operator's key
 * stays with the athlete it was set for: if `OYL_INSTANCE_OWNER_KEY`
 * changes, the operator clears it and sets it again. The job engine does not
 * re-derive Q9's operator at job time (#1199's "Also owed", decided so,
 * because the key is that athlete's own).
 *
 * ⚠️ **No hosted request without masking.** Everything a hosted model is sent
 * is masked first (#1101, `hosted.ts`), so the hosted connection is built
 * ONLY by {@link SourceOptions.behindMasking} — `hosted.ts`
 * §`hostedBehindMasking` — and only with the athlete's guard, read by
 * {@link SourceOptions.guard} after the key is opened. A guard that is
 * missing, cannot be read, or whose read throws is a request not sent:
 * `hosted_unavailable` (`source.test.ts`). Its caller is the job engine
 * (#1095, `engine.ts`).
 */

import type { MaskingGuard } from '@onyourleft/analysis';

import { hostedOriginOf, type HostedKeyState } from './hosted-key.ts';
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
  /**
   * `athleteId`'s OWN key, opened with the instance's secret if it can be
   * (`hosted-key.ts` §`ownHostedKeyState`). Asked only after the consent.
   */
  readonly hostedKey: (athleteId: string) => Promise<HostedKeyState>;
  /**
   * The endpoint — the ORIGIN a request would go to — that `athleteId`'s own
   * recorded hosted consent names (ADR 0046 Q10 and D-9 point 2), or
   * `undefined` when they have none. A key rotated at the same origin keeps
   * the consent; another origin does not have it. Asked BEFORE the key is read.
   * Absent, `instance-hosted` fails `hosted_unavailable` for every athlete
   * and the key is never opened.
   */
  readonly recordedConsent?: (athleteId: string) => Promise<string | undefined>;
  /**
   * `athleteId`'s masking guard (`hosted.ts` §`readMaskingGuard`), or
   * `undefined` when they have none that can be read. `undefined` here, or a
   * read that throws, fails `instance-hosted` with `hosted_unavailable`.
   */
  readonly guard?: (athleteId: string) => Promise<MaskingGuard | undefined>;
  /**
   * Builds the hosted connection behind the guard's masking: `hosted.ts`
   * §`hostedBehindMasking`, which a guard is REQUIRED to call.
   */
  readonly behindMasking?: (key: OpenedHostedKey, guard: MaskingGuard) => ModelConnection;
}

/** The athlete's guard, or `undefined` for any way it cannot be had. */
async function guardFor(
  options: SourceOptions,
  athleteId: string,
): Promise<MaskingGuard | undefined> {
  if (options.guard === undefined) return undefined;
  try {
    return await options.guard(athleteId);
  } catch {
    return undefined;
  }
}

/** The model for `athleteId`'s job on `source`, or why there is none. */
export async function modelForSource(
  source: AnalysisSource,
  athleteId: string,
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
  // Q10, before the key is read: no recorded consent, no key opened.
  const recorded =
    options.recordedConsent === undefined ? undefined : await options.recordedConsent(athleteId);
  const consented = recorded === undefined ? undefined : hostedOriginOf(recorded);
  if (consented === undefined) return { ok: false, failure: 'hosted_unavailable' };
  const held = await options.hostedKey(athleteId);
  if (
    held.kind !== 'held' ||
    held.athleteId !== athleteId ||
    hostedOriginOf(held.url) !== consented ||
    options.behindMasking === undefined
  ) {
    return { ok: false, failure: 'hosted_unavailable' };
  }
  // No guard, no request: masking with half a guard, or none, would look masked and not be.
  const guard = await guardFor(options, athleteId);
  if (guard === undefined) return { ok: false, failure: 'hosted_unavailable' };
  return { ok: true, model: options.behindMasking(held, guard) };
}
