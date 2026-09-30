// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An in-memory {@link RiderTextPort} for the screens' tests, the
 * accessibility walk and the browser harnesses (#836). Test support, never
 * shipped.
 *
 * It applies the store's own rules — `tidyRiderText` on the way in, and
 * `riderTextProblem` refusing with the store's own message — so a screen that
 * showed what it typed rather than what landed would show the wrong thing here
 * too. It does not check that a note's ride exists; the store's own tests do.
 */

import { unixSeconds } from '@onyourleft/domain';
import {
  athleteId as toAthleteId,
  MAXIMUM_RIDER_DOCUMENTS,
  riderTextProblem,
  StoreValidationError,
  tidyRiderText,
  type AthleteId,
  type RiderTextRecord,
} from '@onyourleft/store';

import type { RiderTextPort } from './rider-text-port';

export interface MemoryRiderText {
  readonly port: RiderTextPort;
  /** What is kept, by `kind|key`. */
  readonly kept: Map<string, RiderTextRecord>;
  /** Every store method called, in order. */
  readonly calls: string[];
  /** Make the next write or delete throw this. */
  failNext: Error | undefined;
}

export const MEMORY_RIDER = toAthleteId('local');

export function memoryRiderText(
  initial: readonly RiderTextRecord[] = [],
  athlete: AthleteId = MEMORY_RIDER,
): MemoryRiderText {
  const kept = new Map(initial.map((row) => [`${row.kind}|${row.key}`, row]));
  const calls: string[] = [];
  let next = 0;
  const memory: MemoryRiderText = {
    kept,
    calls,
    failNext: undefined,
    port: {
      athleteId: athlete,
      now: () => unixSeconds(1_790_000_000),
      newDocumentId: () => `doc-${String((next += 1))}`,
      store: {
        getRiderText: (owner, kind, key) => {
          calls.push('getRiderText');
          const row = kept.get(`${kind}|${key}`);
          return Promise.resolve(row?.athleteId === owner ? row : undefined);
        },
        listRiderTexts: (owner, kind) => {
          calls.push('listRiderTexts');
          return Promise.resolve(
            [...kept.values()]
              .filter((row) => row.athleteId === owner && row.kind === kind)
              .sort((a, b) => (a.key < b.key ? -1 : 1)),
          );
        },
        putRiderText: (record) => {
          calls.push('putRiderText');
          const failure = memory.failNext;
          memory.failNext = undefined;
          if (failure !== undefined) return Promise.reject(failure);
          const row: RiderTextRecord = {
            ...record,
            ...(record.name === undefined ? {} : { name: record.name.trim() }),
            text: tidyRiderText(record.text),
          };
          const problem = riderTextProblem(row);
          if (problem !== undefined) return Promise.reject(new StoreValidationError(problem));
          const documents = [...kept.values()].filter((each) => each.kind === 'document');
          if (
            row.kind === 'document' &&
            !kept.has(`document|${row.key}`) &&
            documents.length >= MAXIMUM_RIDER_DOCUMENTS
          ) {
            return Promise.reject(new StoreValidationError('riderText: too many documents'));
          }
          kept.set(`${row.kind}|${row.key}`, row);
          return Promise.resolve(row);
        },
        deleteRiderText: (owner, kind, key) => {
          calls.push('deleteRiderText');
          const failure = memory.failNext;
          memory.failNext = undefined;
          if (failure !== undefined) return Promise.reject(failure);
          const row = kept.get(`${kind}|${key}`);
          if (row?.athleteId !== owner) return Promise.resolve(false);
          kept.delete(`${kind}|${key}`);
          return Promise.resolve(true);
        },
      },
    },
  };
  return memory;
}
