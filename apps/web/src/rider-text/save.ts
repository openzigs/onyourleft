// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Saving the goals or a ride's note (#836): what a press of *Save* does with
 * what the rider typed, decided in one place for both screens.
 *
 * - Blank (after the ends are trimmed) **deletes** the text: a rider who
 *   empties the box has removed their goals, and the next sync deletes them on
 *   the instance too (`instance/sync.ts` rule 8).
 * - Over the limit is refused **before** anything is written, with the limit
 *   in characters, and nothing already saved changes. The box does not cut
 *   what was typed: a paste that silently lost its end would be text the
 *   rider never saw go.
 * - Otherwise it is written, and what LANDED is answered — the store tidies
 *   it — so the screen shows the saved text, not the typed one.
 */

import { maximumRiderTextCharacters, tidyRiderText, type RiderTextRecord } from '@onyourleft/store';

import type { RiderTextPort } from './rider-text-port';

export type RiderTextSave =
  | { readonly kind: 'saved'; readonly record: RiderTextRecord }
  | { readonly kind: 'cleared' }
  | { readonly kind: 'too-long'; readonly maximum: number }
  | { readonly kind: 'failed'; readonly reason: string };

/** How long a text is, in the characters its limit is stated in (UTF-16 units). */
export function riderTextLength(typed: string): number {
  return tidyRiderText(typed).length;
}

export async function saveRiderText(
  port: RiderTextPort,
  kind: 'goal' | 'note',
  key: string,
  typed: string,
): Promise<RiderTextSave> {
  const text = tidyRiderText(typed);
  const maximum = maximumRiderTextCharacters(kind);
  if (text.length > maximum) return { kind: 'too-long', maximum };
  try {
    if (text === '') {
      await port.store.deleteRiderText(port.athleteId, kind, key);
      return { kind: 'cleared' };
    }
    const record = await port.store.putRiderText({
      athleteId: port.athleteId,
      kind,
      key,
      text,
      savedAt: port.now(),
    });
    return { kind: 'saved', record };
  } catch (error: unknown) {
    return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}
