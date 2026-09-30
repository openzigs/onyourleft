// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The goals box and a ride's note box (#836), over the REAL store: what they
 * read, that a save is what a fresh connection reads back, that an emptied box
 * deletes, the limit in characters, and ADR 0040 D-11's disclosure beside
 * both — kept visible (#666).
 */

import { unixSeconds } from '@onyourleft/domain';
import { MAXIMUM_GOALS_CHARACTERS, MAXIMUM_RIDE_NOTE_CHARACTERS } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  indexedDbStoreFactory,
  seedAthletes,
  seedRide,
  type PersistentStore,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { mount, settle, submitForm, typeIntoTextArea, type Mounted } from '../testing/mount';
import {
  RIDER_TEXT_DISCLOSURE_DETAIL,
  RIDER_TEXT_DISCLOSURE_LEAD,
  RIDER_TEXT_MODEL_WARNING,
} from './disclosure';
import type { RiderTextPort } from './rider-text-port';
import {
  RIDER_TEXT_NO_STORE,
  RIDER_TEXT_NOT_READ,
  RiderTextBox,
  riderTextCount,
  riderTextSaveFailure,
  riderTextTooLong,
} from './RiderTextBox';
import { memoryRiderText } from './testing';
import { GOALS_WORDS, NOTE_WORDS } from './words';

let harness: StoreHarness;
let writer: PersistentStore;
let mounted: Mounted | undefined;

beforeEach(async () => {
  harness = createStoreHarness();
  await seedAthletes(harness);
  writer = indexedDbStoreFactory.open(harness.databaseName);
});

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  writer.close();
  await harness.destroy();
});

function portOver(store: PersistentStore): RiderTextPort {
  return {
    store,
    athleteId: ATHLETE_A,
    now: () => unixSeconds(1_790_000_000),
    newDocumentId: () => 'unused',
  };
}

async function openGoals(port: RiderTextPort | undefined): Promise<void> {
  document.documentElement.lang = 'en';
  mounted = await mount(
    <main>
      <h1>Settings</h1>
      <RiderTextBox
        port={port}
        kind="goal"
        textKey="goals"
        maximum={MAXIMUM_GOALS_CHARACTERS}
        words={GOALS_WORDS}
        headingLevel={2}
      />
    </main>,
  );
  await settle();
  await settle();
}

async function openNote(port: RiderTextPort, ride: string): Promise<void> {
  document.documentElement.lang = 'en';
  mounted = await mount(
    <main>
      <h1>Rides</h1>
      <h2>A ride</h2>
      <RiderTextBox
        port={port}
        kind="note"
        textKey={ride}
        maximum={MAXIMUM_RIDE_NOTE_CHARACTERS}
        words={NOTE_WORDS}
        headingLevel={3}
      />
    </main>,
  );
  await settle();
  await settle();
}

function box(): HTMLTextAreaElement {
  const found = document.querySelector('textarea');
  if (found === null) throw new Error('no text box');
  return found;
}

async function save(value: string): Promise<void> {
  await typeIntoTextArea(box(), value);
  const form = box().form;
  if (form === null) throw new Error('no form');
  await submitForm(form);
  await settle();
  await settle();
}

