// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The hosted consent, word for word** (#1251; #1104's B1 and B2).
 *
 * #1104's acceptance criterion: *"Each approved block is pinned word for word
 * by a test in the PR that ships it."* The wording is DRAFT until the owner
 * approves it with this pull request, and this is the text that pull request
 * quotes: a word changed in `hosted-consent.ts` is red here until it is
 * changed here too, where a reviewer reads both.
 *
 * It is also held to what is true of the software: every tool the instance's
 * agent may call is named (`@onyourleft/analysis` §`AGENT_TOOL_DISCLOSURES`),
 * the endpoint is named wherever something goes to it, and it does not promise
 * the three things #1104's draft said that this build does not do.
 */

import { AGENT_TOOL_DISCLOSURES } from '@onyourleft/analysis';
import { describe, expect, it } from 'vitest';

import { MASKING_LIMIT } from '../camera/hosted-model';
import {
  HOSTED_AGREED_TEXT,
  HOSTED_ANSWER_REFUSAL_TEXT,
  HOSTED_KEY_OPERATOR_CAN_READ,
  HOSTED_KEY_SEALED_ONLY,
  HOSTED_MASKING_NOT_SENT,
  HOSTED_NOT_ACCEPTED,
  HOSTED_NOT_OFFERED,
  HOSTED_PANEL_LEAD,
  HOSTED_TEST_BUTTON,
  HOSTED_TEST_UNREADABLE,
  HOSTED_UNREADABLE,
  hostedAgreeLabel,
  hostedConsentElsewhere,
  hostedConsentMoved,
  hostedConsentWithoutKey,
  hostedInstanceConsent,
  hostedKeptVisible,
  hostedKeyHeldText,
  hostedPressSends,
  hostedTestText,
  type HostedTestResult,
} from './hosted-consent';

const ENDPOINT = 'https://api.example.com';
const consent = hostedInstanceConsent(ENDPOINT);

