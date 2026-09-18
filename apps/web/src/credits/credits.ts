// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Turning `ASSETS.toml`'s rows into the credits a rider reads — #358.
 *
 * Pure, and separate from the view for the reason every other derivation in
 * this client is: what gets credited is a licensing question with a right
 * answer, and it is checkable without a DOM. `CreditsView.tsx` renders what
 * this returns and decides nothing.
 *
 * ## The two lists, and why they are two
 *
 * - **{@link Credits.required}** — every entry whose licence is in
 *   {@link ATTRIBUTION_LICENCES}. [ADR 0023](../../../../docs/adr/0023-cc-by-assets-and-attribution.md)
 *   §Consequences puts it plainly: an entry missing from here is a build
 *   distributing that asset unlicensed. This list is the obligation.
 * - **{@link Credits.courtesy}** — every other entry that records a
 *   {@link AssetEntry.creator}. #358's third bullet: CC0 assets *may* be
 *   listed and are not required to be, *"and the screen must not imply an
 *   obligation that does not exist"*. So they are rendered under their own
 *   heading, in their own words, and never mixed in.
 *
 * ⚠️ **Recording a creator is what opts an asset into the courtesy list**,
 * rather than a licence test or a path test. `ASSET006` accepts the three
 * attribution keys on *any* entry — *"recording more than a licence demands is
 * never the failure"* — so the manifest already says, per row, whether there is
 * somebody to credit. The twelve generated FIT fixtures carry no creator
 * because there is none; the Capacitor template files carry none for now.
 *
 * ## What is deliberately not filtered
 *
 * Not by path. A `CC-BY-4.0` row under `packages/` is refused by `ASSET004`
 * and so cannot exist — but answering *"and therefore it owes no attribution"*
 * would be the right outcome reached by the wrong reasoning, which is the
 * distinction `asset_attribution_required` in the shell makes for itself. If
 * one ever reaches this code it is credited, and the build that let it through
 * is the thing that is wrong.
 */

import type { AssetEntry, ParsedManifest } from './manifest';

/**
 * The licences that oblige this application to credit the work.
 *
 * ⚠️ **This is `ASSET_LICENCES_ATTRIBUTED` from `scripts/check-repo-rules.sh`,
 * second.** That one decides which entries `ASSET006` demands `creator`, `url`
 * and `modified` on; this one decides which entries the screen credits. Drift
 * between them is silent in both directions and `credits.test.ts` reads the
 * script and compares, because `CLAUDE.md` §4g records exactly this hazard
 * between ADR 0015's prose tables and `check-dependency-licences.mjs`'s
 * `POLICY` and says nothing mechanically prevents it.
 *
 * Exactly these identifiers, matched by equality and never by prefix:
 * `CC-BY-NC-4.0` differs by two letters and by a world of obligation
 * (ADR 0023 D-2), and `CC-BY-3.0` and `CC-BY-SA-4.0` are different texts
 * nobody here has read (D-1).
 */
export const ATTRIBUTION_LICENCES: readonly string[] = ['CC-BY-4.0'];

/**
 * The licence texts a credit can point at.
 *
 * Only identifiers whose canonical URL is published and stable. A licence
 * absent from here renders as its identifier alone, which is still a true
 * statement — a guessed URL is not, and CC BY 4.0 §3(a)(1)(A)(iii) asks for a
 * notice *referring to this Public License* rather than to something like it.
 */
const LICENCE_TEXTS: Readonly<Record<string, string>> = {
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
};

/**
 * A link the screen is willing to render, or `undefined`.
 *
 * ⚠️ **Only `https:` and `http:`.** `ASSETS.toml` is committed source and a
 * reviewed file, so this is not a hole anyone is standing at — but a `url`
 * value is the one thing on this page that reaches the DOM as an *attribute*
 * rather than as text, and `javascript:` in an `href` is script execution on a
 * page a rider opened to read a licence notice. React escapes the text of
 * every other field for us; it does not refuse that scheme. The guard is three
 * lines and the alternative is trusting a data file with the same weight as
 * code.
 *
 * A refused URL renders as no link rather than as a broken one, so the creator
 * and the licence are still credited.
 */
