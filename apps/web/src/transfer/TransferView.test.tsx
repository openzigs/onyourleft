// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The screen itself: what a rider can do with a keyboard, what they are told
 * while it runs, and what they are told about each file afterwards.
 *
 * The store under it is the **real** one — `@onyourleft/store`'s activity store
 * over `fake-indexeddb`, seeded through the round-trip harness — so an
 * assertion that a ride can be exported is an assertion about a ride that was
 * written to a database and read back, not about a fixture the view was handed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';

import { webCryptoDigest } from './browser';
import type { DownloadableFile, TransferPort, TransferStore } from './store-port';
import { syntheticGpx } from './testing';
import { TransferView } from './TransferView';

let mounted: Mounted | undefined;
let harness: StoreHarness | undefined;
let saved: DownloadableFile[] = [];

beforeEach(() => {
  saved = [];
});

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  await harness?.destroy();
  harness = undefined;
});

/** A port over the real store, with the two browser side effects captured. */
async function openPort(): Promise<TransferPort> {
  const open = createStoreHarness();
  harness = open;
  await seedAthletes(open);
  const store: TransferStore = await open.write((handle) => Promise.resolve(handle));
  let next = 0;
  return {
    store,
    athleteId: ATHLETE_A,
    newActivityId: (): ActivityId => {
      next += 1;
      return activityId(`ui-${String(next)}`);
    },
    now: () => unixSeconds(1_760_000_000),
    timeZone: 'Europe/London',
    digest: webCryptoDigest,
    save: (file) => saved.push(file),
  };
}

/**
 * A `FileList` jsdom will not build for us.
 *
 * `DataTransfer` is the browser's way to make one and jsdom does not implement
 * it usefully, so this is the smallest object that satisfies everything
 * `sourcesOf` does with one: a length, an index, and iteration.
 */
function fileListOf(files: readonly File[]): FileList {
  return {
    length: files.length,
    item: (index: number): File | null => files[index] ?? null,
    [Symbol.iterator]: () => files[Symbol.iterator](),
    ...Object.fromEntries(files.map((file, index) => [index, file])),
  };
}

/** A `File` carrying the archive path a directory picker would report. */
function fileOf(path: string, contents: string): File {
  const name = path.split('/').pop() ?? path;
  const file = new File([contents], name, { type: 'application/octet-stream' });
  Object.defineProperty(file, 'webkitRelativePath', { value: path.includes('/') ? path : '' });
  return file;
}

async function choose(files: readonly File[]): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('#oyl-import-files');
  if (input === null) {
    throw new Error('the import file input is not on the page');
  }
  Object.defineProperty(input, 'files', { value: fileListOf(files), configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
}

function buttonNamed(text: string): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>(document.body, 'button').find((button) =>
    (button.textContent ?? '').includes(text),
  );
  if (found === undefined) {
    throw new Error(
      `no button whose label contains “${text}”; the page has ` +
        queryAll<HTMLButtonElement>(document.body, 'button')
          .map((button) => `“${button.textContent ?? ''}”`)
          .join(', '),
    );
  }
  return found;
}

function statusText(): string {
  return document.querySelector('[role="status"]')?.textContent ?? '';
}

/**
 * Turn the loop until the screen says what is being waited for.
 *
 * One `settle` is enough for a component whose effect resolves a single
 * promise, and nowhere near enough for a batch that reads a file, hashes it
 * with Web Crypto, decodes it and writes two IndexedDB transactions — per
 * source.
 *
 * ⚠️ **Repeated `settle` calls, and not one long `act` scope with the timers
 * inside it.** The single-scope version is the obvious shape and it does not
 * work: React does not flush a state update queued inside an `act` callback
 * until that callback returns, so a loop that waits *inside* one for the screen
 * to change waits for something that cannot happen until it stops. It fails as
 * a timeout, which reads exactly like a hung import. Each `settle` opens and
 * closes its own scope, and closing is what flushes.
 */
async function runToCompletion(ready: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 200; turn += 1) {
    if (ready()) {
      return;
    }
    await settle();
  }
  throw new Error(`gave up waiting for ${what}; the status line said “${statusText()}”`);
}

/** Whether the import panel is reporting a finished batch. */
function finished(): boolean {
  return statusText().includes('Finished');
}

