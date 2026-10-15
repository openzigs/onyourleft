// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The legal and contact page (#908): what an operator configures is what the
 * page says, read through the real listener — and an instance that offers
 * public rooms with nobody to write to does not start.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { readConfig } from './config.ts';
import { startTestInstance, TEST_COMMIT, type TestInstance } from './instance-testing.ts';
import { NO_LEGAL_SETTINGS, readLegalSettings, type LegalSettings } from './legal.ts';

const COMMIT = 'fedcba9876543210fedcba9876543210fedcba98';

let instance: TestInstance | undefined;
afterEach(async () => {
  await instance?.listening.close();
  instance = undefined;
});

async function page(legal: LegalSettings, name: string | null = null): Promise<Response> {
  instance = await startTestInstance({ config: { legal, name } });
  return fetch(`${instance.url}/legal`);
}

const SET: LegalSettings = {
  contactEmail: 'contact@club.example',
  contactLanguages: ['English', 'Welsh'],
  accountablePerson: 'Jo <Bloggs>',
  legalRepresentative: 'Rep GmbH, 1 Strasse, Berlin, rep@rep.example, +49 30 000000',
  privacyPolicyUrl: 'https://club.example/privacy',
  publicRooms: false,
};

describe('the legal page (#908)', () => {
  it('names what the operator configured: the contact, its languages, the accountable person, the representative and the documents', async () => {
    const response = await page(SET, 'Club & Co');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    const html = await response.text();
    expect(html).toContain('<a href="mailto:contact@club.example">contact@club.example</a>');
    expect(html).toContain('You can write in: English, Welsh.');
    expect(html).toContain('A person reads every message.');
    expect(html).toContain('Jo &lt;Bloggs&gt; is accountable for keeping illegal content off');
    expect(html).toContain('the instance Club &amp; Co');
    expect(html).toContain('Legal representative in the European Union');
    expect(html).toContain('Rep GmbH, 1 Strasse, Berlin');
    expect(html).toContain('<a href="/report">notice page</a>');
    expect(html).toContain('<a href="https://club.example/privacy">Privacy policy</a>');
    expect(html).toContain(
      `<a href="https://github.com/openzigs/onyourleft/tree/${TEST_COMMIT}">The source code of this instance</a>`,
    );
    expect(html).not.toContain('<script');
  });

  it('says plainly what an operator has not set, and shows no representative it was not given', async () => {
    const html = await (await page(NO_LEGAL_SETTINGS)).text();
    expect(html).toContain('has not published a contact address');
    expect(html).toContain('has not named the person accountable');
    expect(html).toContain('This instance has published no privacy policy.');
    expect(html).not.toContain('Legal representative');
    expect(html).not.toContain('mailto:');
  });
});

describe('the legal settings (#908)', () => {
  it('defaults to nothing published, English, and public rooms off', () => {
    const result = readConfig({ commit: COMMIT });
    expect(result.ok && result.config.legal).toEqual({
      contactEmail: null,
      contactLanguages: ['English'],
      accountablePerson: null,
      legalRepresentative: null,
      privacyPolicyUrl: null,
      publicRooms: false,
    });
  });

  it('reads every setting, trimmed', () => {
    const result = readConfig({
      commit: COMMIT,
      contactEmail: ' contact@club.example ',
      contactLanguages: 'English, Welsh ,',
      accountablePerson: ' Jo Bloggs ',
      legalRepresentative: 'Rep GmbH',
      privacyPolicyUrl: 'https://club.example/privacy',
      publicRooms: 'ON',
    });
    expect(result.ok && result.config.legal).toEqual({
      contactEmail: 'contact@club.example',
      contactLanguages: ['English', 'Welsh'],
      accountablePerson: 'Jo Bloggs',
      legalRepresentative: 'Rep GmbH',
      privacyPolicyUrl: 'https://club.example/privacy',
      publicRooms: true,
    });
  });

  it('refuses to start with public rooms on and nobody to write to, or nobody accountable', () => {
    for (const missing of [
      { accountablePerson: 'Jo Bloggs' },
      { contactEmail: 'contact@club.example' },
      {},
    ]) {
      const result = readConfig({ commit: COMMIT, publicRooms: 'on', ...missing });
      expect(result.ok, JSON.stringify(missing)).toBe(false);
      expect(result.ok ? '' : result.problems.join(' ')).toContain(
        'OYL_INSTANCE_PUBLIC_ROOMS is on, so set OYL_INSTANCE_CONTACT_EMAIL and OYL_INSTANCE_ACCOUNTABLE_PERSON',
      );
    }
    // Off, or unset, starts with nothing set: a private instance owes the page less.
    expect(readConfig({ commit: COMMIT, publicRooms: 'off' }).ok).toBe(true);
  });

  it('refuses a setting that is not what it names, and reports each', () => {
    const problems: string[] = [];
    readLegalSettings(
      {
        contactEmail: 'not an address',
        contactLanguages: ' , ',
        accountablePerson: 'Jo\u202EBloggs',
        legalRepresentative: 'x'.repeat(501),
        privacyPolicyUrl: 'http://club.example/privacy',
        publicRooms: 'yes',
      },
      problems,
    );
    expect(problems.map((each) => each.split(' ')[0])).toEqual([
      'OYL_INSTANCE_CONTACT_EMAIL',
      'OYL_INSTANCE_CONTACT_LANGUAGES',
      'OYL_INSTANCE_ACCOUNTABLE_PERSON',
      'OYL_INSTANCE_LEGAL_REPRESENTATIVE',
      'OYL_INSTANCE_PRIVACY_POLICY_URL',
      'OYL_INSTANCE_PUBLIC_ROOMS',
    ]);
  });
});
