// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The words-to-mask panel (#839), over the real store: what it reads, that an
 * added or removed entry is what a fresh connection reads back, and what it
 * says when it cannot keep a list.
 */

import { unixSeconds } from '@onyourleft/domain';
import type { AthleteRecord } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  indexedDbStoreFactory,
  seedAthletes,
  type PersistentStore,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import {
  mount,
  settle,
  submitForm,
  typeInto,
  activateWithKeyboard,
  type Mounted,
} from '../testing/mount';
import { MASKED_WORD_REFUSAL_TEXT } from './masked-words';
import type { MaskedWordsPort } from './masked-words-port';
import {
  MASKED_WORD_ADDED,
  MASKED_WORD_REMOVED,
  MASKED_WORDS_EMPTY,
  MASKED_WORDS_LEAD,
  MASKED_WORDS_NO_ATHLETE,
  MASKED_WORDS_NO_STORE,
  MASKED_WORDS_NOT_READ,
  MaskedWordsPanel,
  maskedWordsSaveFailure,
} from './MaskedWordsPanel';

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

async function open(port: MaskedWordsPort | undefined): Promise<void> {
  document.documentElement.lang = 'en';
  mounted = await mount(
    <main>
      <h1>Settings</h1>
      {/* #942: the panel sits in Settings' “Your words” card, under its h2. */}
      <h2>Your words</h2>
      <MaskedWordsPanel port={port} />
    </main>,
  );
  await settle();
  await settle();
}

function listed(): string[] {
  return [...document.querySelectorAll('.oyl-masked-words__word')].map((node) => node.textContent);
}

function status(): string {
  return document.querySelector('[role="status"], [role="alert"]')?.textContent ?? '';
}

async function add(word: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('.oyl-masked-words input');
  const form = document.querySelector<HTMLFormElement>('.oyl-masked-words form');
  if (input === null || form === null) {
    throw new Error('no form');
  }
  await typeInto(input, word);
  await submitForm(form);
  await settle();
}

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`).toBe('');
}

describe('the words-to-mask panel (#839)', () => {
  it('reads the stored list, and says so when it is empty', async () => {
    await open({ store: writer, athleteId: ATHLETE_A });
    expect(document.body.textContent).toContain(MASKED_WORDS_LEAD);
    expect(document.body.textContent).toContain(MASKED_WORDS_EMPTY);
    expectClean('an empty list');

    mounted?.unmount();
    await writer.setAthleteMaskedWords(ATHLETE_A, ['Kestrel Farm', 'Priya']);
    await open({ store: writer, athleteId: ATHLETE_A });
    expect(listed()).toStrictEqual(['Kestrel Farm', 'Priya']);
    expectClean('a list');
  });

  it('adds an entry that a fresh connection reads back, and removes one', async () => {
    await open({ store: writer, athleteId: ATHLETE_A });
    await add('  Acacia   Avenue ');
    expect(status()).toContain(MASKED_WORD_ADDED);
    expect(listed()).toStrictEqual(['Acacia Avenue']);
    await add('Priya');
    const onDisk = await harness.read(async (fresh) => fresh.getAthlete(ATHLETE_A));
    expect(onDisk?.maskedWords).toStrictEqual(['Acacia Avenue', 'Priya']);

    const remove = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Remove Acacia Avenue',
    );
    if (remove === undefined) {
      throw new Error('no remove control named for the entry');
    }
    await activateWithKeyboard(remove);
    await settle();
    expect(status()).toContain(MASKED_WORD_REMOVED);
    expect(listed()).toStrictEqual(['Priya']);
    const after = await harness.read(async (fresh) => fresh.getAthlete(ATHLETE_A));
    expect(after?.maskedWords).toStrictEqual(['Priya']);
  });

  it('refuses a one-letter entry and a repeat, and writes nothing for either', async () => {
    await writer.setAthleteMaskedWords(ATHLETE_A, ['Priya']);
    await open({ store: writer, athleteId: ATHLETE_A });
    await add('a');
    expect(status()).toContain(MASKED_WORD_REFUSAL_TEXT['one-character']);
    await add('PRIYA');
    expect(status()).toContain(MASKED_WORD_REFUSAL_TEXT.listed);
    const onDisk = await harness.read(async (fresh) => fresh.getAthlete(ATHLETE_A));
    expect(onDisk?.maskedWords).toStrictEqual(['Priya']);
  });

  it('offers no list without a store, and says why', async () => {
    await open(undefined);
    expect(document.body.textContent).toContain(MASKED_WORDS_NO_STORE);
    expect(document.querySelector('.oyl-masked-words form')).toBeNull();
  });

  it('says the list could not be read rather than showing an empty one', async () => {
    await open({
      athleteId: ATHLETE_A,
      store: {
        getAthlete: async () => Promise.reject(new Error('blocked')),
        setAthleteMaskedWords: async () => Promise.resolve(undefined),
      },
    });
    expect(document.body.textContent).toContain(MASKED_WORDS_NOT_READ);
    expect(document.body.textContent).not.toContain(MASKED_WORDS_EMPTY);
  });

  it('does not claim a save the store did not make', async () => {
    const row: AthleteRecord = {
      id: ATHLETE_A,
      displayName: 'You',
      createdAt: unixSeconds(1),
    };
    await open({
      athleteId: ATHLETE_A,
      store: {
        getAthlete: async () => Promise.resolve(row),
        setAthleteMaskedWords: async () => Promise.resolve(undefined),
      },
    });
    await add('Priya');
    expect(status()).toContain(maskedWordsSaveFailure(MASKED_WORDS_NO_ATHLETE));
    expect(listed()).toStrictEqual([]);
  });
});
