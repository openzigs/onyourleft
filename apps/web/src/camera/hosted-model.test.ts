// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The hosted service's configuration, and the one assertion that stops its
 * consent wording drifting from the amendment that ruled on it — #518.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { stripComments } from '../units/no-inline-units';

import {
  forgetHostedModel,
  HOSTED_CONSENT,
  HOSTED_MODEL_REFUSAL_TEXT,
  HOSTED_MODEL_STORAGE_KEY,
  HOSTED_TEST_QUESTION_LABEL,
  hostedCompletionsUrl,
  hostedModelDecision,
  hostedModelDecisionKeepingKey,
  hostedModelEraser,
  MAXIMUM_KEY_LENGTH,
  readHostedModel,
  writeHostedModel,
  type HostedModelStorage,
} from './hosted-model';

const ADR_0029 = fileURLToPath(
  new URL('../../../../docs/adr/0029-camera-imagery-as-a-data-class.md', import.meta.url),
);

/** `consent.test.ts`'s normalisation: a block quote as one line of prose. */
function asProse(markdown: string): string {
  return markdown
    .replaceAll(/^\s*>\s?/gm, '')
    .replaceAll('**', '')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

/** A key that would be easy to spot anywhere it should not be. */
const FIXTURE_KEY = 'fixture-hosted-key-DO-NOT-LEAK-0123456789';

const GOOD = { address: 'https://models.example.invalid', model: 'a-model', key: FIXTURE_KEY };

function memoryStorage(): HostedModelStorage & { readonly rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return {
    rows,
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => {
      rows.set(key, value);
    },
    removeItem: (key) => {
      rows.delete(key);
    },
  };
}

/** The newest entry of an ADR's `## Amendments` section, as prose. */
function newestAmendment(markdown: string): string {
  const section = markdown.slice(markdown.indexOf('## Amendments'));
  const entries = [...section.matchAll(/^- \*\*(\d{4}-\d{2}-\d{2})\*\*/gm)];
  const last = entries.at(-1);
  return last === undefined ? '' : asProse(section.slice(last.index));
}

describe('the hosted consent wording is the one ADR 0029’s newest amendment quotes (#803)', () => {
  const markdown = readFileSync(ADR_0029, 'utf8');
  const amendment = newestAmendment(markdown);
  const parts = [
    HOSTED_CONSENT.headline,
    ...HOSTED_CONSENT.paragraphs,
    HOSTED_CONSENT.notNeeded,
    HOSTED_CONSENT.offUntilOn,
  ];

  it('can find the amendment at all, and it is the one that moved the words for ride data', () => {
    expect(asProse(markdown)).toContain('D-7 — The hosted path');
    expect(amendment).toMatch(/^- 2026-09-29 — /);
    expect(amendment).toContain('ADR 0035 D-9 C');
    // #845: the completed wording, not #803's.
    expect(amendment).toContain("its distance, and each section's gradient and total climb");
    expect(amendment).toContain('one test question, containing none of your data');
    // #847: the question goes on the button's press, not on a save.
    expect(amendment).toContain("When you press 'Send a test question to the service'");
  });

  it('names the button the Camera page really renders — #847', () => {
    // The consent names a control by its label; the label is one constant
    // the Camera page renders, so a rename cannot leave the consent naming a
    // button that is gone without this and the ADR comparison both noticing.
    expect(HOSTED_TEST_QUESTION_LABEL).toBe('Send a test question to the service');
    expect(HOSTED_CONSENT.paragraphs.join(' ')).toContain(`'${HOSTED_TEST_QUESTION_LABEL}'`);
  });

  it('would notice the #845 wording, which said the question goes on a save — the control', () => {
    const entries = [...markdown.matchAll(/^- \*\*2026-09-29\*\*/gm)];
    expect(entries.length).toBeGreaterThanOrEqual(2);
    // Only the block quotes: the newest entry's prose quotes the old sentence
    // to say what it replaces.
    const quoted = (from?: number, to?: number): string =>
      asProse(
        markdown
          .slice(from, to)
          .split('\n')
          .filter((line) => line.trimStart().startsWith('>'))
          .join('\n'),
      );
    const previous = quoted(entries.at(-2)?.index, entries.at(-1)?.index);
    const newest = quoted(entries.at(-1)?.index);
    expect(previous).toContain('When you save a service, the app sends it one test question');
    expect(newest).toContain(HOSTED_CONSENT.paragraphs.map(asProse).join(' '));
    expect(newest).not.toContain('When you save a service');
  });

  it('appears in the newest amendment word for word, every part and in order', () => {
    expect(
      amendment,
      'the hosted consent must say what the newest amendment says; an ADR body is never edited in place',
    ).toContain(parts.map(asProse).join(' '));
  });

  it('would notice the words the 2026-09-28 amendment quoted, which no longer ship', () => {
    // The control: the superseded wording is still in the ADR, and it is NOT
    // what the newest amendment says — so a test reading the first amendment
    // instead would pass over the old words.
    const older = asProse(markdown.slice(markdown.indexOf('- **2026-09-28**')));
    expect(older).toContain('Today it is sent only a test question');
    expect(amendment).not.toContain('Today it is sent only a test question');
  });

  it('says never a picture, names the key and what a ride sends, and names the alternative', () => {
    const all = [HOSTED_CONSENT.headline, ...HOSTED_CONSENT.paragraphs].join(' ');
    expect(all).toContain('never sent a picture');
    expect(all).toContain('using the key you entered');
    expect(all).toContain('your heart rate, cadence and power');
    expect(all).toContain("each section's gradient and total climb");
    expect(all).toContain(
      "When you press 'Send a test question to the service', the app sends it one test question",
    );
    expect(all).not.toContain('When you save a service');
    expect(all).toContain('We cannot delete it for you afterwards');
    expect(all).not.toContain('Today it is sent only a test question');
    expect(HOSTED_CONSENT.notNeeded).toContain('You do not need this');
    expect(HOSTED_CONSENT.offUntilOn).toContain('This is off');
  });
});

describe('what the rider typed', () => {
  it('accepts an https origin, a model and a key, and keeps only the origin', () => {
    const decision = hostedModelDecision({
      ...GOOD,
      address: ' https://models.example.invalid/v1/ ',
    });
    expect(decision.refusal).toBeUndefined();
    expect(decision.model).toStrictEqual({ ...GOOD });
    expect(hostedCompletionsUrl(GOOD)).toBe('https://models.example.invalid/v1/chat/completions');
  });

  it.each([
    ['', 'no-address'],
    ['not a url', 'not-an-address'],
    ['http://models.example.invalid', 'not-https'],
    ['https://user:pass@models.example.invalid', 'has-credentials'],
    ['https://models.example.invalid/?key=1', 'has-query'],
    ['https://models.example.invalid/somewhere/else', 'unexpected-path'],
  ] as const)('refuses the address %j as %s', (address, refusal) => {
    expect(hostedModelDecision({ ...GOOD, address }).refusal).toBe(refusal);
  });

  it('refuses http: even for an address on the rider’s own network — a key is never sent in the clear', () => {
    expect(hostedModelDecision({ ...GOOD, address: 'http://192.168.1.20:8080' }).refusal).toBe(
      'not-https',
    );
  });

  it.each([
    [{ model: ' ' }, 'no-model'],
    [{ model: 'm'.repeat(201) }, 'model-too-long'],
    [{ key: '  ' }, 'no-key'],
    [{ key: 'k'.repeat(MAXIMUM_KEY_LENGTH + 1) }, 'key-too-long'],
    [{ key: 'two words' }, 'key-not-printable'],
    [{ key: 'line\nbreak' }, 'key-not-printable'],
  ] as const)('refuses %j as %s', (change, refusal) => {
    expect(hostedModelDecision({ ...GOOD, ...change }).refusal).toBe(refusal);
  });

  it('never repeats a key in a refusal', () => {
    for (const text of Object.values(HOSTED_MODEL_REFUSAL_TEXT)) {
      expect(text).not.toContain(FIXTURE_KEY);
      expect(text).not.toContain('fixture');
    }
  });
});

describe('a blank key box keeps the saved key for its own address only — #760 review', () => {
  const OTHER = 'https://other.example.invalid';

  it('keeps the saved key when only the model name changes', () => {
    const decision = hostedModelDecisionKeepingKey(
      { ...GOOD, model: 'another-model', key: '' },
      GOOD,
    );
    expect(decision.model).toStrictEqual({ ...GOOD, model: 'another-model' });
  });

  it('treats /v1 and a trailing slash after the same host as the same address', () => {
    const decision = hostedModelDecisionKeepingKey(
      { ...GOOD, address: `${GOOD.address}/v1/`, key: '' },
      GOOD,
    );
    expect(decision.model?.key).toBe(GOOD.key);
  });

  it('refuses a blank key for a different address rather than sending the saved key there', () => {
    const decision = hostedModelDecisionKeepingKey({ ...GOOD, address: OTHER, key: '' }, GOOD);
    expect(decision.model).toBeUndefined();
    expect(decision.refusal).toBe('key-for-another-address');
  });

  it('takes a typed key for a different address', () => {
    const decision = hostedModelDecisionKeepingKey(
      { ...GOOD, address: OTHER, key: 'a-new-key-for-the-other-service' },
      GOOD,
    );
    expect(decision.model).toStrictEqual({
      address: OTHER,
      model: GOOD.model,
      key: 'a-new-key-for-the-other-service',
    });
  });

  it('asks for a key when none is saved', () => {
    expect(hostedModelDecisionKeepingKey({ ...GOOD, key: '' }, undefined).refusal).toBe('no-key');
  });

  it('reports an address refusal before the key one', () => {
    expect(
      hostedModelDecisionKeepingKey({ ...GOOD, address: 'http://x.invalid', key: '' }, GOOD)
        .refusal,
    ).toBe('not-https');
  });
});

describe('on this device', () => {
  it('starts empty', () => {
    expect(readHostedModel(memoryStorage())).toBeUndefined();
  });

  it('round-trips through the one storage key, and re-decides what it reads', () => {
    const storage = memoryStorage();
    expect(writeHostedModel(GOOD, storage)).toBe(true);
    expect([...storage.rows.keys()]).toStrictEqual([HOSTED_MODEL_STORAGE_KEY]);
    expect(readHostedModel(storage)).toStrictEqual(GOOD);
    storage.rows.set(
      HOSTED_MODEL_STORAGE_KEY,
      JSON.stringify({ ...GOOD, address: 'http://x.invalid' }),
    );
    expect(readHostedModel(storage)).toBeUndefined();
    storage.rows.set(HOSTED_MODEL_STORAGE_KEY, '{not json');
    expect(readHostedModel(storage)).toBeUndefined();
  });

  it('forgets, and the eraser forgets', () => {
    const storage = memoryStorage();
    writeHostedModel(GOOD, storage);
    forgetHostedModel(storage);
    expect(readHostedModel(storage)).toBeUndefined();
    writeHostedModel(GOOD, storage);
    hostedModelEraser(storage).forget();
    expect(storage.rows.size).toBe(0);
  });

  it('says so when this device would not keep it', () => {
    expect(writeHostedModel(GOOD, undefined)).toBe(false);
  });
});

describe('no vendor — ADR 0031 D-4 conditions 2 and 3', () => {
  const HOSTED_MODULES = [
    'hosted-model.ts',
    'hosted-port.ts',
    'hosted-transport.ts',
    'useHostedCheck.ts',
  ] as const;

  it.each(HOSTED_MODULES)('%s names no address of any service in its code', (file) => {
    const code = stripComments(
      readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8'),
    );
    expect(code.length).toBeGreaterThan(100);
    // Any scheme followed by a host is an address somebody chose. The rule
    // strings themselves (`'https:'`) have no host after them.
    expect(code).not.toMatch(/https?:\/\/[a-z0-9]/i);
  });
});
