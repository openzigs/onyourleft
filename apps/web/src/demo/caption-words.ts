// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The words no caption of a video may say — #3074, shared since #3156 by the
 * demo's feature tour (`caption-claims.ts`) and the capture video's scene
 * script (`tools/capture/video-script.ts`), so the two cannot drift apart.
 * Imports nothing, so `node` loads it with types stripped (`capture`).
 */

/**
 * Whole words a caption may not say, matched as written: the load-metric
 * trademarks (CLAUDE.md section 6).
 */
const TRADEMARK_WORDS = ['NP', 'TSS', 'IF', 'CTL', 'ATL', 'TSB'] as const;

/**
 * Phrases a caption may not say, in any case: the metrics' long names,
 * competitors' names, and ADR 0030 R6's claims.
 */
const REFUSED_PHRASES = [
  'normalized power',
  'normalised power',
  'training stress score',
  'intensity factor',
  'strava',
  'zwift',
  'peloton',
  'trainerroad',
  'rouvy',
  'mywhoosh',
  'fulgaz',
  'bkool',
  'komoot',
  'validated',
  'accurate to',
  'professional fit',
] as const;

/** Why `text` may not be said, if it may not: the word or phrase it may not say. */
export function refusedWords(text: string): string | undefined {
  for (const word of TRADEMARK_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return word;
  }
  const lower = text.toLowerCase();
  return REFUSED_PHRASES.find((phrase) => lower.includes(phrase));
}
