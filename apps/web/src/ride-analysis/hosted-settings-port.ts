// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the Instance screen asks of the rider's instance about a hosted
 * model service on the rider's own key** —
 * [#1251](https://github.com/openzigs/onyourleft/issues/1251), over the five
 * sealed-only routes #1199 added and the test question's.
 *
 * `hosted-settings.ts` §`createHostedSettingsPort` implements it and
 * `main.tsx` builds it; `HostedServicePanel.tsx` is its one reader.
 *
 * ## Why a `*-port.ts`, and the names
 *
 * docs/agents/wiring-gate.md §4j: `check:wiring` watches every `*-port.ts`,
 * so a method here that no production code calls is a red `WIRE003`. The
 * names are distinctive for `camera-port.ts`' measured reason.
 *
 * ## What never crosses it
 *
 * The key goes IN once, in {@link HostedKeyAnswers}, and never comes out: the
 * instance does not send it back, and nothing here returns it, stores it or
 * puts it in a sentence. Every failure is a sentence of this app's
 * (`hosted-consent.ts`), never the instance's or the service's own words.
 */

import type { HostedTestResult } from './hosted-consent';

/** What the instance holds of the rider's hosted settings. Never the key. */
export interface HostedSettings {
  readonly key: {
    /** The `https:` origin a request goes to — what a consent has to name. */
    readonly origin: string;
    /** That origin's host, as the rider is shown it. */
    readonly host: string;
    readonly model: string;
    /** What the rider said a turn may spend reasoning (#1268), or `null`. */
    readonly reasoningTokens: number | null;
    /** `app`: the rider stored it. `operator-command`: the operator's own, for their own account. */
    readonly setBy: 'app' | 'operator-command';
  } | null;
  /** The origin the rider's recorded consent names, or `null` for none. */
  readonly consent: { readonly origin: string } | null;
}

/** What the rider typed. The key is in it, and is in nothing that comes back. */
export interface HostedKeyAnswers {
  readonly address: string;
  readonly model: string;
  readonly key: string;
  /** As typed: empty for "find out", otherwise a whole number of tokens. */
  readonly reasoningTokens: string;
}

/** What the instance holds now, or the sentence that says why it could not be had or changed. */
export type HostedSettingsOutcome =
  | { readonly kind: 'held'; readonly settings: HostedSettings }
  | { readonly kind: 'failed'; readonly text: string };

/** How a test question went, or the sentence that says it could not be asked. */
export type HostedTestOutcome =
  | { readonly kind: 'tested'; readonly result: HostedTestResult; readonly reasoned: boolean }
  | { readonly kind: 'failed'; readonly text: string };

export interface HostedSettingsPort {
  /** Read what the instance holds. One sealed request; sends nothing to any service. */
  readHostedSettings(): Promise<HostedSettingsOutcome>;
  /**
   * Store the rider's own key on their instance, sealed and padded (ADR 0046
   * D-9), replacing any they stored. Refused here, with nothing sent, when
   * what was typed is not an `https:` address, a model name and a key.
   */
  storeHostedKey(answers: HostedKeyAnswers): Promise<HostedSettingsOutcome>;
  /** Remove the key the rider stored from their instance. */
  removeHostedKey(): Promise<HostedSettingsOutcome>;
  /**
   * Record the rider's consent naming `endpoint`. ⚠️ The rider's masking list
   * and privacy zones go to the instance FIRST: without them the instance
   * sends a service nothing, and with a stale copy it would mask with one.
   */
  agreeToHostedService(endpoint: string): Promise<HostedSettingsOutcome>;
  /** Withdraw the rider's consent. */
  withdrawHostedAgreement(): Promise<HostedSettingsOutcome>;
  /** Have the instance send the service one test question carrying none of the rider's data. */
  sendHostedTestQuestion(): Promise<HostedTestOutcome>;
}
