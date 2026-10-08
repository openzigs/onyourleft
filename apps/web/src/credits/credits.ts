// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Turning `ASSETS.toml`'s rows into the credits a rider reads — #358.
 *
 * Pure, and separate from the view for the reason every other derivation in
 * this client is: what gets credited is a licensing question with a right
 * answer, and it is checkable without a DOM. `CreditsView.tsx` renders what
 * this returns and decides nothing.
 *
 * ## The lists, and why they are four
 *
 * - **{@link Credits.required}** — every entry whose licence is in
 *   {@link ATTRIBUTION_LICENCES}. [ADR 0023](../../../../docs/adr/0023-cc-by-assets-and-attribution.md)
 *   §Consequences puts it plainly: an entry missing from here is a build
 *   distributing that asset unlicensed. This list is the obligation.
 * - **{@link Credits.licenceCopy}** — every entry that records a
 *   {@link AssetEntry.creator} and whose licence is in
 *   {@link LICENCE_COPY_LICENCES}: a credit is not asked for, but a copy of
 *   the licence has to travel with the work (Apache-2.0 §4(a)), so each one
 *   links the copy this app ships. #597.
 * - **{@link Credits.courtesy}** — every entry that records a creator and
 *   whose licence is in {@link NOTHING_ASKED_LICENCES}. #358's third bullet:
 *   CC0 assets *may* be listed and are not required to be, *"and the screen
 *   must not imply an obligation that does not exist"*. So they are rendered
 *   under their own heading, in their own words, and never mixed in.
 * - **{@link Credits.unclassified}** — a credited entry under any other
 *   licence, which is also a {@link Credits.problems} line.
 *
 * ⚠️ **The courtesy list is chosen by an allowlist, and until #597 it was
 * "everything else".** The section says its licences ask for nothing in
 * return, and "everything that is not CC BY" put the map's Roboto glyphs and
 * the pose model under that sentence — both Apache-2.0, whose §4(a) asks for
 * the licence text to travel with the work. A licence nobody has read here is
 * therefore neither courtesy nor obligation: it is shown, and said to be
 * unclassified, because the sentence above it would otherwise be a claim about
 * a licence nobody checked.
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
 * script and compares, because `docs/agents/licence-gates.md` §4g records exactly this hazard
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
 * The licences that ask for a copy of their own text to travel with the work,
 * and do not ask for a credit — #597.
 *
 * Apache-2.0 §4(a): *"You must give any other recipients of the Work or
 * Derivative Works a copy of this License"*. §4(d) adds the upstream `NOTICE`
 * file where there is one; for the two Apache-2.0 works credited today there
 * is none — `googlefonts/roboto-2` at `v2.138` and its release archive carry a
 * `LICENSE` and no `NOTICE`, and the pose model's `.task` bundle holds two
 * `.tflite` files and nothing else (both read 2026-09-26). A new Apache-2.0
 * asset re-asks that question; see `ASSETS.toml` above the pose model.
 *
 * `OFL-1.1` since #991 (ADR 0043 D-2): the SIL Open Font License's condition
 * 2 is that each copy of the font "contains the above copyright notice and
 * this license" — the same shape as Apache-2.0 §4(a). The notice is the
 * credit's creator, and travels in each font's name table too; the licence is
 * the copy linked here.
 *
 * ⚠️ Every licence here must have a {@link SHIPPED_LICENCE_TEXTS} entry, or
 * {@link creditsFrom} reports the work as shipping without its licence.
 * `MIT` and the BSDs ask for their notice to travel too, and are deliberately
 * not listed: no MIT or BSD entry records a creator, so none is credited, and
 * one that did would land in {@link Credits.unclassified} rather than under a
 * sentence nobody checked.
 */
export const LICENCE_COPY_LICENCES: readonly string[] = ['Apache-2.0', 'OFL-1.1'];

/**
 * The licences that ask for nothing at all, which is what the courtesy
 * section's wording says of them. An allowlist, on purpose — see the header.
 */
export const NOTHING_ASKED_LICENCES: readonly string[] = ['CC0-1.0'];

/**
 * The licence texts this app SHIPS, relative to the page — #597.
 *
 * Relative for `map/basemap.ts` §`GLYPHS_URL`'s reason: it resolves against
 * this deployment's own origin, and inside the Android shell against
 * `https://localhost`, so the text is in the APK rather than on somebody
 * else's server. The files are in `apps/web/public/licences/`, which Vite
 * copies into `dist` verbatim and the service worker precaches;
 * `credits.test.ts` holds each one byte-identical to the canonical text
 * `LIC005` pins.
 */
export const SHIPPED_LICENCE_TEXTS: Readonly<Record<string, string>> = {
  'Apache-2.0': './licences/Apache-2.0.txt',
  // Written by `tools/fonts/subset-fonts.ts` from the display face's own
  // OFL.txt, the licence's text without Barlow's copyright line above it
  // (#991): the line is the credit's creator, so one text serves any OFL face.
  'OFL-1.1': './licences/OFL-1.1.txt',
};

/**
 * The licence texts a credit can point at.
 *
 * A shipped copy, or a canonical URL that is published and stable. A licence
 * absent from both renders as its identifier alone, which is still a true
 * statement — a guessed URL is not, and CC BY 4.0 §3(a)(1)(A)(iii) asks for a
 * notice *referring to this Public License* rather than to something like it.
 */
