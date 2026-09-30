// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A scripted embedding model for tests (#835): deterministic, local to the
 * process, and honest about what it was asked. Test support, never shipped.
 *
 * A text's vector is a bag of its words hashed into {@link SCRIPTED_DIMENSION}
 * buckets, made unit length, so two texts sharing words score higher than two
 * that do not — enough to rank with, and to hold a ranking to.
 */

import {
  conventionOf,
  unitLength,
  type EmbedFailure,
  type EmbedOutcome,
  type EmbedPurpose,
  type Embedder,
} from './embedder.ts';

export const SCRIPTED_DIMENSION = 32;
export const SCRIPTED_MODEL = 'scripted-embedding';

/** What a scripted model was asked, in order. */
export interface ScriptedCall {
  readonly texts: readonly string[];
  readonly purpose: EmbedPurpose;
}

export interface ScriptedEmbedder extends Embedder {
  readonly calls: ScriptedCall[];
  /** Answer every request with this failure from now on; `undefined` answers again. */
  failWith: EmbedFailure | undefined;
  /** Answer a request holding a text this names a failure for with that failure (#918's poison item). */
  failFor: ((text: string) => EmbedFailure | undefined) | undefined;
}

function bucket(word: string): number {
  let hash = 2166136261;
  for (let index = 0; index < word.length; index += 1) {
    hash = Math.imul(hash ^ word.charCodeAt(index), 16777619);
  }
  return (hash >>> 0) % SCRIPTED_DIMENSION;
}

/** A text's vector, as the scripted model makes it. */
export function scriptedVector(text: string): Float32Array {
  const counts: number[] = Array.from({ length: SCRIPTED_DIMENSION }, () => 0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    counts[bucket(word)] = (counts[bucket(word)] ?? 0) + 1;
  }
  // A text with no words still has a direction, so it is a vector.
  if (!counts.some((count) => count > 0)) counts[0] = 1;
  return unitLength(counts) ?? new Float32Array(SCRIPTED_DIMENSION);
}

export function scriptedEmbedder(
  options: { readonly model?: string; readonly documentPrefix?: string } = {},
): ScriptedEmbedder {
  const calls: ScriptedCall[] = [];
  const embedder: ScriptedEmbedder = {
    model: options.model ?? SCRIPTED_MODEL,
    convention: conventionOf({
      documentPrefix: options.documentPrefix ?? 'doc: ',
      queryPrefix: 'query: ',
    }),
    calls,
    failWith: undefined,
    failFor: undefined,
    embed(texts, purpose): Promise<EmbedOutcome> {
      calls.push({ texts: [...texts], purpose });
      if (embedder.failWith !== undefined) {
        return Promise.resolve({ ok: false, why: embedder.failWith });
      }
      const poisoned = texts.map((text) => embedder.failFor?.(text)).find(Boolean);
      if (poisoned !== undefined) return Promise.resolve({ ok: false, why: poisoned });
      return Promise.resolve({ ok: true, vectors: texts.map(scriptedVector) });
    },
  };
  return embedder;
}
