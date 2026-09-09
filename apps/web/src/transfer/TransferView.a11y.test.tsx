// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The transfer screen audited in its **busy** state.
 *
 * `routes.a11y.test.tsx` renders every route from the table and audits it, so
 * this route is already covered — in the state it is in on arrival, which here
 * is a screen with no report table, no ride chooser and no format chooser on
 * it. That is the state with the least to get wrong.
 *
 * This file covers the other one: a batch that has run, a report listing a
 * failure, a ride chooser with rides in it, and the format chooser beside it.
 * The filename convention is what puts it in `pnpm run test:a11y` — #142 made
 * the gate select on `*.a11y.test.*` precisely so a file like this one is
 * picked up with no CI edit.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { unixSeconds } from '@onyourleft/domain';
import { activityId, type ActivityId } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  rideFor,
  seedAthletes,
  streamSetFor,
  type StoreHarness,
} from '@onyourleft/store/testing';

import { auditAccessibility, formatViolations, tabbableElements } from '../a11y/audit';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';

import { webCryptoDigest } from './browser';
import type { AccountStore, DownloadableFile, TransferPort, TransferStore } from './store-port';
import { syntheticGpx } from './testing';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

let mounted: Mounted | undefined;
let harness: StoreHarness | undefined;

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  await harness?.destroy();
  harness = undefined;
  globalThis.location.hash = '';
});

async function openBusyScreen(): Promise<void> {
  const open = createStoreHarness();
  harness = open;
  await seedAthletes(open);
  const ride = rideFor(ATHLETE_A, { name: 'Sunday loop', hasPosition: true });
  await open.write(async (store) => {
    await store.putActivity(ride);
    await store.putStreamSet(streamSetFor(ride, { sampleCount: 30 }));
  });
  const store: TransferStore & AccountStore = await open.write((handle) => Promise.resolve(handle));
  let next = 0;
  const saved: DownloadableFile[] = [];
  const port: TransferPort = {
    store,
    athleteId: ATHLETE_A,
    newActivityId: (): ActivityId => {
      next += 1;
      return activityId(`a11y-${String(next)}`);
    },
    now: () => unixSeconds(1_760_000_000),
    timeZone: 'Europe/London',
    digest: webCryptoDigest,
    save: (file) => saved.push(file),
  };

  globalThis.location.hash = '#/transfer';
  mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} transfer={port} />);
  await settle();

  const input = document.querySelector<HTMLInputElement>('#oyl-import-files');
  if (input === null) {
    throw new Error('the import file input is not on the page');
  }
  const files = [
    new File([syntheticGpx(1)], 'good.gpx'),
    new File(['not a ride at all'], 'notes.txt'),
  ];
  const list: FileList = {
    length: files.length,
    item: (index: number): File | null => files[index] ?? null,
    [Symbol.iterator]: () => files[Symbol.iterator](),
    ...Object.fromEntries(files.map((file, index) => [index, file])),
  };
  Object.defineProperty(input, 'files', { value: list, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();

  const importButton = queryAll<HTMLButtonElement>(document.body, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Import '),
  );
  if (importButton === undefined) {
    throw new Error('the import button is not on the page');
  }
  await activateWithKeyboard(importButton);
  for (let turn = 0; turn < 200; turn += 1) {
    if ((document.querySelector('[role="status"]')?.textContent ?? '').includes('Finished')) {
      break;
    }
    await settle();
  }
}

describe('the transfer screen, mid-work', () => {
  it('has no accessibility violation with a report and both choosers on screen', async () => {
    await openBusyScreen();

    // The state is the point: a table of results including a failure, a ride
    // chooser, a format chooser and an export button are all rendered here and
    // none of them exists on the empty screen `routes.a11y.test.tsx` audits.
    expect(document.querySelector('table')).not.toBeNull();
    expect(document.querySelector('#oyl-export-format')).not.toBeNull();

    const violations = auditAccessibility(document);
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it('leaves every control on it reachable by keyboard', async () => {
    await openBusyScreen();

    const main = document.querySelector('main');
    if (main === null) {
      throw new Error('the shell rendered no main landmark');
    }
    const controls = tabbableElements(main);
    // Not a smoke test on a count: each one is focused, and a control that
    // cannot take focus is one only a pointer can reach.
    expect(controls.length).toBeGreaterThan(3);
    for (const control of controls) {
      control.focus();
      expect(document.activeElement).toBe(control);
    }
  });
});
