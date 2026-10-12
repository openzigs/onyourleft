// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A scripted instance for the hosted-service section** (#1251), for tests
 * only: it holds a key and a consent the way an instance does — a key at
 * another origin withdraws the consent — and records every press. The real
 * port, against a real instance, is `hosted-settings.test.ts`.
 */

import type { HostedTestResult } from './hosted-consent';
import { hostedKeyRequest } from './hosted-settings';
import type {
  HostedKeyAnswers,
  HostedSettings,
  HostedSettingsOutcome,
  HostedSettingsPort,
  HostedTestOutcome,
} from './hosted-settings-port';

export interface ScriptedHostedSettings {
  readonly port: HostedSettingsPort;
  /** Every press, in order — and for a stored key, what was typed. */
  readonly presses: string[];
  /** What the scripted instance holds now. */
  held: HostedSettings;
  /** When set, the next press fails with this sentence and changes nothing. */
  failNext: string | undefined;
  /** What the test question answers. */
  test: HostedTestOutcome;
  /** The answers the last stored key was typed as. */
  lastAnswers: HostedKeyAnswers | undefined;
}

export function scriptedHostedSettings(
  held: HostedSettings = { key: null, consent: null },
  test: { readonly result: HostedTestResult; readonly reasoned: boolean } = {
    result: 'answered',
    reasoned: false,
  },
): ScriptedHostedSettings {
  const answer = (press: string, change: () => void): Promise<HostedSettingsOutcome> => {
    scripted.presses.push(press);
    if (scripted.failNext !== undefined) {
      const text = scripted.failNext;
      scripted.failNext = undefined;
      return Promise.resolve({ kind: 'failed', text });
    }
    change();
    return Promise.resolve({ kind: 'held', settings: scripted.held });
  };
  const scripted: ScriptedHostedSettings = {
    presses: [],
    held,
    failNext: undefined,
    test: { kind: 'tested', ...test },
    lastAnswers: undefined,
    port: {
      readHostedSettings: () => answer('read', () => undefined),
      storeHostedKey: (answers) =>
        answer('store', () => {
          scripted.lastAnswers = answers;
          const request = hostedKeyRequest(answers);
          if (!request.ok) throw new Error(`the scripted instance was sent ${request.refusal}`);
          const url = new URL(request.body.url as string);
          const reasoning = request.body.reasoningTokens;
          scripted.held = {
            key: {
              origin: url.origin,
              host: url.host,
              model: request.body.model as string,
              reasoningTokens: typeof reasoning === 'number' ? reasoning : null,
              setBy: 'app',
            },
            // As the instance does: a key at another origin withdraws the consent.
            consent: scripted.held.consent?.origin === url.origin ? scripted.held.consent : null,
          };
        }),
      removeHostedKey: () =>
        answer('remove', () => {
          scripted.held = { ...scripted.held, key: null };
        }),
      agreeToHostedService: (endpoint) =>
        answer(`agree ${endpoint}`, () => {
          scripted.held = { ...scripted.held, consent: { origin: endpoint } };
        }),
      withdrawHostedAgreement: () =>
        answer('withdraw', () => {
          scripted.held = { ...scripted.held, consent: null };
        }),
      sendHostedTestQuestion: () => {
        scripted.presses.push('test');
        return Promise.resolve(scripted.test);
      },
    },
  };
  return scripted;
}

/** A key the scripted instance holds for `https://models.example`. */
export const SCRIPTED_HOSTED_KEY: NonNullable<HostedSettings['key']> = {
  origin: 'https://models.example',
  host: 'models.example',
  model: 'a-model',
  reasoningTokens: null,
  setBy: 'app',
};
