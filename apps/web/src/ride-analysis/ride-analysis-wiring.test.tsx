// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **The post-ride ask, wired the way `main.tsx` wires it** (#804).
 *
 * `check:wiring` sees that the port's methods have a production caller, and
 * nothing more: the page is handed the port as an OPTIONAL prop, and a
 * `main.tsx` that stopped passing it would be green there (docs/agents/wiring-gate.md §4j
 * §Limits). So this renders the real `AppShell` at the real detail route,
 * handed a port built from the same functions with the same arguments as
 * `main.tsx` §`buildRideAnalysis` — `riderModelStepSource` over a scripted
 * model server, `createRideAnalysis` over the real store — presses the real
 * button and reads the write-up back on a fresh connection.
 * `ride-analysis.test.ts` §"main.tsx builds that port" holds `main.tsx` to
 * building and passing exactly that — in a Node file, because the source
 * scan needs the file system and this one runs in jsdom.
 */

import { unixSeconds } from '@onyourleft/domain';
import type { ActivityId, RideWriteUpRecord } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  indexedDbStoreFactory,
  seedAthletes,
  seedRide,
  streamSetFor,
  type PersistentStore,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { endpointDecision, type AnalysisEndpoint } from '../camera/analysis-endpoint';
import { riderModelStepSource, type NativeAnalysisPost } from '../camera/analysis-transport';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';
import { modelServer, REPLY_MARKER, STILL_CLOCK, type ModelServer } from './model-server-testing';
import { createRideAnalysis } from './ride-analysis';
import type { RideAnalysisPort } from './ride-analysis-port';
import { ASK_LABEL, WRITE_UP_HEADING, WRITE_UP_SAVED } from './RideWriteUpControl';
import { RUN_FAILURE_TEXT } from './runner';
import {
  WRITE_UP_EARLIER,
  WRITE_UP_FRAMING_LEAD,
  WRITE_UP_NOT_ASKED,
  WRITE_UP_SET_UP_BEFORE,
} from '../detail/write-up';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

function endpoint(): AnalysisEndpoint {
  const decision = endpointDecision({
    address: 'http://192.168.1.20:8080',
    model: 'text-7b',
    switchedOn: true,
  });
  if (decision.endpoint === undefined) {
    throw new Error('fixture endpoint refused');
  }
  return decision.endpoint;
}

let harness: StoreHarness;
let store: PersistentStore;
let server: ModelServer;
let mounted: Mounted | undefined;

beforeEach(async () => {
  harness = createStoreHarness();
  await seedAthletes(harness);
  store = indexedDbStoreFactory.open(harness.databaseName);
  server = modelServer();
});

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
  store.close();
  await harness.destroy();
});

/** The port, built as `main.tsx` §`buildRideAnalysis` builds it. */
async function builtAsMainBuildsIt(
  nativeShell = false,
  native?: NativeAnalysisPost,
  setUp: () => AnalysisEndpoint | undefined = endpoint,
): Promise<RideAnalysisPort> {
  const computer = await riderModelStepSource(
    nativeShell,
    async () =>
      native === undefined ? Promise.reject(new Error('no native here')) : Promise.resolve(native),
    setUp,
    server.send,
  );
  return createRideAnalysis({
    store,
    athleteId: ATHLETE_A,
    computer,
    nativeShell,
    cameraConsented: () => false,
    clock: STILL_CLOCK,
    now: () => unixSeconds(1_800_000_000),
  });
}

async function seededRide(): Promise<ActivityId> {
  const ride = await seedRide(harness, ATHLETE_A);
  await harness.write(async (writer) =>
    writer.putStreamSet(streamSetFor(ride, { sampleCount: 1800 })),
  );
  return ride.id;
}

async function openShell(path: string, rideAnalysis: RideAnalysisPort): Promise<void> {
  globalThis.location.hash = `#${path}`;
  mounted = await mount(
    <AppShell
      capabilities={NO_BLUETOOTH}
      detail={{ store, athleteId: ATHLETE_A }}
      rideAnalysis={rideAnalysis}
    />,
  );
  await settle();
}

/** Settle until `done` holds; a real store is a chain of IndexedDB tasks. */
async function until(done: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (done()) {
      return;
    }
    await settle();
  }
  throw new Error(`never: ${what}`);
}

function askButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === ASK_LABEL.computer.first,
  );
}

function liveRegion(): string {
  return document.querySelector('[role="status"][aria-live="polite"]')?.textContent ?? '';
}

/** Whether the page shows the server's current summary as the write-up (#805). */
function writeUpShown(): boolean {
  return document.querySelector('.oyl-write-up__text')?.textContent === server.summary;
}

async function savedWriteUp(id: ActivityId): Promise<RideWriteUpRecord | undefined> {
  return harness.read(async (reader) => reader.getRideWriteUp(ATHLETE_A, id));
}

