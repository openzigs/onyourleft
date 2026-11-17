// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What a step-up is bound to** (#2642, ADR 0069 D-4): a change made from
 * the admin pages needs, in the same `POST`, a passkey assertion over a
 * challenge the instance issued for THAT action and THOSE fields, for this
 * session, once, within two minutes.
 *
 * The binding is the action's name and the SHA-256 of its canonical fields:
 * the fields the action declares in {@link ADMIN_CHANGES}, each once, sorted
 * by name and form-encoded. A field the action does not declare, a field
 * twice, or one missing is refused before anything is hashed, so two forms
 * that differ in anything the change reads have different bindings — a
 * challenge for *back up now* is no good for *end room*, and one for revoking
 * passkey A is no good for revoking passkey B.
 *
 * The form fields that carry the session's CSRF token and the assertion
 * itself are not part of what is bound: they are what proves it.
 */

import { sha256Hex } from '../auth/crypto.ts';

/** How long a step-up's challenge, or a sign-in's or an enrolment's, may be answered, in seconds. */
export const ADMIN_CHALLENGE_SECONDS = 2 * 60;

/**
 * Every change the admin pages make, by name, and the fields each binds. The
 * Operate pages (#2647–#2650) each add their own; a name not here is refused
 * a challenge.
 */
export const ADMIN_CHANGES = {
  passkey_revoke: { fields: ['id'] },
  // #2648: the AI backend page's five changes, each one route call.
  analysis_offer: { fields: ['offer', 'on'] },
  analysis_check: { fields: ['model'] },
  analysis_model: { fields: ['localModel'] },
  analysis_address: { fields: ['localUrl'] },
  analysis_clear: { fields: [] },
  // #2646 (ADR 0069 D-9): a registration decided, for one rider and with the reason typed.
  registration_approve: { fields: ['athleteId', 'reason'] },
  registration_refuse: { fields: ['athleteId', 'reason'] },
} as const satisfies Readonly<Record<string, { readonly fields: readonly string[] }>>;

export type AdminChange = keyof typeof ADMIN_CHANGES;

/** The form fields that prove a change, never part of what it is bound to. */
export const PROOF_FIELDS: readonly string[] = [
  'csrf',
  'action',
  'credential',
  'clientDataJSON',
  'authenticatorData',
  'signature',
];

/** Whether `name` is a change the admin pages make. */
export function isAdminChange(name: string): name is AdminChange {
  return Object.hasOwn(ADMIN_CHANGES, name);
}

/**
 * The fields of `form` that `declared` names, each exactly once, and no
 * other field but the proof's — or `undefined`.
 */
export function boundFields(
  declared: readonly string[],
  form: URLSearchParams,
): Readonly<Record<string, string>> | undefined {
  const fields: Record<string, string> = {};
  for (const name of new Set(form.keys())) {
    const values = form.getAll(name);
    if (PROOF_FIELDS.includes(name)) {
      if (values.length !== 1) return undefined;
      continue;
    }
    if (!declared.includes(name) || values.length !== 1) return undefined;
    fields[name] = values[0] as string;
  }
  return declared.every((name) => Object.hasOwn(fields, name)) ? fields : undefined;
}

/** The SHA-256 a challenge for `action` over `fields` is bound to. */
export function bindingOf(
  action: string,
  fields: Readonly<Record<string, string>>,
): Promise<string> {
  const canonical = new URLSearchParams(
    Object.keys(fields)
      .sort()
      .map((name) => [name, fields[name] as string]),
  ).toString();
  return sha256Hex(`oyl-admin-step-up:${action}\n${canonical}`);
}
