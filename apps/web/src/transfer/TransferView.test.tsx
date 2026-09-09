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

import {
  activateWithKeyboard,
  mount,
  queryAll,
  settle,
  typeInto,
  type Mounted,
} from '../testing/mount';

import { webCryptoDigest } from './browser';
import type { AccountStore, DownloadableFile, TransferPort, TransferStore } from './store-port';
import { syntheticGpx } from './testing';
import { TransferView } from './TransferView';

let mounted: Mounted | undefined;
let harness: StoreHarness | undefined;
let saved: DownloadableFile[] = [];
/** What an erase forgot outside the store — the `localStorage` route draft. */
let forgotten: string[] = [];

beforeEach(() => {
  saved = [];
  forgotten = [];
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
  const store: TransferStore & AccountStore = await open.write((handle) => Promise.resolve(handle));
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
    drafts: { forget: () => forgotten.push('draft') },
    athleteRow: { id: ATHLETE_A, displayName: 'You', createdAt: unixSeconds(1_760_000_000) },
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

async function choose(files: readonly File[], selector = '#oyl-import-files'): Promise<void> {
  const input = document.querySelector<HTMLInputElement>(selector);
  if (input === null) {
    throw new Error(`the import input ${selector} is not on the page`);
  }
  Object.defineProperty(input, 'files', { value: fileListOf(files), configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
}

/** The same, through the folder picker — the one that reports archive paths. */
async function chooseFolder(files: readonly File[]): Promise<void> {
  await choose(files, '#oyl-import-folder');
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
  it('imports a chosen folder and lists every one of its files by archive path', async () => {
    const port = await openPort();
    mounted = await mount(<TransferView port={port} />);

    // Through the folder input, which is the control that reports a file under
    // its path inside the archive. The plain file picker beside it has its own
    // test below; the two differ only in what `sourcesOf` reads the name from.
    await chooseFolder([
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

  it('names a file from the plain picker by its bare name, with no relative path', async () => {
    const port = await openPort();
    mounted = await mount(<TransferView port={port} />);

    // ⚠️ A bare `new File`, with `webkitRelativePath` left alone rather than
    // defined — which is what the plain picker produces, and also what jsdom
    // produces, because it does not implement that non-standard attribute at
    // all. `lib.dom.d.ts` types it as a `string`, so a `=== ''` comparison
    // typechecks, is `false` for `undefined`, and imports the ride under the
    // filename `undefined` — reported to the rider under that name and written
    // into `originalFile.key` under it too.
    await choose([new File([syntheticGpx(12)], 'good.gpx')]);
    await activateWithKeyboard(buttonNamed('Import 1 file'));
    await runToCompletion(finished, 'the batch to finish');

    const text = document.body.textContent ?? '';
    expect(text).toContain('good.gpx');
    expect(text).not.toContain('undefined');

    const stored = await (harness ?? never()).read(async (store) => {
      const summaries = await store.listActivitySummaries(ATHLETE_A);
      const first = summaries[0];
      return first === undefined ? undefined : store.getActivity(ATHLETE_A, first.id);
    });
    expect(stored?.originalFile?.key).toBe('good.gpx');
  });

  it('offers a folder picker, and filters nothing out of what a rider selects', async () => {
    const port = await openPort();
    mounted = await mount(<TransferView port={port} />);

    // The attribute that makes `webkitRelativePath` non-empty, and therefore
    // the one that makes the archive-path branch in `sourcesOf` reachable at
    // all. Without it that branch is code no rider can execute, and the test
    // above would be asserting on a `File` shape the shipped UI never produces.
    const folder = document.querySelector<HTMLInputElement>('#oyl-import-folder');
    expect(folder?.hasAttribute('webkitdirectory')).toBe(true);
    expect(folder?.multiple).toBe(true);

    // And neither input filters by extension. #51's second criterion is that a
    // file this client cannot decode is *reported*, by name — which needs the
    // rider to be able to select it in the first place.
    for (const selector of ['#oyl-import-files', '#oyl-import-folder']) {
      expect(document.querySelector(selector)?.hasAttribute('accept')).toBe(false);
    }
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

/**
 * The sibling-refresh case: one screen that both writes and reads the same
 * store.
 *
 * Every other export test here seeds its ride **before** mounting, and that is
 * the one ordering under which a stale read is invisible. This one performs the
 * write through the UI and then asserts on the *other* panel, which is where
 * CLAUDE.md §5's defect shape shows up a layer above the store: the ride is on
 * disk, `getActivity` would return it, and the page still says there is nothing
 * to export. Anything added here that writes and reads the same store wants a
 * test of this shape.
 */
describe('TransferView — the two panels over one store', () => {
  it('offers a freshly imported ride for export, without a reload', async () => {
    const port = await openPort();
    mounted = await mount(<TransferView port={port} />);

    // Nothing on disk, so there is no chooser and the page says why.
    expect(document.querySelector('#oyl-export-ride')).toBeNull();
    expect(document.body.textContent).toContain('There are no rides on this device yet');

    await choose([fileOf('activities/brought-across.gpx', syntheticGpx(11))]);
    await activateWithKeyboard(buttonNamed('Import 1 file'));
    await runToCompletion(finished, 'the batch to finish');

    await runToCompletion(
      () => document.querySelector('#oyl-export-ride') !== null,
      'the export chooser to notice the imported ride',
    );
    // The page no longer contradicts itself.
    expect(document.body.textContent).not.toContain('There are no rides on this device yet');
    const chooser = document.querySelector<HTMLSelectElement>('#oyl-export-ride');
    expect(queryAll<HTMLOptionElement>(chooser ?? document.body, 'option')).toHaveLength(1);
    expect(chooser?.textContent).toContain('Ride 11');

    // And it is selectable and exportable in the same visit, which is the whole
    // point of noticing: an import followed by an export is one session.
    await activateWithKeyboard(buttonNamed('Export'));
    await runToCompletion(() => saved.length > 0, 'the export to reach the browser');
    expect(saved[0]?.fileName).toBe('Ride 11.fit');

    // Read back on a connection this component never wrote through, last,
    // because `read()` closes the handle the port is holding.
    const stored = await (harness ?? never()).read(async (store) =>
      store.listActivitySummaries(ATHLETE_A),
    );
    expect(stored).toHaveLength(1);
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

  it('tells the rider when the file could not carry everything (#162)', async () => {
    const port = await openPort();
    // 1970, so no instant in the ride has a FIT representation. The encoder
    // writes the file and reports what it dropped; before #162 this screen
    // took the bytes and threw the report away, so a rider was told "Saved"
    // and nothing else.
    const startedAt = unixSeconds(0);
    const ride = { ...rideFor(ATHLETE_A, { name: 'Dead clock', hasPosition: true }), startedAt };
    await (harness ?? never()).write(async (store) => {
      await store.putActivity(ride);
      await store.putStreamSet(streamSetFor(ride, { sampleCount: 60, startedAt }));
    });

    mounted = await mount(<TransferView port={port} />);
    await runToCompletion(
      () => document.querySelector('#oyl-export-format') !== null,
      'the ride list to load',
    );
    await activateWithKeyboard(buttonNamed('Export'));
    await runToCompletion(() => saved.length > 0, 'the export to reach the browser');

    // The file still saved. A lossy file is still the file the rider asked for.
    expect(saved).toHaveLength(1);
    expect(saved[0]?.fileName).toBe('Dead clock.fit');
    // And they are told, in the same place they are told it worked.
    expect(document.body.textContent).toContain('Saved Dead clock.fit');
    expect(document.body.textContent).toContain('not everything fitted in the file');
    expect(document.body.textContent).toContain('a timestamp this format cannot hold');
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
  it('takes every ride and a manifest in one press', async () => {
    const port = await openPort();
    for (const name of ['One', 'Two', 'Three']) {
      const ride = rideFor(ATHLETE_A, { name, hasPosition: true });
      await (harness ?? never()).write(async (store) => {
        await store.putActivity(ride);
        await store.putStreamSet(streamSetFor(ride, { sampleCount: 30 }));
      });
    }

    mounted = await mount(<TransferView port={port} />);
    await runToCompletion(
      () => document.querySelector('#oyl-everything-format') !== null,
      'the export-everything panel to render',
    );
    await activateWithKeyboard(buttonNamed('Export everything'));
    await runToCompletion(() => saved.length >= 4, 'the archive to reach the browser');

    // Three rides and the manifest, and the manifest is last so it can name
    // what was actually written.
    expect(saved).toHaveLength(4);
    expect(saved.at(-1)?.fileName).toBe('on-your-left-account.json');
    expect(document.body.textContent).toContain('Saved 3 rides');
  });

  it('says what the archive contains before the rider presses anything', async () => {
    const port = await openPort();
    mounted = await mount(<TransferView port={port} />);
    await settle();

    // #34's revision block and ADR 0004: this archive is a concentration of
    // exactly the data a privacy zone protects, and a rider about to put it in
    // a cloud folder is owed the sentence beforehand.
    expect(document.body.textContent).toContain('centres of your privacy zones');
    expect(document.body.textContent).toContain('private key is never written');
  });

  it('will not erase without the typed phrase, and then does', async () => {
    const port = await openPort();
    const ride = rideFor(ATHLETE_A, { name: 'Last one', hasPosition: true });
    await (harness ?? never()).write(async (store) => {
      await store.putActivity(ride);
      await store.putStreamSet(streamSetFor(ride, { sampleCount: 20 }));
    });

    mounted = await mount(<TransferView port={port} />);
    await runToCompletion(
      () => document.querySelector('#oyl-erase-confirm') !== null,
      'the erase panel to render',
    );

    // Pressing it with an empty box does nothing but say why.
    //
    // ⚠️ No `harness.read` here, deliberately. That primitive **discards every
    // open handle** before it opens a fresh one — which is what makes it an
    // honest round trip, and which would close the handle this mounted
    // component is still holding through `port.store`. The next store call from
    // the page would then reject with `DatabaseClosedError`, and the test would
    // be reporting a fault it caused. The fresh-connection read is at the end,
    // after the component is finished with.
    await activateWithKeyboard(buttonNamed('Erase everything'));
    await settle();
    expect(document.body.textContent).toContain('to confirm');

    const box = document.querySelector<HTMLInputElement>('#oyl-erase-confirm');
    if (box === null) {
      throw new Error('the confirmation box is not on the page');
    }
    // `typeInto` rather than assigning `.value`: React tracks a controlled
    // input through its own value setter, so a direct assignment updates the
    // DOM and leaves the component's state behind.
    await typeInto(box, 'erase everything');
    await activateWithKeyboard(buttonNamed('Erase everything'));
    await runToCompletion(
      () => (document.body.textContent ?? '').includes('holds nothing about you'),
      'the erase to finish',
    );

    // Now, and only now, read back through a connection nothing on the page
    // is holding — the ride has to be gone from disk rather than from a
    // component's state.
    mounted.unmount();
    mounted = undefined;
    expect(
      await (harness ?? never()).read(async (store) => store.listActivitySummaries(ATHLETE_A)),
    ).toStrictEqual([]);
  });

  it('says what erasing cannot reach, and names the signing key, before the button', async () => {
    const port = await openPort();
    mounted = await mount(<TransferView port={port} />);
    await settle();

    // #35: a dialogue that implies more than the architecture can deliver is
    // the worst outcome. These are the three sentences that stop it doing that.
    expect(document.body.textContent).toContain('nowhere else to ask');
    expect(document.body.textContent).toContain('already exported');
    expect(document.body.textContent).toContain('signs as a new identity');
  });

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