export function externalLink(url: string | undefined): string | undefined {
  if (url === undefined) {
    return undefined;
  }
  return /^https?:\/\//i.test(url) ? url : undefined;
}

/** Where a licence's own text is published, or `undefined`. */
export function licenceLink(licence: string): string | undefined {
  return LICENCE_TEXTS[licence];
}

/** One work to credit, and the files this repository took from it. */
export interface CreditedWork {
  /** As the source gives it. Empty only where the manifest records none. */
  readonly creator: string;
  /** A link to the material — CC BY 4.0 §3(a)(1)(A)(iv). */
  readonly url?: string;
  /** The SPDX identifier the manifest records. */
  readonly licence: string;
  /**
   * What this repository changed, in words, or `"no"`.
   *
   * ADR 0023 D-4: merging parts, rescaling and substituting the material are
   * all modifications, and §3(a)(1)(B) is the clause most often missed because
   * none of the three feels like one.
   */
  readonly modified?: string;
  /** Whether the licence obliges the credit, or it is offered anyway. */
  readonly attributionRequired: boolean;
  /** Repository-relative paths, in manifest order. */
  readonly files: readonly string[];
}

export interface Credits {
  readonly required: readonly CreditedWork[];
  readonly courtesy: readonly CreditedWork[];
  /**
   * Everything that stopped this being a complete answer, in words.
   *
   * Rendered on the screen rather than logged. A manifest line nobody could
   * read is an asset nobody is credited for, and the only reader who can act
   * on that is one who can see it.
   */
  readonly problems: readonly string[];
}

/** Does this licence oblige a credit? Equality, never a prefix. */
export function requiresAttribution(licence: string): boolean {
  return ATTRIBUTION_LICENCES.includes(licence);
}

/**
 * One work is one (creator, material, licence, modification) — see the tests.
 *
 * Joined on a double quote because the manifest's own grammar forbids one
 * inside a value (`key = "[^"]*"`), so no pair of different works can collide
 * on a separator a value happened to contain.
 */
function workKey(entry: AssetEntry): string {
  return [entry.creator ?? '', entry.url ?? '', entry.licence, entry.modified ?? ''].join('"');
}

/** The credits a manifest yields, and everything that got in the way. */
export function creditsFrom(manifest: ParsedManifest): Credits {
  const problems = manifest.problems.map(
    (problem) => `ASSETS.toml line ${String(problem.line)}: ${problem.message}`,
  );
  const works = new Map<string, { first: AssetEntry; files: string[] }>();

  for (const entry of manifest.entries) {
    const required = requiresAttribution(entry.licence);
    if (!required && entry.creator === undefined) {
      continue;
    }
    if (required) {
      const absent = (['creator', 'url', 'modified'] as const).filter(
        (key) => entry[key] === undefined,
      );
      if (absent.length > 0) {
        // `ASSET006` already fails the build on this, so it cannot reach a
        // release — and the screen says it rather than rendering a row that
        // looks complete. Dropping the row instead would be the one outcome
        // ADR 0023 §Consequences names as a licensing defect.
        problems.push(
          `${entry.path} is under ${entry.licence}, which requires attribution, and the manifest ` +
            `records no ${absent.join(', ')} for it`,
        );
      }
    }
    const key = workKey(entry);
    const existing = works.get(key);
    if (existing === undefined) {
      works.set(key, { first: entry, files: [entry.path] });
    } else {
      existing.files.push(entry.path);
    }
  }

  const all: readonly CreditedWork[] = [...works.values()].map(({ first, files }) => ({
    creator: first.creator ?? '',
    ...(first.url === undefined ? {} : { url: first.url }),
    licence: first.licence,
    ...(first.modified === undefined ? {} : { modified: first.modified }),
    attributionRequired: requiresAttribution(first.licence),
    files,
  }));
  return {
    required: all.filter((work) => work.attributionRequired),
    courtesy: all.filter((work) => !work.attributionRequired),
    problems,
  };
}
