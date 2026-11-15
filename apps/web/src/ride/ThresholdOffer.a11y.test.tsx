// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The threshold-estimate offer, audited — #2307: in every state a rider can
 * meet it in (an estimate to answer, a refusal, each answer given, a browser
 * with no store), with `a11y/audit.ts`'s rules; its two answers named by what
 * they do; the answer to a press said once, live; and nothing focusable in a
 * refusal. No colour is new: the words are the page's ink and `oyl-muted`,
 * and the answer is `StatusMessage`'s, pairs `contrast.a11y.test.ts` holds in
 * both palettes.
 */

import { unixSeconds, watts } from '@onyourleft/domain';
import { athleteId } from '@onyourleft/store';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { stubAnalysis } from '../analysis/testing';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import type { TestRideEstimate } from '../workouts/threshold-test-result';
import { THRESHOLD_OFFER_TEXT, ThresholdOffer } from './ThresholdOffer';

const OWNER = athleteId('athlete-a');

const ESTIMATE: TestRideEstimate = {
  test: 'ramp',
  estimate: {
    kind: 'estimate',
    thresholdPower: watts(247),
    basis: watts(329),
    windowSeconds: 60,
    multiplier: 0.75,
  },
};

const REFUSED: TestRideEstimate = {
  test: 'twenty-minute',
  estimate: { kind: 'refused', reason: 'The twenty minutes were not all ridden.' },
};

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function offer(
  given: TestRideEstimate,
  store = true,
): Promise<ReturnType<typeof stubAnalysis>> {
  const analysis = stubAnalysis(OWNER, [], {
    id: OWNER,
    displayName: 'A',
    createdAt: unixSeconds(1),
    thresholdPower: watts(230),
  });
  mounted = await mount(
    <main>
      <h1>Ride</h1>
      {/* As on the Ride screen: under the Live group's heading, beside the h3 result card. */}
      <h2>Live</h2>
      <ThresholdOffer
        offer={given}
        current={watts(230)}
        analysis={store ? analysis : undefined}
        onAccepted={() => undefined}
      />
    </main>,
  );
  await settle();
  return analysis;
}

const audit = (): string => formatViolations(auditAccessibility(document));

async function press(text: string): Promise<void> {
  const button = queryAll<HTMLButtonElement>(document, 'button').find(
    (each) => each.textContent === text,
  );
  if (button === undefined) throw new Error(`no button “${text}”`);
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
  await settle();
}

describe('the threshold-estimate offer — #2307', () => {
  it('offers an estimate with two answers named by what they do, under its own heading', async () => {
    await offer(ESTIMATE);
    const section = document.querySelector('[data-oyl-threshold-offer]');
    expect(section?.getAttribute('aria-labelledby')).toBe(section?.querySelector('h3')?.id);
    expect(queryAll(section as HTMLElement, 'button').map((each) => each.textContent)).toEqual([
      'Set my threshold to 247 W',
      THRESHOLD_OFFER_TEXT.keep,
    ]);
    expect(section?.querySelectorAll('[role="status"]')).toHaveLength(0);
    expect(audit()).toBe('');
  });

  it('says the answer to Accept once, live, and offers nothing more', async () => {
    await offer(ESTIMATE);
    await press('Set my threshold to 247 W');
    const said = queryAll(document, '[role="status"]');
    expect(said).toHaveLength(1);
    // The owner's ruling of 2026-11-07 (b): the sentence alone, no "Done:" before it.
    expect(said[0]?.textContent).toBe(THRESHOLD_OFFER_TEXT.accepted(watts(247)));
    expect(queryAll(document, 'button')).toHaveLength(0);
    // The question as it was asked, not the answer: the threshold before.
    expect(document.body.textContent).toContain('(it is 230 W now)');
    expect(audit()).toBe('');
  });

  it('writes once when Accept is pressed twice before the screen has re-rendered', async () => {
    const analysis = await offer(ESTIMATE);
    const accept = queryAll<HTMLButtonElement>(document, 'button').find(
      (each) => each.textContent === 'Set my threshold to 247 W',
    );
    await act(async () => {
      accept?.click();
      accept?.click();
      await Promise.resolve();
    });
    await settle();
    expect(analysis.thresholdWrites).toHaveLength(1);
  });

  it('says the answer to Keep once, live, and writes nothing', async () => {
    const analysis = await offer(ESTIMATE);
    await press(THRESHOLD_OFFER_TEXT.keep);
    // The owner's ruling of 2026-11-07 (b): the sentence alone, no "Done:" before it.
    expect(queryAll(document, '[role="status"]').map((each) => each.textContent)).toEqual([
      THRESHOLD_OFFER_TEXT.kept,
    ]);
    expect(analysis.thresholdWrites).toEqual([]);
    expect(audit()).toBe('');
  });

  it('says why a test made no estimate, with nothing to press', async () => {
    await offer(REFUSED);
    expect(document.body.textContent).toContain(
      'Your 20-minute test made no threshold estimate. The twenty minutes were not all ridden.',
    );
    expect(queryAll(document, 'button, a, input')).toHaveLength(0);
    expect(audit()).toBe('');
  });

  it('says so where there is no store to write the answer to', async () => {
    await offer(ESTIMATE, false);
    expect(document.body.textContent).toContain(THRESHOLD_OFFER_TEXT.noStore);
    expect(queryAll(document, 'button')).toHaveLength(0);
    expect(audit()).toBe('');
  });
});
