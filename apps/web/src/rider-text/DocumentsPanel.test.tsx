// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The documents panel (#836), over the REAL store: a plain text or Markdown
 * file added is what a fresh connection reads back, a refused file writes
 * nothing, and a removed one is gone from the store.
 *
 * The picker is driven the way `transfer/TransferView.test.tsx` drives its
 * own: a `FileList` defined on the input and a `change` event. The panel reads
 * `input.files` itself, never `FormData` — which is what makes this reachable
 * (`testing/mount.tsx` §`submitForm` says why FormData is not).
 */

import { unixSeconds } from '@onyourleft/domain';
import { MAXIMUM_RIDER_DOCUMENTS, type RiderTextRecord } from '@onyourleft/store';
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
import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';
import { RIDER_TEXT_MODEL_WARNING } from './disclosure';
import { DOCUMENT_REFUSAL_TEXT } from './document-file';
import {
  DOCUMENT_FILE_NOT_READ,
  DOCUMENT_REMOVE_NO,
  DOCUMENT_REMOVE_QUESTION,
  DOCUMENT_REMOVE_YES,
  DOCUMENTS_EMPTY,
  DOCUMENTS_FULL,
  DOCUMENTS_NOT_READ,
  DOCUMENTS_READING,
  DocumentsPanel,
  documentAdded,
  documentRemoved,
  documentsFailure,
} from './DocumentsPanel';
import type { RiderTextPort } from './rider-text-port';
import { RIDER_TEXT_NO_STORE } from './RiderTextBox';
import { memoryRiderText } from './testing';

let harness: StoreHarness;
let writer: PersistentStore;
let mounted: Mounted | undefined;
let nextId = 0;

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
    newDocumentId: () => `doc-${String((nextId += 1))}`,
  };
}

async function open(port: RiderTextPort | undefined): Promise<void> {
  document.documentElement.lang = 'en';
  mounted = await mount(
    <main>
      <h1>Settings</h1>
      {/* #942: the panel sits in Settings' “Your words” card, under its h2. */}
      <h2>Your words</h2>
      <DocumentsPanel port={port} />
    </main>,
  );
  // The list is read from the store first, and until it is the panel offers
  // no picker at all.
  await until(() => !panelSays(DOCUMENTS_READING), 'the documents were read');
}

/**
 * Settle until `done` holds (#952). The panel's add and remove are each a
 * chain of tasks — a file read, an IndexedDB write, an IndexedDB read — and a
 * fixed count of settles was not always enough on a loaded two-core runner.
 * So every step here waits for what it is FOR, and fails naming it.
 */
async function until(done: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (done()) return;
    await settle();
  }
  throw new Error(`never: ${what}`);
}

function panelSays(text: string): boolean {
  return (document.body.textContent ?? '').includes(text);
}

/** Choose `file` in the picker, and wait until the panel says `outcome`. */
async function choose(file: File, outcome: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error('no file input');
  const files = {
    length: 1,
    item: (index: number) => (index === 0 ? file : null),
    0: file,
    [Symbol.iterator]: () => [file][Symbol.iterator](),
  };
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await until(() => status().includes(outcome), `the panel said “${outcome}”`);
}

/** Press the button whose accessible text is `name`, with the keyboard. */
async function pressNamed(name: string): Promise<void> {
  const button = [...document.querySelectorAll('button')].find((each) => each.textContent === name);
  if (button === undefined) throw new Error(`no button named ${name}`);
  await activateWithKeyboard(button);
  await settle();
}

function listed(): string[] {
  return [...document.querySelectorAll('.oyl-rider-text__name')].map((node) => node.textContent);
}

function status(): string {
  return document.querySelector('[role="status"], [role="alert"]')?.textContent ?? '';
}

async function kept(): Promise<RiderTextRecord[]> {
  return harness.read(async (fresh) => fresh.listRiderTexts(ATHLETE_A, 'document'));
}