const LICENCE_TEXTS: Readonly<Record<string, string>> = {
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  ...SHIPPED_LICENCE_TEXTS,
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
  /** What the licence asks of this app — which section the work is listed in. */
  readonly terms: LicenceTerms;
  /** Repository-relative paths, in manifest order. */
  readonly files: readonly string[];
}

/**
 * What a licence asks of this app, as far as this page is concerned.
 *
 * - `attribution` — a credit, every time it ships ({@link ATTRIBUTION_LICENCES}).
 * - `licence-copy` — a copy of the licence text, and no credit
 *   ({@link LICENCE_COPY_LICENCES}).
 * - `nothing` — nothing at all ({@link NOTHING_ASKED_LICENCES}).
 * - `unclassified` — a licence this page has not been told about.
 */
export type LicenceTerms = 'attribution' | 'licence-copy' | 'nothing' | 'unclassified';

/** What this licence asks of the app. Equality, never a prefix. */
export function licenceTerms(licence: string): LicenceTerms {
  if (ATTRIBUTION_LICENCES.includes(licence)) {
    return 'attribution';
  }
  if (LICENCE_COPY_LICENCES.includes(licence)) {
    return 'licence-copy';
  }
  return NOTHING_ASKED_LICENCES.includes(licence) ? 'nothing' : 'unclassified';
}

export interface Credits {
  readonly required: readonly CreditedWork[];
  /** Credited, each with a link to the copy of its licence this app ships. */
  readonly licenceCopy: readonly CreditedWork[];
  readonly courtesy: readonly CreditedWork[];
  /** Credited under a licence this page does not describe. */
  readonly unclassified: readonly CreditedWork[];
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

/**
 * Works the build COPIES into the app rather than committing — #618 — so no
 * `ASSETS.toml` row can credit them, and whose licence is not the one their
 * package declares, so no closure does either.
 *
 * The one today is Binomial's **Basis Universal** transcoder, v1.50, which
 * `three@0.185.1` (MIT) vendors under `examples/jsm/libs/basis/` and
 * `tools/basis/transcoder-plugin.ts` copies into `realistic/basis/` for the
 * realistic world's KTX2 textures. It is **Apache-2.0** — its README and
 * upstream's `LICENSE` at the v1.50 tag, read by hand on 2026-09-27 because
 * `DEP001` reads only three's MIT (ADR 0026 D-8) — so §4(a)'s copy of the
 * licence travels with it, and it is listed with the works that ask for that.
 * v1.50 carries no `NOTICE` (upstream added one in February 2026, after it),
 * so §4(d) asks for nothing more. Zstandard's decoder, compiled into the
 * `.wasm`, is BSD-3-Clause; its notice is reproduced in the third-party
 * notices, which the last section of the screen links.
 *
 * ⚠️ The paths are where the files are in the BUILD, not in the repository:
 * there is no repository path, because nothing is committed. *
 * ⚠️ **KTX-Parse and zstddec are deliberately NOT here** (#618's review). three
 * vendors them too and `KTX2Loader` bundles both into the renderer chunk, but
 * they are MIT — zstddec's inlined Zstandard decoder BSD-3-Clause — and
 * neither licence is in {@link LICENCE_COPY_LICENCES} or
 * {@link ATTRIBUTION_LICENCES}: they ask for their notice to travel with the
 * code, exactly as three's own MIT does, and three is not listed here either.
 * Their notices are in the third-party notices (`third-party-notices.json`
 * §`vendoredIntoBundle`), which the screen's last section links. The rule
 * this list follows is the licence's, not the file's route into the build.
 */
export const COPIED_WORKS: readonly AssetEntry[] = [
  'basis_transcoder.js',
  'basis_transcoder.wasm',
].map((file) => ({
  path: `realistic/basis/${file}`,
  source: 'Basis Universal v1.50, as three 0.185.1 vendors it, copied into the build',
  licence: 'Apache-2.0',
  read: '2026-09-27',
  sha256: '',
  creator:
    'Binomial LLC — Basis Universal’s transcoder, v1.50, with Zstandard’s BSD-3-Clause decoder compiled in',
  url: 'https://github.com/BinomialLLC/basis_universal',
  modified: 'no',
}));

/** The credits a manifest yields, and everything that got in the way. */
export function creditsFrom(manifest: ParsedManifest, copied: readonly AssetEntry[] = []): Credits {
  const problems = manifest.problems.map(
    (problem) => `ASSETS.toml line ${String(problem.line)}: ${problem.message}`,
  );
  const works = new Map<string, { first: AssetEntry; files: string[] }>();

  for (const entry of [...manifest.entries, ...copied]) {
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
    terms: licenceTerms(first.licence),
    files,
  }));
  for (const work of all) {
    if (work.terms === 'licence-copy' && SHIPPED_LICENCE_TEXTS[work.licence] === undefined) {
      // Apache-2.0 §4(a) is met by the copy travelling with the work, and a
      // credit linking none is this app shipping the work without it.
      problems.push(
        `${work.files.join(', ')} is under ${work.licence}, which asks for a copy of the licence ` +
          'to travel with it, and this app ships no copy of that licence',
      );
    }
    if (work.terms === 'unclassified') {
      problems.push(
        `${work.files.join(', ')} is under ${work.licence}, and this page has not been told what ` +
          'that licence asks for',
      );
    }
  }
  const withTerms = (terms: LicenceTerms): readonly CreditedWork[] =>
    all.filter((work) => work.terms === terms);
  return {
    required: withTerms('attribution'),
    licenceCopy: withTerms('licence-copy'),
    courtesy: withTerms('nothing'),
    unclassified: withTerms('unclassified'),
    problems,
  };
}
