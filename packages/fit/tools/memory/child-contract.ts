// SPDX-License-Identifier: Apache-2.0

/**
 * What `retention.test.ts` and `decode-under-a-heap-cap.ts` agree on — #127.
 *
 * Its own module because the child is a **script**: importing it runs it, and a
 * test that imported the names from there would spawn a decode inside the test
 * runner as a side effect of reading a string constant. That is not a
 * hypothetical — it is what the first version of this did, and the failure read
 * as a usage error from a process nobody meant to start.
 */

/** The committed fixture the large file is built from. */
export const SOURCE_FIXTURE = 'nominal-outdoor-ride.fit';

/** How many records `SOURCE_FIXTURE` carries, so a short decode cannot pass. */
export const SOURCE_RECORD_COUNT = 120;

/** Which spelling of the decode the child should run. */
export type DecodeMode = 'streaming' | 'array';

/** The one line the child prints on success, and all the parent asserts about. */
export interface DecodeReport {
  readonly mode: DecodeMode;
  readonly inputBytes: number;
  readonly records: number;
}
