// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Instance screen's section for a hosted model service on the rider's own
 * key (#1251), mounted through the real shell at the real route — which is
 * where a rider meets it, and what goes red if the shell stops handing the
 * port on. The instance is scripted (`hosted-settings-testing.ts`); the real
 * port against a real instance is `hosted-settings.test.ts`.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { InstanceState } from '../instance/instance-port';
import { scriptedInstance } from '../instance/testing';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import {
  activateWithKeyboard,
  mount,
  queryAll,
  settle,
  submitForm,
  typeInto,
  type Mounted,
} from '../testing/mount';
import {
  HOSTED_AGREED,
  HOSTED_AGREED_TEXT,
  HOSTED_CHANGE_UNKNOWN,
  HOSTED_KEY_OPERATOR_CAN_READ,
  HOSTED_KEY_REMOVED,
  HOSTED_KEY_SEALED_ONLY,
  HOSTED_KEY_STORED,
  HOSTED_NO_KEY,
  HOSTED_PANEL_HEADING,
  HOSTED_PANEL_LEAD,
  HOSTED_REMOVE_BUTTON,
  HOSTED_STORE_BUTTON,
  HOSTED_TEST_BUTTON,
  HOSTED_TEST_UNREADABLE,
  HOSTED_UNREADABLE,
  HOSTED_WITHDRAWN,
  hostedAgreeLabel,
  hostedConsentElsewhere,
  hostedConsentMoved,
  hostedConsentWithoutKey,
  hostedInstanceConsent,
  hostedKeyHeldText,
  hostedTestText,
  hostedWithdrawLabel,
} from './hosted-consent';
import {
  SCRIPTED_HOSTED_KEY,
  scriptedHostedSettings,
  type ScriptedHostedSettings,
} from './hosted-settings-testing';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };
const ENDPOINT = SCRIPTED_HOSTED_KEY.origin;
const KEY = 'sk-test-0123456789abcdefghijklmnopqrstuv';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

async function open(
  scripted: ScriptedHostedSettings | undefined,
  connected = true,
  state?: InstanceState,
): Promise<void> {
  globalThis.location.hash = '#/settings/instance';
  mounted = await mount(
    <AppShell
      capabilities={NO_BLUETOOTH}
      instance={scriptedInstance({ connected, ...(state === undefined ? {} : { state }) }).port}
      {...(scripted === undefined ? {} : { hostedSettings: scripted.port })}
    />,
  );
  await settle();
}

function panel(): HTMLElement | undefined {
  return queryAll<HTMLElement>(document.body, 'section').find(
    (each) => each.querySelector('h2')?.textContent === HOSTED_PANEL_HEADING,
  );
}

const text = (): string => panel()?.textContent ?? '';

function button(label: string): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>(panel()!, 'button').find(
    (each) => each.textContent === label,
  );
  if (found === undefined) throw new Error(`no button "${label}"`);
  return found;
}

function field(label: string): HTMLInputElement {
  const named = queryAll<HTMLLabelElement>(panel()!, 'label').find((each) =>
    each.textContent?.startsWith(label),
  );
  const input = named === undefined ? null : document.getElementById(named.htmlFor);
  if (!(input instanceof HTMLInputElement)) throw new Error(`no field "${label}"`);
  return input;
}

function agreeBox(): HTMLInputElement | undefined {
  return queryAll<HTMLInputElement>(panel()!, 'input[type="checkbox"]')[0];
}

async function storeKey(address = `${ENDPOINT}/v1`, reasoning = ''): Promise<void> {
  await typeInto(field('The service’s address'), address);
  await typeInto(field('The model’s name'), 'a-model');
  await typeInto(field('Your key'), KEY);
  await typeInto(field('Tokens the model may spend'), reasoning);
  await submitForm(panel()!.querySelector('form')!);
  await settle();
}

describe('where the section is drawn', () => {
  it('is on the Instance screen for a device signed in, and asks the instance what it holds', async () => {
    const scripted = scriptedHostedSettings();
    await open(scripted);
    expect(panel()).toBeDefined();
    expect(text()).toContain(HOSTED_PANEL_LEAD);
    expect(text()).toContain(HOSTED_NO_KEY);
    expect(scripted.presses).toStrictEqual(['read']);
  });

  it('is not drawn, and asks nothing, for a device signed in to no instance', async () => {
    const scripted = scriptedHostedSettings();
    await open(scripted, false);
    expect(panel()).toBeUndefined();
    expect(scripted.presses).toStrictEqual([]);
  });

  it.each([
    ['whose sign-in the instance no longer accepts', 'signed-out'],
    ['whose instance does not answer', 'unreachable'],
  ] as const)('is not drawn, and asks nothing, for a device %s', async (_name, kind) => {
    const scripted = scriptedHostedSettings();
    await open(scripted, true, { kind, origin: 'https://ride.example' });
    expect(document.body.textContent).toContain('Not signed in');
    expect(panel()).toBeUndefined();
    expect(scripted.presses).toStrictEqual([]);
  });

  it('is not drawn where the shell was handed no port', async () => {
    await open(undefined);
    expect(panel()).toBeUndefined();
  });

  it('says why when the instance could not be asked, and offers no form to type a key into', async () => {
    const scripted = scriptedHostedSettings();
    scripted.failNext = 'This needs the instance’s card.';
    await open(scripted);
    expect(text()).toContain('This needs the instance’s card.');
    expect(queryAll(panel()!, 'input')).toHaveLength(0);
  });
});