function status(): string {
  return document.querySelector('[role="status"], [role="alert"]')?.textContent ?? '';
}

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`).toBe('');
}

describe('the goals box (#836)', () => {
  it('saves what a fresh connection reads back, and shows what landed', async () => {
    await openGoals(portOver(writer));
    expect(box().value).toBe('');
    expectClean('an empty goals box');
    await save('  A century in June.\r\nEasy days easy. ');
    expect(status()).toContain(GOALS_WORDS.saved);
    expect(box().value).toBe('A century in June.\nEasy days easy.');
    const onDisk = await harness.read(async (fresh) =>
      fresh.getRiderText(ATHLETE_A, 'goal', 'goals'),
    );
    expect(onDisk?.text).toBe('A century in June.\nEasy days easy.');
    expectClean('a saved goals box');
  });

  it('reads the saved goals when it opens', async () => {
    await writer.putRiderText({
      athleteId: ATHLETE_A,
      kind: 'goal',
      key: 'goals',
      text: 'Ride to the coast.',
      savedAt: unixSeconds(1),
    });
    await openGoals(portOver(writer));
    expect(box().value).toBe('Ride to the coast.');
    expect(document.body.textContent).toContain(riderTextCount(18, MAXIMUM_GOALS_CHARACTERS));
  });

  it('deletes the goals when the box is emptied and saved', async () => {
    await writer.putRiderText({
      athleteId: ATHLETE_A,
      kind: 'goal',
      key: 'goals',
      text: 'Ride to the coast.',
      savedAt: unixSeconds(1),
    });
    await openGoals(portOver(writer));
    await save('   ');
    expect(status()).toContain(GOALS_WORDS.cleared);
    expect(
      await harness.read(async (fresh) => fresh.getRiderText(ATHLETE_A, 'goal', 'goals')),
    ).toBeUndefined();
  });

  it('refuses over the limit, says so in characters, and writes nothing', async () => {
    await openGoals(portOver(writer));
    await save('x'.repeat(MAXIMUM_GOALS_CHARACTERS + 1));
    expect(status()).toContain(riderTextTooLong(MAXIMUM_GOALS_CHARACTERS));
    expect(status()).toContain('4,000 characters');
    // What was typed is still there to shorten — never cut.
    expect(box().value).toHaveLength(MAXIMUM_GOALS_CHARACTERS + 1);
    expect(
      await harness.read(async (fresh) => fresh.getRiderText(ATHLETE_A, 'goal', 'goals')),
    ).toBeUndefined();
  });

  it('says a failed save failed, and claims nothing', async () => {
    const memory = memoryRiderText([], ATHLETE_A);
    await openGoals(memory.port);
    memory.failNext = new Error('the disk is full');
    await save('A century.');
    expect(status()).toContain(riderTextSaveFailure('the disk is full'));
    expect(memory.kept.size).toBe(0);
  });

  it('shows ADR 0040 D-11’s disclosure beside the box, kept visible, with or without a store', async () => {
    for (const port of [portOver(writer), undefined]) {
      await openGoals(port);
      const kept = document.querySelector('[data-oyl-kept-visible]');
      for (const sentence of [
        RIDER_TEXT_DISCLOSURE_LEAD,
        RIDER_TEXT_DISCLOSURE_DETAIL,
        RIDER_TEXT_MODEL_WARNING,
      ]) {
        expect(kept?.textContent).toContain(sentence);
      }
      expect(kept?.closest('details')).toBeNull();
      mounted?.unmount();
      mounted = undefined;
    }
  });

  it('offers no box without a store, and says why', async () => {
    await openGoals(undefined);
    expect(document.body.textContent).toContain(RIDER_TEXT_NO_STORE);
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('offers nothing to overwrite when the saved goals cannot be read', async () => {
    await openGoals({
      ...memoryRiderText().port,
      store: {
        ...memoryRiderText().port.store,
        getRiderText: async () => Promise.reject(new Error('blocked')),
      },
    });
    expect(document.body.textContent).toContain(RIDER_TEXT_NOT_READ);
    expect(document.querySelector('textarea')).toBeNull();
  });
});

describe('a ride’s note box (#836)', () => {
  it('keeps a note of up to 900 characters on the ride, and refuses one more', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    await openNote(portOver(writer), ride.id);
    expect(document.querySelector('h3')?.textContent).toBe(NOTE_WORDS.heading);
    await save('y'.repeat(MAXIMUM_RIDE_NOTE_CHARACTERS));
    expect(status()).toContain(NOTE_WORDS.saved);
    await save('z'.repeat(MAXIMUM_RIDE_NOTE_CHARACTERS + 1));
    expect(status()).toContain(riderTextTooLong(MAXIMUM_RIDE_NOTE_CHARACTERS));
    const onDisk = await harness.read(async (fresh) =>
      fresh.getRiderText(ATHLETE_A, 'note', ride.id),
    );
    expect(onDisk?.text).toBe('y'.repeat(MAXIMUM_RIDE_NOTE_CHARACTERS));
    expectClean('a note box');
  });
});