describe('TransferView — without a port', () => {
  it('renders no import control at all, and says why', async () => {
    mounted = await mount(<TransferView />);

    // #48 criterion 1: a control that cannot work is not rendered, disabled or
    // otherwise. There is no file input and no import button on this page.
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(queryAll<HTMLButtonElement>(document.body, 'button')).toHaveLength(0);
    expect(document.body.textContent).toContain('Web Crypto');
  });
});

describe('TransferView — importing', () => {
  it('imports the chosen files and lists every one of them by name', async () => {
    const port = await openPort();
    mounted = await mount(<TransferView port={port} />);

    await choose([
      fileOf('activities/first.gpx', syntheticGpx(1)),
      fileOf('activities/notes.txt', 'this is not a ride'),
      fileOf('activities/second.gpx', syntheticGpx(2)),
    ]);
    await activateWithKeyboard(buttonNamed('Import 3 files'));
    await runToCompletion(finished, 'the batch to finish');

    const text = document.body.textContent ?? '';
    // By the name the rider sees in their archive, path and all.
    expect(text).toContain('activities/first.gpx');
    expect(text).toContain('activities/notes.txt');
    expect(text).toContain('activities/second.gpx');
    expect(text).toContain('Not imported');
    // The batch did not stop at the bad file in the middle of it.
    const stored = await (harness ?? never()).read(async (store) =>
      store.listActivitySummaries(ATHLETE_A),
    );
    expect(stored).toHaveLength(2);
  });

  it('announces progress in a live region as the batch runs and when it finishes', async () => {
    const port = await openPort();
    mounted = await mount(<TransferView port={port} />);

    expect(statusText()).toContain('No files chosen');
    await choose([fileOf('one.gpx', syntheticGpx(3)), fileOf('two.gpx', syntheticGpx(4))]);
    expect(statusText()).toContain('2 files ready');

    await activateWithKeyboard(buttonNamed('Import 2 files'));
    await runToCompletion(finished, 'the batch to finish');

    // A counted sentence, in a `role="status"` region, so it is announced
    // rather than only drawn. #51 asks for progress that is visible; a bar is
    // invisible to a screen reader and to a DOM with no layout.
    expect(statusText()).toContain('Finished 2 of 2 files');
    expect(statusText()).toContain('two.gpx');
  });

  it('cancels a running batch from the keyboard and keeps what already landed', async () => {
    const port = await openPort();
    // A digest that stalls on the second file, so the batch is observably
    // mid-flight when Cancel is pressed rather than finished before the press.
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let call = 0;
    const stalling: TransferPort = {
      ...port,
      digest: async (bytes) => {
        call += 1;
        if (call === 2) {
          await held;
        }
        return webCryptoDigest(bytes);
      },
    };
    mounted = await mount(<TransferView port={stalling} />);

    await choose([
      fileOf('one.gpx', syntheticGpx(5)),
      fileOf('two.gpx', syntheticGpx(6)),
      fileOf('three.gpx', syntheticGpx(7)),
    ]);
    // Not before: a cancel control on a screen with nothing running is a
    // control that does nothing, which is what #48's first criterion rejects.
    expect(() => buttonNamed('Cancel import')).toThrow();

    await activateWithKeyboard(buttonNamed('Import 3 files'));
    await activateWithKeyboard(buttonNamed('Cancel import'));
    release?.();
    await runToCompletion(finished, 'the cancelled batch to report');

    const text = document.body.textContent ?? '';
    expect(text).toContain('Cancelled');
    // The first two were already in flight or done; the third was never
    // reached. What matters is that nothing is rolled back — the rides already
    // written are the rider's, and re-importing them costs as long again.
    const stored = await (harness ?? never()).read(async (store) =>
      store.listActivitySummaries(ATHLETE_A),
    );
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.length).toBeLessThan(3);
    // And the control is gone again, because nothing is running.
    expect(() => buttonNamed('Cancel import')).toThrow();
  });
});