describe('the real detail route, with the port main.tsx builds', () => {
  it('sends nothing on app open or page open, and one press writes the ride up', async () => {
    const id = await seededRide();
    const port = await builtAsMainBuildsIt();

    // App open, on Home.
    await openShell('/', port);
    expect(server.requests).toHaveLength(0);
    mounted?.unmount();

    // Page open.
    await openShell(`/activities/${id}`, port);
    await until(() => askButton() !== undefined, 'the ask button appears');
    expect(document.body.textContent).toContain(WRITE_UP_HEADING);
    expect(server.requests).toHaveLength(0);

    // The press.
    await activateWithKeyboard(askButton() as HTMLButtonElement);
    await until(() => liveRegion() === WRITE_UP_SAVED, 'the write-up is saved');
    await until(() => writeUpShown(), 'the write-up is shown');
    expect(server.requests.length).toBeGreaterThan(0);

    const saved = await savedWriteUp(id);
    expect(saved?.text).toBe(server.summary);
    expect(saved?.source).toBe('computer');
    // Nothing of a raw reply outside its validated field reached the row or the page.
    expect(JSON.stringify(saved)).not.toContain(REPLY_MARKER);
    expect(document.body.innerHTML).not.toContain(REPLY_MARKER);
  });

  it('shows the saved write-up on the page, framed, once it is written (#805)', async () => {
    const id = await seededRide();
    await openShell(`/activities/${id}`, await builtAsMainBuildsIt());
    await until(() => askButton() !== undefined, 'the ask button appears');
    expect(document.body.textContent).toContain(WRITE_UP_NOT_ASKED);
    await activateWithKeyboard(askButton() as HTMLButtonElement);
    await until(
      () => document.querySelector('.oyl-write-up__text')?.textContent === server.summary,
      'the write-up is shown',
    );
    expect(document.body.textContent).toContain(WRITE_UP_FRAMING_LEAD);
    expect(document.body.textContent).not.toContain(WRITE_UP_NOT_ASKED);
  });

  it('keeps the earlier write-up when a new run is withheld, and says why above it (#805, the owner’s ruling)', async () => {
    const id = await seededRide();
    const port = await builtAsMainBuildsIt();
    await openShell(`/activities/${id}`, port);
    await until(() => askButton() !== undefined, 'the ask button appears');
    await activateWithKeyboard(askButton() as HTMLButtonElement);
    await until(() => liveRegion() === WRITE_UP_SAVED, 'the first write-up is saved');
    await until(() => writeUpShown(), 'the first write-up is shown');
    const first = await savedWriteUp(id);

    // Every summary and every rewrite now states an angle, so the screen
    // withholds the run twice and nothing is kept.
    server.summary = 'Your knee opened to 142° at the bottom of the stroke.';
    await activateWithKeyboard(askButton() as HTMLButtonElement);
    await until(
      () => liveRegion() === RUN_FAILURE_TEXT['withheld-by-screen'],
      'the run is withheld',
    );
    expect(await savedWriteUp(id)).toStrictEqual(first);
    const quote = document.querySelector('.oyl-write-up__text');
    expect(quote?.textContent).toBe(first?.text);
    expect(document.body.textContent).toContain(WRITE_UP_EARLIER);
    expect(document.body.textContent).not.toContain('142°');
    const status = document.querySelector('[role="status"][aria-live="polite"]');
    expect(
      (status?.compareDocumentPosition(quote as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it('with no model set up, is today’s page and one sentence, and sends nothing (#805’s fallback)', async () => {
    const id = await seededRide();
    const port = await builtAsMainBuildsIt(false, undefined, () => undefined);
    await openShell(`/activities/${id}`, port);
    await until(
      () => document.body.textContent.includes(WRITE_UP_SET_UP_BEFORE),
      'the set-up sentence appears',
    );
    expect(document.body.textContent).not.toContain(WRITE_UP_HEADING);
    expect(askButton()).toBeUndefined();
    // The page goes on to read its traces; let it finish before the store
    // closes, and count again after, so a late request is counted too.
    for (let turn = 0; turn < 40; turn += 1) {
      await settle();
    }
    expect(server.requests).toHaveLength(0);
  });

  it('goes through the native request inside the shell, and never through fetch', async () => {
    const id = await seededRide();
    let natives = 0;
    const native: NativeAnalysisPost = async (request) => {
      natives += 1;
      const response = await server.send('unused', {
        method: 'POST',
        body: JSON.stringify(request.json),
      });
      return { status: response.status, body: await response.text() };
    };
    const port = await builtAsMainBuildsIt(true, native);
    await openShell(`/activities/${id}`, port);
    await until(() => askButton() !== undefined, 'the ask button appears');
    const fetchedBefore = server.requests.length;
    await activateWithKeyboard(askButton() as HTMLButtonElement);
    await until(() => liveRegion() === WRITE_UP_SAVED, 'the write-up is saved');
    // #805: the page reads the new write-up back; let it, before the store closes.
    await until(() => writeUpShown(), 'the write-up is shown');
    // Every request the server saw came through the native double.
    expect(natives).toBe(server.requests.length - fetchedBefore);
    expect((await savedWriteUp(id))?.text).toBe(server.summary);
  });
});
