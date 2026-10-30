// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Every sentence a rider reads about a hosted model service on their own
 * key, held by their instance** —
 * [#1251](https://github.com/openzigs/onyourleft/issues/1251), and
 * [#1104](https://github.com/openzigs/onyourleft/issues/1104)'s B1 and B2.
 *
 * One module, so the owner can approve the wording by reading one file, and so
 * the Instance screen, the ride's page and `docs/privacy-policy.md` cannot say
 * three things (`hosted-consent.test.ts` and `hosted-instance-policy.test.ts`
 * hold them together).
 *
 * **Approved by the owner on PR #1303 on 2026-10-12** (*"1303 looks good"*),
 * which quoted every string below; #1104's ruling of 2026-10-26 then changed
 * "own machine" to "its own machine or its own private network", because the
 * instance's model may be anywhere on its private network
 * (`apps/instance` §`history/address.ts`), never only on its own host.
 *
 * ## The rulings the wording is bound by
 *
 * - A hosted model runs only on the rider's OWN key, never the operator's
 *   (Share mode withdrawn, 2026-10-09). So B1's *Share mode* paragraph is gone
 *   and there is one key paragraph.
 * - The consent is recorded on the instance, **names the endpoint**, and can be
 *   withdrawn at any time, with no per-launch switch (B1 question 1).
 * - A test question is sent by the instance with none of the rider's data
 *   (B1 question 2).
 * - The list includes *summaries of older rides* (2026-10-09).
 * - A key is accepted only over the sealed connection (B6 as amended).
 * - A model that reasons needs its allowance (#1268).
 *
 * ## Where this departs from B1 as drafted on #1104, and why
 *
 * 1. **"Your instance keeps a record of what was actually sent, and you can
 *    read it on the ride's page afterwards" is NOT here.** Nothing in
 *    `apps/instance` keeps such a record and no page shows one, and a consent
 *    may not describe what the software does not do (ADR 0029).
 * 2. **"It is never sent a picture" is narrowed to "A ride analysis never
 *    sends it a picture".** Since #1106 the same service CAN be sent the side
 *    camera's pictures, under that feature's own separate consent.
 * 3. **One sentence is new**: that this device gives the instance the rider's
 *    list of words to mask and their privacy zones. The instance masks with
 *    its own copy (`apps/instance` §`analysis/hosted.ts`), and until this
 *    issue nothing in the app sent it one — so every hosted job would have
 *    been refused. #1104 B6 has the approved policy row for it.
 * 4. **#1104 B1-a, after it**: *"Your instance deletes them when you withdraw
 *    or remove your key."* — the owner's ruling of 2026-10-26, which the
 *    instance carries out (`apps/instance` §`analysis/hosted-settings.ts`).
 *
 * It names no vendor and no model (ADR 0031 D-4): the service is named by the
 * address the rider typed.
 */

/**
 * What masking cannot promise, in one sentence — in the consent below and at
 * the start of Settings' masked-words caveat (`athlete/MaskedWordsPanel.tsx`
 * §`MASKED_WORDS_CAVEAT`), shared so the two cannot drift (#1048). Here since
 * #1103 removed `camera/hosted-model.ts`, where it was first written.
 */
export const MASKING_LIMIT =
  'Masking reduces what is sent; it does not guarantee that nothing personal gets through.';

/** The press that sends the test question, named in the consent itself. */
export const HOSTED_TEST_BUTTON = 'Send a test question';

/** #1104 B2, word for word: who else could read a key the rider brings (ruling 5). */
export const HOSTED_KEY_OPERATOR_CAN_READ =
  'Whoever runs your instance holds the secret your key is encrypted with, so they could read ' +
  'your key. If that is not you, only use a key you are willing to let them see.';

/** How a key reaches the instance (#1104 B6's key bullet, as the owner amended it). */
export const HOSTED_KEY_SEALED_ONLY =
  'Your key is sealed on this device so that only your instance can open it, and is accepted ' +
  'only over that sealed connection, never in plain text. This device does not keep it.';

/** The hosted consent, as the Instance screen shows it for one endpoint. */
export interface HostedInstanceConsent {
  readonly headline: string;
  /** What is sent, who that is, what is never sent and what masking does, the key, the test, a moved address. */
  readonly paragraphs: readonly string[];
  readonly notNeeded: string;
  /** True only while the rider has NOT agreed: the screen says something else once they have. */
  readonly offUntilOn: string;
}

/**
 * #1104 B1 for `endpoint` — the origin the consent names, for example
 * `https://api.example.com`. See the file comment for the four departures
 * from the draft.
 */
export function hostedInstanceConsent(endpoint: string): HostedInstanceConsent {
  return {
    headline: `This sends your ride, from your instance, to ${endpoint}.`,
    paragraphs: [
      'If you agree, each time you ask for a ride analysis by this service, your instance sends ' +
        `that ride's numbers to ${endpoint}: your heart rate, cadence and power, your weight and ` +
        'watts per kilogram, your threshold power, if you set one, how long the ride lasted, its ' +
        "distance, and each section's gradient and total climb, and how it went section by " +
        'section. If the side camera filmed the ride, it is also sent how a few measurements of ' +
        'your riding position changed between the start and the end of filming. While it writes, ' +
        'the model may look up more on your instance and be sent it: short summaries of your ' +
        'recent rides, summaries of older rides, what you wrote about your goals, your notes and ' +
        'documents, your saved workouts, and earlier write-ups. The model decides during the ' +
        'analysis which of these it looks up, so the app cannot list them in advance.',
      'That is a company or a computer that is not yours and not ours, and we cannot see what ' +
        'they do with it or how long they keep it. We cannot delete it for you afterwards. It ' +
        "sees your instance's internet address, not this device's.",
      'A ride analysis never sends it a picture — not a photograph of you, and nothing made from ' +
        "one. The ride's numbers carry no name, no place and no date. But what you wrote " +
        'yourself can say anything, so this cannot promise that your name, where you ride or ' +
        'when is never sent. Before anything is sent, your instance masks e-mail addresses, phone ' +
        'numbers, links, street addresses, postcodes, coordinates, the names of your privacy ' +
        `zones and everything on your list of words to mask. ${MASKING_LIMIT}`,
      'So that your instance can mask, this device sends it your list of words to mask and your ' +
        'privacy zones — their names, where they are and how large — when you agree, and again ' +
        'each time you ask for a ride analysis by this service. They are sealed on the way, and ' +
        'your instance keeps them with your account. Your instance deletes them when you ' +
        'withdraw or remove your key.',
      `Your key is held by your instance, encrypted, and is sent only to ${endpoint}. It is never ` +
        'sent back to this device and is never put in a file the app or your instance exports. ' +
        HOSTED_KEY_OPERATOR_CAN_READ,
      `When you press '${HOSTED_TEST_BUTTON}', your instance sends it one test question, ` +
        'containing none of your data, to check it answers.',
      "If the service's address changes, you are asked again before anything is sent to the new " +
        'one.',
    ],
    notNeeded:
      'You do not need this. Everything else in the app works without it, and a model your ' +
      'instance runs on its own machine or its own private network can write the same analysis ' +
      'without sending anything to a service.',
    offUntilOn: 'This is off. It stays off until you agree, and you can withdraw it at any time.',
  };
}

/** The consent's switch, naming the endpoint. */
export function hostedAgreeLabel(endpoint: string): string {
  return `I agree to my instance sending my rides to ${endpoint}`;
}

/**
 * Under the switch once the rider has agreed, in place of
 * {@link HostedInstanceConsent.offUntilOn} — one short line (#1013).
 */
export const HOSTED_AGREED_TEXT =
  'On: your instance has recorded that you agree. Untick the box to withdraw it at any time.';

// --- The key screen -----------------------------------------------------------------

export const HOSTED_PANEL_HEADING = 'A hosted model service, on your own key';

/** What the section is, before anything is asked of the rider. */
export const HOSTED_PANEL_LEAD =
  'Your instance can send a ride you ask it to analyse to a hosted model service instead of ' +
  'using a model on its own machine or its own private network — but only on a key of your own, and only after you agree ' +
  'to that service by its address. This app has no key of its own and suggests no service. ' +
  'Nothing is sent to any service until you have stored a key and agreed below.';

export const HOSTED_READING = 'Asking your instance what it holds…';

export const HOSTED_ADDRESS_LABEL = 'The service’s address';
export const HOSTED_ADDRESS_HINT =
  'Starting with https://, as the service gives it for its API. It often ends in /v1.';
export const HOSTED_MODEL_LABEL = 'The model’s name';
export const HOSTED_MODEL_HINT = 'As the service names it. There is no default.';
export const HOSTED_KEY_LABEL = 'Your key for the service';
export const HOSTED_REASONING_LABEL =
  'Tokens the model may spend reasoning before each answer (optional)';
export const HOSTED_REASONING_HINT =
  'Only for a model that reasons before it answers: a whole number from 1 to 16384. Leave it ' +
  'empty and your instance finds out from the model’s replies.';

export const HOSTED_STORE_BUTTON = 'Store my key on my instance';
export const HOSTED_REMOVE_BUTTON = 'Remove my key from my instance';

/** Said where the instance holds no key of the rider's. */
export const HOSTED_NO_KEY = 'Your instance holds no key of yours.';

/**
 * What the instance holds, in words — one short line (#1013). Never the key:
 * the instance does not send it back.
 */
export function hostedKeyHeldText(key: {
  readonly host: string;
  readonly model: string;
  readonly reasoningTokens: number | null;
  readonly setBy: 'app' | 'operator-command';
}): string {
  const reasoning =
    key.reasoningTokens === null
      ? ''
      : ` It may spend ${String(key.reasoningTokens)} tokens reasoning.`;
  return key.setBy === 'app'
    ? `Your instance holds your key for ${key.host}, model ${key.model}.${reasoning}`
    : `The operator’s command set this account’s key: ${key.host}, model ${key.model}. ` +
        'Only that command removes it.';
}

export const HOSTED_KEY_STORED =
  'Your key is stored on your instance. This device has not kept it.';
export const HOSTED_KEY_REMOVED = 'Your key has been removed from your instance.';

/** Said when storing a key for another service withdrew what the rider had agreed to. */
export function hostedConsentMoved(agreed: string, now: string): string {
  return (
    `Your key is now for ${now}, and what you agreed to was ${agreed}, so your instance has ` +
    `withdrawn that agreement. Nothing is sent to ${now} until you agree below.`
  );
}

/** Said when a recorded consent names another service than the key is for. */
export function hostedConsentElsewhere(agreed: string, now: string): string {
  return (
    `What you agreed to was ${agreed}, and your key is for ${now}. Nothing is sent to either ` +
    'until you agree below.'
  );
}

/** Said where a consent is recorded and no key is held. */
export function hostedConsentWithoutKey(agreed: string): string {
  return (
    `Your instance has your agreement for ${agreed} recorded, and holds no key of yours, so ` +
    'nothing is sent.'
  );
}

export function hostedWithdrawLabel(agreed: string): string {
  return `Withdraw what I agreed to for ${agreed}`;
}

export const HOSTED_AGREED = 'Your instance has recorded that you agree.';
export const HOSTED_WITHDRAWN =
  'Your instance has withdrawn your agreement. No ride is sent to the service.';

// --- What can go wrong --------------------------------------------------------------

/** Why what the rider typed was not sent. None repeats what was typed, the key least of all. */
export const HOSTED_ANSWER_REFUSAL_TEXT = {
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
} as const;

export type HostedAnswerRefusal = keyof typeof HOSTED_ANSWER_REFUSAL_TEXT;

/**
 * Said when the instance did not answer a READ of the settings, or answered
 * something this cannot read. Nothing was asked to change, so nothing did.
 */
export const HOSTED_UNREADABLE =
  'Your instance did not answer, or answered something this app cannot read. Nothing was ' +
  'changed, and nothing was sent to a service.';

/**
 * Said when a CHANGE — a key stored or removed, an agreement given or
 * withdrawn — had no answer this can read (#1796). The request may have
 * reached the instance, and been done, before its answer was lost, so this
 * says it cannot tell and never that nothing changed. None of the four sends
 * anything to a service.
 */
export const HOSTED_CHANGE_UNKNOWN =
  'Your instance did not answer, or answered something this app cannot read, so this app ' +
  'cannot tell whether your change was made. Nothing was sent to a service. Open this page ' +
  'again to see what your instance holds.';

/** Said by an instance that cannot hold a rider's own key. */
export const HOSTED_NOT_OFFERED =
  'Your instance cannot hold a rider’s own key: it runs a version from before this, or its ' +
  'operator has not set it up to encrypt one. Nothing was stored, and nothing was sent to a service.';

/** Said when the instance refused what it was sent. It does not say which part: the key is among them. */
export const HOSTED_NOT_ACCEPTED =
  'Your instance did not accept that address, model name or key. Nothing was stored.';

/** Said when the rider's masking list could not be read here or given to the instance. */
export const HOSTED_MASKING_NOT_SENT =
  'This device could not give your instance your list of words to mask and your privacy zones, ' +
  'so nothing was agreed and nothing was sent to the service.';

/** How a test question went, as the instance reports it — a closed list (`apps/instance` §`hosted-test.ts`). */
export type HostedTestResult =
  'answered' | 'no-answer' | 'not-ready' | 'refused' | 'unreachable' | 'timed-out' | 'failed';

/** One sentence for each. `host` is the service's, never a word the service said. */
export function hostedTestText(
  result: HostedTestResult,
  host: string,
  reasoned: { readonly reasoned: boolean; readonly allowanceSet: boolean },
): string {
  switch (result) {
    case 'answered':
      return (
        `${host} answered the test question.` +
        (reasoned.reasoned && !reasoned.allowanceSet
          ? ' It reasoned before it answered. If its write-ups come back cut short, store your ' +
            'key again with the tokens it may spend reasoning.'
          : '')
      );
    case 'no-answer':
      return (
        `${host} replied without an answer. A model that reasons before it answers can use up ` +
        'what it is allowed first: store your key again with the tokens it may spend reasoning, ' +
        'then send the test question again.'
      );
    case 'not-ready':
      return (
        'Your instance did not send it. It sends a service something only when it holds a key ' +
        'of yours, your agreement naming that key’s service, and your list of words to mask. ' +
        'Nothing was sent.'
      );
    case 'refused':
      return `${host} refused the test question. Check your key and the model’s name.`;
    case 'unreachable':
      return `Your instance could not reach ${host}. Check the address, and that your instance can reach the internet.`;
    case 'timed-out':
      return `${host} did not answer within half a minute.`;
    case 'failed':
      return `${host} had an error, or sent an answer your instance could not read. Try again later.`;
  }
}

/** Said when the instance has no route for the test question, or did not answer it. */
export const HOSTED_TEST_UNREADABLE =
  'Your instance did not say how the test question went. It may run a version from before ' +
  'this, or it may not have answered in time.';

/** While the test question is out. */
export const HOSTED_TESTING = 'Your instance is sending the test question…';

/**
 * Every sentence of the section that must never be tucked away (#666) while
 * the instance holds a key for `endpoint`: what the section is, who could
 * read the key and how it travels, and the whole consent.
 * `a11y/kept-visible.a11y.test.tsx` holds the Instance route to it.
 */
export function hostedKeptVisible(endpoint: string): readonly string[] {
  const consent = hostedInstanceConsent(endpoint);
  return [
    HOSTED_PANEL_LEAD,
    `${HOSTED_KEY_OPERATOR_CAN_READ} ${HOSTED_KEY_SEALED_ONLY}`,
    consent.headline,
    ...consent.paragraphs,
    consent.notNeeded,
  ];
}

// --- On a ride's page ---------------------------------------------------------------

/** Beside the hosted press on a ride's page: who is sent the ride, and where the rest is said. */
export function hostedPressSends(endpoint: string): string {
  return (
    `${hostedInstanceConsent(endpoint).headline} You agreed to that on the Instance screen, ` +
    'which lists everything it is sent and is where you withdraw it.'
  );
}
