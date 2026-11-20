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
 * A moment, to the minute, in the IANA zone `timeZone`, with the zone named
 * (#2917): `2026-11-14T08:00:00.000Z` is "2026-11-14 08:00 UTC" in `UTC` and
 * "2026-11-14 03:00 EST" in `America/New_York`. The caller names the zone, so
 * nothing here depends on the machine's: the app's Operate panels pass the
 * device's, the instance's admin pages pass `UTC` (`admin/pages.ts`
 * §`ADMIN_TIME_ZONE`). It reads the ISO 8601 text the route sent, never a
 * clock; text that is not a moment is kept as it came, to the minute's length.
 */
export function momentText(iso: string, timeZone: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return `${iso.slice(0, 16).replace('T', ' ')} ${timeZone}`;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((each) => each.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')} ${part('timeZoneName')}`;
}