describe('storing a key', () => {
  it('says who could read it and how it travels BESIDE the key box, before anything is stored', async () => {
    await open(scriptedHostedSettings());
    const key = field('Your key');
    expect(key.type).toBe('password');
    const hint = document.getElementById(key.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe(`${HOSTED_KEY_OPERATOR_CAN_READ} ${HOSTED_KEY_SEALED_ONLY}`);
    expect(hint?.closest('details')).toBeNull();
  });

  it('sends what was typed, shows what the instance holds, and empties the key box', async () => {
    const scripted = scriptedHostedSettings();
    await open(scripted);
    await storeKey(`${ENDPOINT}/v1`, '2048');
    expect(scripted.lastAnswers).toStrictEqual({
      address: `${ENDPOINT}/v1`,
      model: 'a-model',
      key: KEY,
      reasoningTokens: '2048',
    });
    expect(text()).toContain(HOSTED_KEY_STORED);
    expect(text()).toContain(hostedKeyHeldText({ ...SCRIPTED_HOSTED_KEY, reasoningTokens: 2048 }));
    expect(field('Your key').value).toBe('');
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  it('keeps what was typed, and shows the reason, when the key was not stored', async () => {
    const scripted = scriptedHostedSettings();
    await open(scripted);
    scripted.failNext = 'Your instance did not accept that.';
    await storeKey();
    expect(text()).toContain('Your instance did not accept that.');
    expect(text()).toContain(HOSTED_NO_KEY);
    expect(field('The model’s name').value).toBe('a-model');
  });

  it('removes a key the rider stored, and offers no removal of the operator’s own', async () => {
    const scripted = scriptedHostedSettings({ key: SCRIPTED_HOSTED_KEY, consent: null });
    await open(scripted);
    await activateWithKeyboard(button(HOSTED_REMOVE_BUTTON));
    await settle();
    expect(scripted.presses).toStrictEqual(['read', 'remove']);
    expect(text()).toContain(HOSTED_KEY_REMOVED);
    expect(text()).toContain(HOSTED_NO_KEY);
    mounted?.unmount();
    await open(
      scriptedHostedSettings({
        key: { ...SCRIPTED_HOSTED_KEY, setBy: 'operator-command' },
        consent: null,
      }),
    );
    expect(queryAll(panel()!, 'button').map((each) => each.textContent)).not.toContain(
      HOSTED_REMOVE_BUTTON,
    );
    expect(text()).toContain('The operator’s command set this account’s key');
  });
});

describe('agreeing', () => {
  it('offers no switch, no consent and no test question while the instance holds no key', async () => {
    await open(scriptedHostedSettings());
    expect(agreeBox()).toBeUndefined();
    expect(queryAll(panel()!, 'button').map((each) => each.textContent)).toStrictEqual([
      HOSTED_STORE_BUTTON,
    ]);
  });

  it('shows the whole consent, naming the key’s service, beside a switch that is off', async () => {
    await open(scriptedHostedSettings({ key: SCRIPTED_HOSTED_KEY, consent: null }));
    const box = agreeBox();
    expect(box?.checked).toBe(false);
    expect(box?.closest('label')?.textContent?.trim()).toBe(hostedAgreeLabel(ENDPOINT));
    const consent = hostedInstanceConsent(ENDPOINT);
    const described = document.getElementById(box?.getAttribute('aria-describedby') ?? '');
    for (const sentence of [consent.headline, ...consent.paragraphs, consent.notNeeded]) {
      expect(described?.textContent).toContain(sentence);
    }
    expect(described?.closest('details')).toBeNull();
    expect(text()).toContain(consent.offUntilOn);
    // Nothing to test until it is agreed.
    expect(queryAll(panel()!, 'button').map((each) => each.textContent)).not.toContain(
      HOSTED_TEST_BUTTON,
    );
  });

  it('records the consent for the service the INSTANCE named, and withdraws it', async () => {
    const scripted = scriptedHostedSettings({ key: SCRIPTED_HOSTED_KEY, consent: null });
    await open(scripted);
    await activateWithKeyboard(agreeBox()!);
    await settle();
    expect(scripted.presses).toStrictEqual(['read', `agree ${ENDPOINT}`]);
    expect(agreeBox()?.checked).toBe(true);
    expect(text()).toContain(HOSTED_AGREED);
    expect(text()).toContain(HOSTED_AGREED_TEXT);
    expect(text()).not.toContain(hostedInstanceConsent(ENDPOINT).offUntilOn);
    await activateWithKeyboard(agreeBox()!);
    await settle();
    expect(scripted.presses.at(-1)).toBe('withdraw');
    expect(agreeBox()?.checked).toBe(false);
    expect(text()).toContain(HOSTED_WITHDRAWN);
  });

  it('leaves the switch off, and says why, when the instance did not record it', async () => {
    const scripted = scriptedHostedSettings({ key: SCRIPTED_HOSTED_KEY, consent: null });
    await open(scripted);
    scripted.failNext = 'The list could not be sent.';
    await activateWithKeyboard(agreeBox()!);
    await settle();
    expect(agreeBox()?.checked).toBe(false);
    expect(text()).toContain('The list could not be sent.');
  });

  it('says the agreement was withdrawn when a key for another service is stored', async () => {
    const scripted = scriptedHostedSettings({
      key: SCRIPTED_HOSTED_KEY,
      consent: { origin: ENDPOINT },
    });
    await open(scripted);
    await storeKey('https://elsewhere.example/v1');
    expect(text()).toContain(hostedConsentMoved('models.example', 'elsewhere.example'));
    expect(agreeBox()?.checked).toBe(false);
    expect(agreeBox()?.closest('label')?.textContent?.trim()).toBe(
      hostedAgreeLabel('https://elsewhere.example'),
    );
  });

  it.each([
    [
      'the key is for another service',
      { key: SCRIPTED_HOSTED_KEY, consent: { origin: 'https://old.example' } },
      hostedConsentElsewhere('old.example', 'models.example'),
    ],
    [
      'no key is held',
      { key: null, consent: { origin: 'https://old.example' } },
      hostedConsentWithoutKey('old.example'),
    ],
  ] as const)('says so, and lets it be withdrawn, when %s', async (_name, held, said) => {
    const scripted = scriptedHostedSettings(held);
    await open(scripted);
    expect(text()).toContain(said);
    expect(agreeBox()?.checked ?? false).toBe(false);
    await activateWithKeyboard(button(hostedWithdrawLabel('old.example')));
    await settle();
    expect(scripted.presses.at(-1)).toBe('withdraw');
    expect(text()).not.toContain(said);
  });
});

describe('the test question', () => {
  const AGREED = { key: SCRIPTED_HOSTED_KEY, consent: { origin: ENDPOINT } };

  it.each([
    ['answered', false, false],
    ['answered', true, false],
    ['no-answer', false, false],
    ['not-ready', false, false],
    ['refused', false, false],
    ['unreachable', false, false],
    ['timed-out', false, false],
    ['failed', false, false],
  ] as const)('says how it went: %s (reasoned %s)', async (result, reasoned, allowanceSet) => {
    const scripted = scriptedHostedSettings(AGREED, { result, reasoned });
    await open(scripted);
    await activateWithKeyboard(button(HOSTED_TEST_BUTTON));
    await settle();
    expect(scripted.presses).toStrictEqual(['read', 'test']);
    expect(text()).toContain(hostedTestText(result, 'models.example', { reasoned, allowanceSet }));
  });

  it('does not tell a rider who set the allowance to set it', async () => {
    const scripted = scriptedHostedSettings(
      { ...AGREED, key: { ...SCRIPTED_HOSTED_KEY, reasoningTokens: 2048 } },
      { result: 'answered', reasoned: true },
    );
    await open(scripted);
    await activateWithKeyboard(button(HOSTED_TEST_BUTTON));
    await settle();
    expect(text()).toContain('models.example answered the test question.');
    expect(text()).not.toContain('store your key again');
  });

  // #1796: a press that threw may have reached the instance, and a test
  // question that threw may have reached the service.
  it('says it cannot tell whether a change was made when a press threw, never that nothing changed', async () => {
    const scripted = scriptedHostedSettings();
    scripted.port.storeHostedKey = () => Promise.reject(new Error('the answer was lost'));
    await open(scripted);
    await storeKey();
    expect(text()).toContain(HOSTED_CHANGE_UNKNOWN);
    expect(text()).not.toContain(HOSTED_UNREADABLE);
  });

  it('never says nothing was sent when the test question threw', async () => {
    const scripted = scriptedHostedSettings(AGREED);
    scripted.port.sendHostedTestQuestion = () => Promise.reject(new Error('the answer was lost'));
    await open(scripted);
    await activateWithKeyboard(button(HOSTED_TEST_BUTTON));
    await settle();
    expect(text()).toContain(HOSTED_TEST_UNREADABLE);
    expect(text()).not.toContain('nothing was sent to a service');
  });

  it('shows the sentence when the test could not be asked', async () => {
    const scripted = scriptedHostedSettings(AGREED);
    scripted.test = { kind: 'failed', text: 'Your instance did not say how it went.' };
    await open(scripted);
    await activateWithKeyboard(button(HOSTED_TEST_BUTTON));
    await settle();
    expect(text()).toContain('Your instance did not say how it went.');
  });
});
