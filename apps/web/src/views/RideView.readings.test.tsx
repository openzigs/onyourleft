// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #1433 on the Ride screen: the readings the rider chose, in their order, and
 * the *Zoom* that keeps the top two at the larger size. What is asserted is
 * what the screen draws — the cards' labels and classes — and what a later
 * screen reads back from this device, not the state a press set.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { RIDE_READINGS_STORAGE_KEY, readRideReadings } from '../ride/reading-choice';
import { idleSnapshot, ridingSnapshot, stubRideController } from '../ride/testing';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';

import { RIDE_ZOOM_LABEL, RideView } from './RideView';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  localStorage.removeItem(RIDE_READINGS_STORAGE_KEY);
});

async function show(snapshot = ridingSnapshot()): Promise<void> {
  mounted?.unmount();
  mounted = await mount(<RideView controller={stubRideController(snapshot).controller} />);
  await settle();
}

function cards(): string[] {
  return queryAll(document, '.oyl-metric-grid > .oyl-metric').map(
    (card) => card.querySelector('.oyl-metric__label')?.textContent ?? '',
  );
}

function zoom(): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(document, 'button').find(
    (button) => button.textContent?.trim() === RIDE_ZOOM_LABEL,
  );
}

describe('the readings a rider chose', () => {
  it('are the four, in the order they always were, when nothing is chosen', async () => {
    await show();
    expect(cards()).toEqual(['Power', 'Cadence', 'Heart rate', 'Speed']);
  });

  it('are drawn in the stored order, without the ones turned off', async () => {
    localStorage.setItem(
      RIDE_READINGS_STORAGE_KEY,
      JSON.stringify({ order: ['heartRate', 'speed', 'power', 'cadence'], hidden: ['speed'] }),
    );
    await show();
    expect(cards()).toEqual(['Heart rate', 'Power', 'Cadence']);
  });
});

describe('the zoom', () => {
  it('keeps the top two at the zoom size, and the next screen opens zoomed', async () => {
    localStorage.setItem(
      RIDE_READINGS_STORAGE_KEY,
      JSON.stringify({ order: ['cadence', 'heartRate', 'power', 'speed'] }),
    );
    await show();
    const button = zoom();
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('.oyl-metric-grid--zoomed')).toBeNull();

    await activateWithKeyboard(button as HTMLButtonElement);

    expect(cards()).toEqual(['Cadence', 'Heart rate']);
    expect(document.querySelector('.oyl-metric-grid')?.classList).toContain(
      'oyl-metric-grid--zoomed',
    );
    expect(zoom()?.getAttribute('aria-pressed')).toBe('true');
    // Kept on the device: read back the way the next Ride screen reads it.
    expect(readRideReadings(localStorage).zoomed).toBe(true);
    await show();
    expect(cards()).toEqual(['Cadence', 'Heart rate']);
    expect(zoom()?.getAttribute('aria-pressed')).toBe('true');

    await activateWithKeyboard(zoom() as HTMLButtonElement);
    expect(cards()).toEqual(['Cadence', 'Heart rate', 'Power', 'Speed']);
    expect(document.querySelector('.oyl-metric-grid--zoomed')).toBeNull();
    expect(readRideReadings(localStorage).zoomed).toBe(false);
  });

  it('is beside the ride’s own controls, outside their row of three', async () => {
    await show();
    const button = zoom();
    expect(button?.parentElement?.classList).toContain('oyl-ride__action-row');
    expect(button?.closest('.oyl-ride__actions')).toBeNull();
    expect(button?.classList).toContain('oyl-button--ride');
  });

  it('is offered before a ride starts, and not where there is nothing to zoom', async () => {
    await show({
      ...idleSnapshot(),
      metrics: ridingSnapshot().metrics,
      sensors: ridingSnapshot().sensors,
    });
    expect(zoom()).toBeDefined();

    await show({ ...ridingSnapshot(), sensors: [] });
    expect(zoom()).toBeUndefined();

    await show({ ...ridingSnapshot(), phase: 'stopped' });
    expect(zoom()).toBeUndefined();
  });
});

describe('a channel with no reading yet', () => {
  it('shows a dash and says it is waiting, never a number — speed before its first reading', async () => {
    const riding = ridingSnapshot();
    await show({
      ...riding,
      metrics: riding.metrics.map((metric) =>
        metric.id === 'speed' ? { id: 'speed', state: { kind: 'waiting' } } : metric,
      ),
    });
    const speed = queryAll(document, '.oyl-metric').find(
      (card) => card.querySelector('.oyl-metric__label')?.textContent === 'Speed',
    );
    expect(speed?.querySelector('.oyl-reading__value')?.textContent).toBe('—');
    expect(speed?.textContent).toContain('waiting for the first reading');
    expect(speed?.querySelector('.oyl-reading__value')?.textContent).not.toMatch(/\d/);
  });
});