describe('TransferView — exporting', () => {
  it('hands the browser a file for the ride the rider chose', async () => {
    const port = await openPort();
    const ride = rideFor(ATHLETE_A, { name: 'Sunday loop', hasPosition: true });
    await (harness ?? never()).write(async (store) => {
      await store.putActivity(ride);
      await store.putStreamSet(streamSetFor(ride, { sampleCount: 60 }));
    });

    mounted = await mount(<TransferView port={port} />);
    await runToCompletion(
      () => document.querySelector('#oyl-export-format') !== null,
      'the ride list to load',
    );

    expect(document.body.textContent).toContain('Sunday loop');

    await activateWithKeyboard(buttonNamed('Export'));
    await runToCompletion(() => saved.length > 0, 'the export to reach the browser');

    expect(saved).toHaveLength(1);
    expect(saved[0]?.fileName).toBe('Sunday loop.fit');
    expect(saved[0]?.bytes.byteLength).toBeGreaterThan(0);
    expect(document.body.textContent).toContain('Saved Sunday loop.fit');
  });

  it('says what a format cannot carry, from the codec’s own list', async () => {
    const port = await openPort();
    const ride = rideFor(ATHLETE_A, { name: 'Turbo' });
    await (harness ?? never()).write(async (store) => {
      await store.putActivity(ride);
      await store.putStreamSet(streamSetFor(ride, { sampleCount: 30 }));
    });
    mounted = await mount(<TransferView port={port} />);
    await runToCompletion(
      () => document.querySelector('#oyl-export-format') !== null,
      'the ride list to load',
    );

    const select = document.querySelector<HTMLSelectElement>('#oyl-export-format');
    if (select === null) {
      throw new Error('the format chooser is not on the page');
    }
    expect(document.body.textContent).toContain('FIT carries every channel');

    select.value = 'tcx';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    // Read out of `TCX_LOSSY_CHANNELS` rather than written here, so a codec
    // that starts carrying temperature changes this sentence without anyone
    // remembering to.
    expect(document.body.textContent).toContain('point.temperature');
  });

  it('reports a failed export without taking the page down', async () => {
    const port = await openPort();
    const ride = rideFor(ATHLETE_A, { name: 'No samples' });
    await (harness ?? never()).write(async (store) => store.putActivity(ride));
    mounted = await mount(<TransferView port={port} />);
    await runToCompletion(
      () => document.querySelector('#oyl-export-format') !== null,
      'the ride list to load',
    );

    await activateWithKeyboard(buttonNamed('Export'));
    await runToCompletion(
      () => (document.body.textContent ?? '').includes('was not exported'),
      'the refusal to be reported',
    );

    expect(saved).toHaveLength(0);
    expect(document.body.textContent).toContain('was not exported');
    expect(mounted.caughtErrors).toHaveLength(0);
  });
});

describe('TransferView — what it may say about another platform', () => {
  it('carries the approved nominative-use strings and the non-affiliation sentence', async () => {
    const port = await openPort();
    mounted = await mount(<TransferView port={port} />);
    const text = document.body.textContent ?? '';

    // ADR 0009 R3's approved strings, verbatim. Asserted here because R3 is a
    // template rather than a wording preference, and a reviewer checking a diff
    // for `strava` needs each hit to be an exact instance of it.
    expect(text).toContain(
      'Import a FIT, GPX or TCX file — including the bulk export from your Strava account.',
    );
    expect(text).toContain(
      'Imports activity files exported from Strava. On Your Left is not affiliated with, ' +
        'endorsed by, or derived from Strava or Zwift.',
    );
  });

  it('offers nothing that claims a connection to another platform, and links to the ADR', async () => {
    const port = await openPort();
    mounted = await mount(<TransferView port={port} />);
    const text = (document.body.textContent ?? '').toLowerCase();

    // ADR 0009 R3 item 3, and L1's "never as an adjective on one of our
    // features". "Sync with Strava" and "Connect to Strava" are false here as
    // well as risky: there is no connection to anything.
    for (const forbidden of [
      'strava sync',
      'sync with strava',
      'connect to strava',
      'strava import',
      'strava-compatible',
      'works with zwift',
    ]) {
      expect(text).not.toContain(forbidden);
    }
    const adrLink = queryAll<HTMLAnchorElement>(document.body, 'a').find((anchor) =>
      anchor.getAttribute('href')?.includes('0009-clean-room-posture'),
    );
    expect(adrLink).toBeDefined();
  });
});

/** The branch a `??` above an already-assigned harness cannot take. */
function never(): StoreHarness {
  throw new Error('the harness is opened by openPort before any test body reaches this');
}
