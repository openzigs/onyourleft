// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **How long a notice keeps what its notifier gave** (#1381): the owner's
 * ruling of 2026-10-30, for GDPR Art. 5(1)(e). A notice's notifier details —
 * their name, their email address and the words they typed (the explanation,
 * and the location in their own words) — are kept for six months after the
 * notice is closed, then erased. The decision, its dates, the items the notice
 * names and its reference stay, as the record of what the instance was told
 * and what it did (`record.ts`).
 *
 * A notice is **closed** when its decision is recorded (#912's `decided`
 * step): that is the last step a moderator must take, and the notifier is
 * told it "without undue delay" after (DSA Art. 16(5)).
 *
 * A notice whose moderator never records a decision is not kept for ever
 * (#1923, the owner's ruling of 2026-10-30): its notifier details are erased
 * twelve months after it was received when no decision is recorded by then.
 * The same fields go and the same things stay.
 *
 * The instance erases on its own, on the hour (`instance.ts`), through
 * `moderation.ts` §`eraseExpiredNoticeDetails`, so nobody has to remember to.
 */

/** How many calendar months a closed notice keeps its notifier details. */
export const NOTICE_DETAILS_RETENTION_MONTHS = 6;

/**
 * How many calendar months a notice with no decision recorded keeps its
 * notifier details, counted from when it was received (#1923).
 */
export const UNDECIDED_NOTICE_DETAILS_RETENTION_MONTHS = 12;

/** How often the instance erases what is due: every hour, on the hour. */
export const NOTICE_RETENTION_SWEEP_PERIOD_MS = 60 * 60 * 1000;

/**
 * When the notifier details of a notice decided at `decidedAt` are due to be
 * erased, Unix seconds: the same time of day, six calendar months later — or
 * the last day of that month when it is shorter (31 August's is the end of
 * February), so it is never later than six months.
 */
export function noticeDetailsDueAt(decidedAt: number): number {
  return monthsAfter(decidedAt, NOTICE_DETAILS_RETENTION_MONTHS);
}

/**
 * When the notifier details of a notice received at `receivedAt` are due to
 * be erased if no decision is recorded on it by then (#1923), Unix seconds:
 * twelve calendar months later, on the same terms as
 * {@link noticeDetailsDueAt} (29 February's is 28 February).
 */
export function undecidedNoticeDetailsDueAt(receivedAt: number): number {
  return monthsAfter(receivedAt, UNDECIDED_NOTICE_DETAILS_RETENTION_MONTHS);
}

/**
 * `months` calendar months after `at` (Unix seconds), at the same time of
 * day, or on the last day of that month when it is shorter.
 */
function monthsAfter(at: number, months: number): number {
  const from = new Date(at * 1000);
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return (
    Date.UTC(
      year,
      month,
      Math.min(from.getUTCDate(), lastDay),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
    ) / 1000
  );
}
