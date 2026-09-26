// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **The "Side camera" section of a ride's page** — #388, the owner's ruling:
 * on the ride's own page, only for a ride with a report, no new route.
 *
 * ⚠️ **The pair that matters most is "nothing to show" against "a correct
 * report"** — `views/CreditsView.test.tsx`'s precedent: an empty section and a
 * correct one must not look the same, or a report that silently lost its
 * sentences would read as a quiet ride.
 */

import {
  activityId,
  athleteId,
  openActivityStore,
  type SideCameraReportRecord,
} from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  resetFixtureIds,
  seedAthletes,
  seedRide,
} from '@onyourleft/store/testing';
import { afterEach, describe, expect, it } from 'vitest';

import {
  SIDE_OBSERVATION_SENTENCES,
  SIDE_OBSERVATION_VOCABULARY,
  SIDE_REPORT_NOTHING_TO_SHOW,
  SIDE_REPORT_OBSERVED,
  SIDE_REPORT_TOO_SHORT,
  SIDE_REPORT_UNREADABLE_ROW,
  SIDE_REPORT_WITHHELD,
} from '../camera/side-report-wording';
import { mount, settle, type Mounted } from '../testing/mount';
import { ActivityDetailView } from '../views/ActivityDetailView';

import type { DetailPort } from './store-port';
import { stubActivity, stubDetail } from './testing';

const ATHLETE = athleteId('athlete-a');
const RIDE = activityId('ride-1');

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function report(
  observations: readonly string[],
  summary: string = SIDE_REPORT_OBSERVED,
): SideCameraReportRecord {
  return { athleteId: ATHLETE, activityId: RIDE, summary, observations };
}

async function open(port: DetailPort, id = RIDE): Promise<HTMLElement | null> {
  mounted = await mount(<ActivityDetailView port={port} activityId={id} />);
  await settle();
  await settle();
  return document.querySelector<HTMLElement>('.oyl-side-report');
}

function stubWith(sideCamera?: SideCameraReportRecord | 'unreadable'): DetailPort {
  return stubDetail(ATHLETE, {
    activity: stubActivity(),
    channels: {},
    laps: [],
    ...(sideCamera === undefined ? {} : { sideCamera }),
  });
}

const OBSERVED = [
  SIDE_OBSERVATION_SENTENCES.torso.decreased,
  SIDE_OBSERVATION_SENTENCES.knee.increased,
];

describe('only for a ride the side camera filmed', () => {
  it('renders no section, and no heading, for a ride with no report', async () => {
    const section = await open(stubWith());
    expect(section).toBeNull();
    expect(document.body.textContent).not.toContain('Side camera');
    // And the rest of the page is there, so the absence is not a blank page.
    expect(document.querySelector('h2')?.textContent).toBe('Tuesday morning');
  });

  it('renders the summary and one list item per observation for a ride with a report', async () => {
    const section = await open(stubWith(report(OBSERVED)));
    expect(section?.querySelector('h3')?.textContent).toBe('Side camera');
    expect(section?.textContent).toContain(SIDE_REPORT_OBSERVED);
    expect([...(section?.querySelectorAll('li') ?? [])].map((item) => item.textContent)).toEqual(
      OBSERVED,
    );
  });
});

describe('an empty report and a correct one do not look the same (CreditsView’s lesson)', () => {
  it('says there is nothing to show, and why, with no list', async () => {
    const section = await open(stubWith(report([], SIDE_REPORT_TOO_SHORT)));
    expect(section?.textContent).toContain(SIDE_REPORT_NOTHING_TO_SHOW);
    expect(section?.textContent).toContain(SIDE_REPORT_TOO_SHORT);
    expect(section?.querySelector('ul')).toBeNull();
  });

  it('never says "nothing to show" beside observations, and never shows an observation beside it', async () => {
    const full = await open(stubWith(report(OBSERVED)));
    const fullText = full?.textContent ?? '';
    mounted?.unmount();
    const empty = await open(stubWith(report([], SIDE_REPORT_TOO_SHORT)));
    const emptyText = empty?.textContent ?? '';
    expect(fullText).not.toContain(SIDE_REPORT_NOTHING_TO_SHOW);
    for (const sentence of SIDE_OBSERVATION_VOCABULARY) {
      expect(emptyText).not.toContain(sentence);
    }
    expect(fullText).not.toBe(emptyText);
  });
});

describe('it renders only what the vocabulary file can say', () => {
  it('withholds a stored sentence this build cannot produce, says so, and keeps the rest', async () => {
    const section = await open(
      stubWith(report([SIDE_OBSERVATION_SENTENCES.elbow.increased, 'Your knee angle was 142°.'])),
    );
    expect(section?.textContent).not.toContain('142');
    expect(section?.textContent).toContain(SIDE_OBSERVATION_SENTENCES.elbow.increased);
    expect(section?.textContent).toContain(SIDE_REPORT_WITHHELD);
  });

  it('withholds a summary it does not know', async () => {
    const section = await open(stubWith(report(OBSERVED, 'Your fit is correct.')));
    expect(section?.textContent).not.toContain('Your fit is correct.');
    expect(section?.textContent).toContain(SIDE_REPORT_WITHHELD);
  });

  it('says nothing is withheld when nothing is', async () => {
    const section = await open(stubWith(report(OBSERVED)));
    expect(section?.textContent).not.toContain(SIDE_REPORT_WITHHELD);
  });
});

describe('a report that will not decode', () => {
  it('is said in words, and does not take the ride’s page with it', async () => {
    const section = await open(stubWith('unreadable'));
    expect(section?.textContent).toContain(SIDE_REPORT_UNREADABLE_ROW);
    // Nothing of the error reaches the page (ADR 0029 D-8).
    expect(section?.textContent).not.toContain('must be a sentence');
    expect(document.querySelector('h2')?.textContent).toBe('Tuesday morning');
  });
});

describe('what the section does not contain (ADR 0030 R7, ADR 0029 D-8)', () => {
  it('has no control of any kind, and no picture', async () => {
    for (const state of [
      report(OBSERVED),
      report([], SIDE_REPORT_TOO_SHORT),
      'unreadable',
    ] as const) {
      const section = await open(stubWith(state));
      expect(
        section?.querySelectorAll('button, a, input, select, textarea, [tabindex]'),
      ).toHaveLength(0);
      expect(section?.querySelectorAll('img, svg, canvas, video, picture')).toHaveLength(0);
      mounted?.unmount();
      mounted = undefined;
    }
  });
});

describe('read back from the real store (CLAUDE.md §5)', () => {
  it('shows the sentences saved with the ride, through a connection nothing wrote on', async () => {
    resetFixtureIds();
    const harness = createStoreHarness();
    try {
      await seedAthletes(harness);
      const ride = await seedRide(harness, ATHLETE_A);
      await harness.write(async (store) =>
        store.putSideCameraReport({
          athleteId: ATHLETE_A,
          activityId: ride.id,
          summary: SIDE_REPORT_OBSERVED,
          observations: OBSERVED,
        }),
      );
      const store = openActivityStore(harness.databaseName);
      try {
        const section = await open({ athleteId: ATHLETE_A, store }, ride.id);
        expect(
          [...(section?.querySelectorAll('li') ?? [])].map((item) => item.textContent),
        ).toEqual(OBSERVED);
      } finally {
        store.close();
      }
    } finally {
      await harness.destroy();
    }
  });
});
