// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The measurement's table (#2320): one row per pair and run, in the units
 * spike 0035's tables use, so the owner's tablet figures sit beside the
 * desktop ones in #2009 without conversion.
 */

import type { PairRecord, StepRecord } from './measure';

const MB = 1_000_000;
const MIB = 1024 * 1024;

/** The table's header row. */
export const REPORT_COLUMNS = [
  'Pair',
  'Run',
  'Class (km)',
  'Routed (km)',
  'Init (ms)',
  'Cold (ms)',
  'Cold bytes (MB)',
  'Cold tiles',
  'Cold transfer (MB)',
  'Warm (ms)',
  'Warm requests',
  'Drag (ms)',
  'Drag requests',
  'WASM high water (MiB)',
  'Decoded cache (MiB)',
  'Error',
] as const;

function fixed(value: number | undefined, digits: number): string {
  return value === undefined ? '' : value.toFixed(digits);
}

function stepMs(step: StepRecord | undefined): string {
  return fixed(step?.ms, 0);
}

/** One record as the table's cells, in `REPORT_COLUMNS` order. */
export function reportRow(record: PairRecord): string[] {
  const cold = record.cold;
  return [
    String(record.pair),
    String(record.run),
    String(record.targetKm),
    record.routedKm === undefined
      ? ''
      : `${record.routedKm.toFixed(2)}${record.withinClass === false ? ' (out of class)' : ''}`,
    fixed(record.init?.ms, 0),
    stepMs(cold),
    cold === undefined ? '' : (cold.bytes / MB).toFixed(1),
    cold === undefined ? '' : String(cold.tiles),
    cold === undefined
      ? ''
      : cold.transferBytes === null
        ? 'unknown'
        : (cold.transferBytes / MB).toFixed(1),
    stepMs(record.warm),
    record.warm === undefined ? '' : String(record.warm.requests),
    stepMs(record.drag),
    record.drag === undefined ? '' : String(record.drag.requests),
    record.wasmHighWaterBytes === undefined ? '' : (record.wasmHighWaterBytes / MIB).toFixed(0),
    record.decodedCacheBytes === undefined ? '' : (record.decodedCacheBytes / MIB).toFixed(1),
    record.error === undefined ? '' : `${record.error.step}: ${record.error.code}`,
  ];
}

/** Appends `record` to `body` as a row, through `textContent`, so nothing in it is parsed as markup. */
export function appendRow(body: HTMLTableSectionElement, record: PairRecord): void {
  const row = body.ownerDocument.createElement('tr');
  for (const cell of reportRow(record)) {
    const td = body.ownerDocument.createElement('td');
    td.textContent = cell;
    row.append(td);
  }
  body.append(row);
}