describe('the documents panel (#836)', () => {
  it('adds a Markdown file that a fresh connection reads back, and lists it', async () => {
    await open(portOver(writer));
    expect(document.body.textContent).toContain(DOCUMENTS_EMPTY);
    expect(document.body.textContent).toContain(RIDER_TEXT_MODEL_WARNING);
    await choose(
      new File(['# Base plan\r\n\r\nThree rides a week.'], 'Base plan.md'),
      documentAdded('Base plan.md'),
    );
    // The list is read again after the write, so it follows the status line.
    await until(() => listed().length > 0, 'the document was listed');
    expect(listed()).toStrictEqual(['Base plan.md (32 characters)']);
    const onDisk = await kept();
    expect(onDisk.map((row) => [row.name, row.text])).toStrictEqual([
      ['Base plan.md', '# Base plan\n\nThree rides a week.'],
    ]);
    const violations = auditAccessibility(document);
    expect(formatViolations(violations)).toBe(formatViolations([]));
  });

  it('refuses a PDF and a file that is not UTF-8, and writes nothing for either', async () => {
    await open(portOver(writer));
    await choose(new File(['%PDF-1.7'], 'plan.pdf'), DOCUMENT_REFUSAL_TEXT['not-text']);
    await choose(
      new File([new Uint8Array([0x63, 0x61, 0x66, 0xe9])], 'plan.txt'),
      DOCUMENT_REFUSAL_TEXT['not-utf8'],
    );
    expect(await kept()).toStrictEqual([]);
  });

  it('removes a document from the store, and says it goes from the instance at the next sync', async () => {
    await writer.putRiderText({
      athleteId: ATHLETE_A,
      kind: 'document',
      key: 'plan',
      name: 'Base plan.md',
      text: 'Three rides a week.',
      savedAt: unixSeconds(1),
    });
    await open(portOver(writer));
    await pressNamed('Remove Base plan.md');
    // Asked first (#924): nothing is removed by the first press.
    expect(document.body.textContent).toContain(DOCUMENT_REMOVE_QUESTION);
    expect(listed()).toStrictEqual(['Base plan.md (19 characters)']);
    expect(await kept()).toHaveLength(1);
    await pressNamed(`${DOCUMENT_REMOVE_YES} Base plan.md`);
    await until(() => status().includes(documentRemoved('Base plan.md')), 'the removal was said');
    await until(() => listed().length === 0, 'the document left the list');
    expect(await kept()).toStrictEqual([]);
  });

  it('refuses a document past the most that may be kept, before reading the file', async () => {
    const memory = memoryRiderText(
      Array.from({ length: MAXIMUM_RIDER_DOCUMENTS }, (_unused, index) => ({
        athleteId: ATHLETE_A,
        kind: 'document' as const,
        key: `d-${String(index)}`,
        name: `${String(index)}.md`,
        text: 'x',
        savedAt: unixSeconds(1),
      })),
      ATHLETE_A,
    );
    await open(memory.port);
    await choose(new File(['more'], 'more.md'), DOCUMENTS_FULL);
    expect(memory.calls).not.toContain('putRiderText');
  });

  it('says a failed write failed, and lists what is kept', async () => {
    const memory = memoryRiderText([], ATHLETE_A);
    await open(memory.port);
    memory.failNext = new Error('the disk is full');
    await choose(new File(['text'], 'plan.txt'), documentsFailure('the disk is full'));
    expect(listed()).toStrictEqual([]);
  });

  it('says a file that could not be read was not added, rather than rejecting unseen', async () => {
    // #920's review: `file.arrayBuffer()` rejects when the file changed or went
    // away after it was chosen, and the rejection escaped `void add(event)`.
    const memory = memoryRiderText([], ATHLETE_A);
    await open(memory.port);
    const file = new File(['text'], 'plan.txt');
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.reject(new DOMException('gone', 'NotReadableError')),
    });
    await choose(file, DOCUMENT_FILE_NOT_READ);
    expect(listed()).toStrictEqual([]);
  });

  it('says a failed remove failed, and still lists the document', async () => {
    const memory = memoryRiderText(
      [
        {
          athleteId: ATHLETE_A,
          kind: 'document',
          key: 'plan',
          name: 'Base plan.md',
          text: 'Three rides a week.',
          savedAt: unixSeconds(1),
        },
      ],
      ATHLETE_A,
    );
    await open(memory.port);
    memory.failNext = new Error('the disk is locked');
    await pressNamed('Remove Base plan.md');
    await pressNamed(`${DOCUMENT_REMOVE_YES} Base plan.md`);
    await until(
      () => status().includes(documentsFailure('the disk is locked')),
      'the failed removal was said',
    );
    expect(listed()).toStrictEqual(['Base plan.md (19 characters)']);
  });

  it('asks before removing, and keeps the document when the rider says keep it (#924)', async () => {
    await writer.putRiderText({
      athleteId: ATHLETE_A,
      kind: 'document',
      key: 'plan',
      name: 'Base plan.md',
      text: 'Three rides a week.',
      savedAt: unixSeconds(1),
    });
    await open(portOver(writer));
    await pressNamed('Remove Base plan.md');
    const group = document.querySelector('[role="group"]');
    expect(group?.getAttribute('aria-label')).toBe(`${DOCUMENT_REMOVE_QUESTION} Base plan.md`);
    // The safe answer has focus, so a second press where the first one was removes nothing.
    expect(document.activeElement?.textContent).toBe(`${DOCUMENT_REMOVE_NO} Base plan.md`);
    await pressNamed(`${DOCUMENT_REMOVE_NO} Base plan.md`);
    await settle();
    expect(document.body.textContent).not.toContain(DOCUMENT_REMOVE_QUESTION);
    expect(document.activeElement?.textContent).toBe('Remove Base plan.md');
    expect(listed()).toStrictEqual(['Base plan.md (19 characters)']);
    expect(await kept()).toHaveLength(1);
  });

  it('offers no picker without a store, and says why', async () => {
    await open(undefined);
    expect(document.body.textContent).toContain(RIDER_TEXT_NO_STORE);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('says the documents could not be read rather than showing none', async () => {
    const memory = memoryRiderText();
    await open({
      ...memory.port,
      store: { ...memory.port.store, listRiderTexts: async () => Promise.reject(new Error('x')) },
    });
    expect(document.body.textContent).toContain(DOCUMENTS_NOT_READ);
    expect(document.body.textContent).not.toContain(DOCUMENTS_EMPTY);
  });
});