describe('the hosted consent (#1104 B1), as drafted for the owner', () => {
  it('is these words', () => {
    expect(consent).toStrictEqual({
      headline: 'This sends your ride, from your instance, to https://api.example.com.',
      paragraphs: [
        "If you agree, each time you ask for a ride analysis by this service, your instance sends that ride's numbers to https://api.example.com: your heart rate, cadence and power, your weight and watts per kilogram, your threshold power, if you set one, how long the ride lasted, its distance, and each section's gradient and total climb, and how it went section by section. If the side camera filmed the ride, it is also sent how a few measurements of your riding position changed between the start and the end of filming. While it writes, the model may look up more on your instance and be sent it: short summaries of your recent rides, summaries of older rides, what you wrote about your goals, your notes and documents, your saved workouts, and earlier write-ups. The model decides during the analysis which of these it looks up, so the app cannot list them in advance.",
        "That is a company or a computer that is not yours and not ours, and we cannot see what they do with it or how long they keep it. We cannot delete it for you afterwards. It sees your instance's internet address, not this device's.",
        "A ride analysis never sends it a picture — not a photograph of you, and nothing made from one. The ride's numbers carry no name, no place and no date. But what you wrote yourself can say anything, so this cannot promise that your name, where you ride or when is never sent. Before anything is sent, your instance masks e-mail addresses, phone numbers, links, street addresses, postcodes, coordinates, the names of your privacy zones and everything on your list of words to mask. Masking reduces what is sent; it does not guarantee that nothing personal gets through.",
        'So that your instance can mask, this device sends it your list of words to mask and your privacy zones — their names, where they are and how large — when you agree, and again each time you ask for a ride analysis by this service. They are sealed on the way, and your instance keeps them with your account.',
        'Your key is held by your instance, encrypted, and is sent only to https://api.example.com. It is never sent back to this device and is never put in a file the app or your instance exports. Whoever runs your instance holds the secret your key is encrypted with, so they could read your key. If that is not you, only use a key you are willing to let them see.',
        "When you press 'Send a test question', your instance sends it one test question, containing none of your data, to check it answers.",
        "If the service's address changes, you are asked again before anything is sent to the new one.",
      ],
      notNeeded:
        'You do not need this. Everything else in the app works without it, and a model your instance runs on its own machine or its own private network can write the same analysis without sending anything to a service.',
      offUntilOn: 'This is off. It stays off until you agree, and you can withdraw it at any time.',
    });
  });

  it('quotes the masking limit and the bring-your-own sentence unchanged', () => {
    expect(consent.paragraphs[2]).toContain(MASKING_LIMIT);
    expect(consent.paragraphs[4]).toContain(HOSTED_KEY_OPERATOR_CAN_READ);
    expect(HOSTED_KEY_OPERATOR_CAN_READ).toBe(
      'Whoever runs your instance holds the secret your key is encrypted with, so they could read your key. If that is not you, only use a key you are willing to let them see.',
    );
    expect(consent.paragraphs[5]).toContain(`'${HOSTED_TEST_BUTTON}'`);
  });

  it('names every tool the instance’s agent may call, by its approved phrase', () => {
    const phrases = Object.values(AGENT_TOOL_DISCLOSURES).flat();
    expect(phrases.length).toBeGreaterThan(5);
    expect(phrases).toContain('summaries of older rides');
    const unnamed = phrases.filter((phrase) => !consent.paragraphs[0]?.includes(phrase));
    expect(unnamed, 'a tool can send what the consent does not name').toStrictEqual([]);
  });

  it('names the endpoint it was built for, and no other', () => {
    const other = hostedInstanceConsent('https://elsewhere.example');
    for (const each of [consent.headline, consent.paragraphs[0], consent.paragraphs[4]]) {
      expect(each).toContain(ENDPOINT);
    }
    expect(JSON.stringify(other)).not.toContain(ENDPOINT);
    expect(other.headline).toContain('https://elsewhere.example');
    expect(hostedAgreeLabel(ENDPOINT)).toBe(
      'I agree to my instance sending my rides to https://api.example.com',
    );
  });

  it('follows the owner’s rulings: no Share mode, no per-launch switch', () => {
    const all = JSON.stringify(consent);
    expect(all).not.toMatch(/Share mode|operator's key|operator’s key/);
    expect(all).not.toMatch(/whenever the app is opened/);
    expect(consent.offUntilOn).toContain('withdraw it at any time');
  });

  it('does not promise what this build does not do', () => {
    const all = JSON.stringify(consent);
    // No record of what was sent is kept or shown anywhere (#1104 B1's draft said one was).
    expect(all).not.toMatch(/record of what was/);
    // Since #1106 the same service CAN be sent pictures, under another consent.
    expect(all).not.toContain('It is never sent a picture');
    expect(consent.paragraphs[2]).toContain('A ride analysis never sends it a picture');
  });
});

describe('the rest of what a rider reads (#1251), as drafted', () => {
  it('is these words', () => {
    expect(HOSTED_PANEL_LEAD).toBe(
      'Your instance can send a ride you ask it to analyse to a hosted model service instead of using a model on its own machine or its own private network — but only on a key of your own, and only after you agree to that service by its address. This app has no key of its own and suggests no service. Nothing is sent to any service until you have stored a key and agreed below.',
    );
    expect(HOSTED_KEY_SEALED_ONLY).toBe(
      'Your key is sealed on this device so that only your instance can open it, and is accepted only over that sealed connection, never in plain text. This device does not keep it.',
    );
    expect(HOSTED_AGREED_TEXT).toBe(
      'On: your instance has recorded that you agree. Untick the box to withdraw it at any time.',
    );
    expect(hostedPressSends(ENDPOINT)).toBe(
      'This sends your ride, from your instance, to https://api.example.com. You agreed to that on the Instance screen, which lists everything it is sent and is where you withdraw it.',
    );
    expect(hostedConsentMoved('a.example', 'b.example')).toBe(
      'Your key is now for b.example, and what you agreed to was a.example, so your instance has withdrawn that agreement. Nothing is sent to b.example until you agree below.',
    );
    expect(hostedConsentElsewhere('a.example', 'b.example')).toBe(
      'What you agreed to was a.example, and your key is for b.example. Nothing is sent to either until you agree below.',
    );
    expect(hostedConsentWithoutKey('a.example')).toBe(
      'Your instance has your agreement for a.example recorded, and holds no key of yours, so nothing is sent.',
    );
    expect(
      hostedKeyHeldText({ host: 'a.example', model: 'm', reasoningTokens: 2048, setBy: 'app' }),
    ).toBe(
      'Your instance holds your key for a.example, model m. It may spend 2048 tokens reasoning.',
    );
    expect(
      hostedKeyHeldText({ host: 'a.example', model: 'm', reasoningTokens: null, setBy: 'app' }),
    ).toBe('Your instance holds your key for a.example, model m.');
    expect(
      hostedKeyHeldText({
        host: 'a.example',
        model: 'm',
        reasoningTokens: null,
        setBy: 'operator-command',
      }),
    ).toBe(
      'The operator’s command set this account’s key: a.example, model m. Only that command removes it.',
    );
  });

  it('says every error in these words', () => {
    expect({
      ...HOSTED_ANSWER_REFUSAL_TEXT,
      unreadable: HOSTED_UNREADABLE,
      notOffered: HOSTED_NOT_OFFERED,
      notAccepted: HOSTED_NOT_ACCEPTED,
      maskingNotSent: HOSTED_MASKING_NOT_SENT,
      testUnreadable: HOSTED_TEST_UNREADABLE,
    }).toStrictEqual({
      'no-address': 'Enter the address of the service, starting with https://.',
      'not-https':
        'The address has to start with https://, so that your key is not sent across the internet unencrypted.',
      'has-credentials':
        'The address has a name or password in it. Put your key in the key box instead.',
      'no-model': 'Enter the name of the model the service should use. There is no default.',
      'model-has-spaces': 'A model’s name has no spaces in it. Enter it as the service names it.',
      'no-key': 'Enter your key for the service. This app has none of its own.',
      'key-not-printable':
        'That key has a space or a character a key cannot have in it. Paste it again without the spaces.',
      'reasoning-not-a-count':
        'Enter a whole number from 1 to 16384 for the reasoning tokens, or leave the box empty.',
      unreadable:
        'Your instance did not answer, or answered something this app cannot read. Nothing was changed, and nothing was sent to a service.',
      notOffered:
        'Your instance cannot hold a rider’s own key: it runs a version from before this, or its operator has not set it up to encrypt one. Nothing was stored, and nothing was sent to a service.',
      notAccepted:
        'Your instance did not accept that address, model name or key. Nothing was stored.',
      maskingNotSent:
        'This device could not give your instance your list of words to mask and your privacy zones, so nothing was agreed and nothing was sent to the service.',
      testUnreadable:
        'Your instance did not say how the test question went. It may run a version from before this, or it may not have answered in time.',
    });
  });

  it('says how a test question went in these words', () => {
    const said = (result: HostedTestResult, reasoned = false, allowanceSet = false): string =>
      hostedTestText(result, 'a.example', { reasoned, allowanceSet });
    expect(said('answered')).toBe('a.example answered the test question.');
    expect(said('answered', true)).toBe(
      'a.example answered the test question. It reasoned before it answered. If its write-ups come back cut short, store your key again with the tokens it may spend reasoning.',
    );
    expect(said('answered', true, true)).toBe('a.example answered the test question.');
    expect(said('no-answer')).toBe(
      'a.example replied without an answer. A model that reasons before it answers can use up what it is allowed first: store your key again with the tokens it may spend reasoning, then send the test question again.',
    );
    expect(said('not-ready')).toBe(
      'Your instance did not send it. It sends a service something only when it holds a key of yours, your agreement naming that key’s service, and your list of words to mask. Nothing was sent.',
    );
    expect(said('refused')).toBe(
      'a.example refused the test question. Check your key and the model’s name.',
    );
    expect(said('unreachable')).toBe(
      'Your instance could not reach a.example. Check the address, and that your instance can reach the internet.',
    );
    expect(said('timed-out')).toBe('a.example did not answer within half a minute.');
    expect(said('failed')).toBe(
      'a.example had an error, or sent an answer your instance could not read. Try again later.',
    );
  });

  it('keeps visible the lead, who could read the key, and the whole consent', () => {
    expect(hostedKeptVisible(ENDPOINT)).toStrictEqual([
      HOSTED_PANEL_LEAD,
      `${HOSTED_KEY_OPERATOR_CAN_READ} ${HOSTED_KEY_SEALED_ONLY}`,
      consent.headline,
      ...consent.paragraphs,
      consent.notNeeded,
    ]);
  });
});
