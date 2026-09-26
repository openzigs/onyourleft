// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **The ride page's "Side camera" section, audited in every state it
 * renders** — #388.
 *
 * `a11y/routes.a11y.test.tsx` audits the ride detail route with no store, where
 * there is no report and so no section; this file renders the page with a ride
 * and a report in each of its states and audits the whole page, so the section
 * is audited where it actually sits — under the ride's `h2`, beside its other
 * `h3` sections.
 *
 * ⚠️ Named `*.a11y.test.tsx` because that is what `test:a11y` selects on
 * (#142).
 */

import { activityId, athleteId, type SideCameraReportRecord } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations, tabbableElements } from '../a11y/audit';
import {
  SIDE_OBSERVATION_SENTENCES,
  SIDE_REPORT_OBSERVED,
  SIDE_REPORT_TOO_SHORT,
} from '../camera/side-report-wording';
import { mount, settle, type Mounted } from '../testing/mount';
import { ActivityDetailView } from '../views/ActivityDetailView';

import { stubActivity, stubDetail } from './testing';

const ATHLETE = athleteId('athlete-a');
const RIDE = activityId('ride-1');

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function report(observations: readonly string[], summary: string): SideCameraReportRecord {
  return { athleteId: ATHLETE, activityId: RIDE, summary, observations };
}

async function openWith(sideCamera: SideCameraReportRecord | 'unreadable'): Promise<void> {
  document.documentElement.lang = 'en';
  mounted = await mount(
    <main>
      <h1>Ride details</h1>
      <ActivityDetailView
        port={stubDetail(ATHLETE, { activity: stubActivity(), channels: {}, laps: [], sideCamera })}
        activityId={RIDE}
      />
    </main>,
  );
  await settle();
  await settle();
}

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`).toBe('');
}

describe('the side camera section passes the audit', () => {
  it('with observations', async () => {
    await openWith(
      report(
        [SIDE_OBSERVATION_SENTENCES.torso.decreased, SIDE_OBSERVATION_SENTENCES.knee.increased],
        SIDE_REPORT_OBSERVED,
      ),
    );
    expect(document.body.textContent).toContain('Side camera');
    expectClean('a ride with side-camera observations');
  });

  it('with nothing to show', async () => {
    await openWith(report([], SIDE_REPORT_TOO_SHORT));
    expectClean('a ride whose side-camera report has nothing to show');
  });

  it('with a sentence withheld', async () => {
    await openWith(report(['Your knee angle was 142°.'], SIDE_REPORT_OBSERVED));
    expectClean('a ride whose side-camera report holds a sentence this build does not know');
  });

  it('with a report that will not decode', async () => {
    await openWith('unreadable');
    expectClean('a ride whose side-camera report cannot be read');
  });

  it('adds nothing to the tab order — a report is read, not operated', async () => {
    await openWith(report([], SIDE_REPORT_TOO_SHORT));
    const section = document.querySelector('.oyl-side-report');
    expect(section).not.toBeNull();
    expect(tabbableElements(document).filter((element) => section?.contains(element))).toEqual([]);
  });
});
