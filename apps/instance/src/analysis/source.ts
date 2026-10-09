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
 * recorded on the instance, in **either** mode … A job without it is refused,
 * before a key is read."* Only the Ollama source is exempt (point 4). The
 * operator is an athlete, so their own jobs need it too. The check is
 * {@link SourceOptions.recordedConsent}, asked BEFORE
 * {@link SourceOptions.hostedKey}; nothing records a consent on this tree
 * (Q10 is #1199), so nothing supplies it on a running instance
 * (`instance.ts` §`InstanceOptions.hostedConsent`, which `serve.ts` never
 * sets) and every athlete’s `instance-hosted` job — the operator's too —
 * fails `hosted_unavailable` without the key being opened (`source.test.ts`,
 * `instance.test.ts` §"#1223").
 *
 * ⚠️ **The held key serves the athlete it is held for, and nobody else.**
 * That is the operator (ADR 0046 Q9, `operator model-key set`). Every other
 * athlete's job is refused as well until the operator's switch is built
 * (Q13: *"Other riders get no analysis until the operator turns it on,
 * whichever key they use"*). The athlete is the one stored with the key: if
 * `OYL_INSTANCE_OWNER_KEY` changes, the key stays with the athlete it was set
 * for until the operator clears it and sets it again.
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
   * The endpoint — the ORIGIN a request would go to — that `athleteId`'s own
   * recorded hosted consent names (ADR 0046 Q10 and D-9 point 2), or
   * `undefined` when they have none. A key rotated at the same origin keeps
   * the consent; another origin does not have it. Asked BEFORE the key is read.
   * `undefined` on this tree — no consent is recorded yet — so
   * `instance-hosted` fails `hosted_unavailable` for every athlete, the
   * operator included, and the key is never opened.
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
  const consented =
    options.recordedConsent === undefined ? undefined : await options.recordedConsent(athleteId);
  if (consented === undefined) return { ok: false, failure: 'hosted_unavailable' };
  const held = await options.hostedKey();
  if (
    held.kind !== 'held' ||
    held.athleteId !== athleteId ||
    new URL(held.url).origin !== consented ||
    options.behindMasking === undefined
  ) {
    return { ok: false, failure: 'hosted_unavailable' };
  }
  // No guard, no request: masking with half a guard, or none, would look masked and not be.
  const guard = await guardFor(options, athleteId);
  if (guard === undefined) return { ok: false, failure: 'hosted_unavailable' };
  return { ok: true, model: options.behindMasking(held, guard) };
}
