// SPDX-License-Identifier: Apache-2.0

/**
 * The words every Operate section counts, measures and dates in (#2644, ADR
 * 0069 D-7): moved from `apps/web/src/views/OperateStatusPanel.tsx` and
 * `OperateBackupsPanel.tsx` with no change to what they return.
 *
 * ⚠️ **Every sentence here is DRAFT wording awaiting the owner's approval.**
 */

/** `3 rows`, `1 row`: a whole count and its noun. */
export function countText(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** A length of time in its two largest units: "3 days 4 hours", "17 minutes". */
export function durationText(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) {
    const rest = hours % 24;
    return rest === 0
      ? countText(days, 'day', 'days')
      : `${countText(days, 'day', 'days')} ${countText(rest, 'hour', 'hours')}`;
  }
  if (hours > 0) {
    const rest = minutes % 60;
    return rest === 0
      ? countText(hours, 'hour', 'hours')
      : `${countText(hours, 'hour', 'hours')} ${countText(rest, 'minute', 'minutes')}`;
  }
  if (minutes > 0) return countText(minutes, 'minute', 'minutes');
  return 'less than a minute';
}

/** Bytes in decimal units, as a disk's maker counts them: "412 GB", "1.5 TB". */
export function bytesText(bytes: number): string {
  const units: readonly [number, string][] = [
    [1e12, 'TB'],
    [1e9, 'GB'],
    [1e6, 'MB'],
    [1e3, 'kB'],
  ];
  for (const [size, unit] of units) {
    if (bytes >= size) {
      const value = bytes / size;
      return `${value < 10 ? value.toFixed(1) : String(Math.round(value))} ${unit}`;
    }
  }
  return `${String(bytes)} bytes`;
}

/**
 * A moment, to the minute, in UTC, so the screen says the same thing wherever
 * it is read: `2026-11-14T08:00:00.000Z` is "2026-11-14 08:00 UTC". It reads
 * the ISO 8601 text the route sent, never a clock.
 */
export function momentText(iso: string): string {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}
