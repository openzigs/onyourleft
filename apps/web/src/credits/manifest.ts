// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `ASSETS.toml`, read by the application that has to honour what it records.
 *
 * ## Why the client parses the manifest at all
 *
 * [ADR 0023](../../../../docs/adr/0023-cc-by-assets-and-attribution.md) admits `CC-BY-4.0`
 * for a committed asset, and CC BY is the one licence in either set whose
 * obligation does not end: it is discharged by *"the shipped application
 * crediting the work, every time it ships, for as long as it ships"*. A
 * hand-maintained credits list discharges it until somebody adds an asset and
 * forgets, and the failure mode of forgetting is distributing somebody's work
 * unlicensed with a 30-day cure period that starts at discovery.
 *
 * `ASSET001` already forces this manifest to be **complete** — a committed
 * binary it does not name is a red build, and discovery walks the tree for
 * binaries rather than trusting an extension list. A credits screen derived
 * from the manifest is complete for the same reason, which is not a property
 * any list a person edits can have. That inheritance is the whole of #358.
 *
 * ## The subset, and why it is written out rather than taken from a library
 *
 * `scripts/check-repo-rules.sh` §`asset_manifest_records` reads a deliberately
 * small TOML: whole-line `#` comments, `[[asset]]` headers, and
 * `key = "value"` lines whose value is a double-quoted string containing no
 * quote. Anything else is a **parse error rather than a line to skip**, and an
 * unrecognised key is refused rather than ignored (ADR 0017 D-4's choice, made
 * again).
 *
 * This reader is that same list, second. A TOML library would read a *superset*
 * — multi-line strings, inline tables, bare values — and the difference between
 * the two readers is exactly where a manifest could mean one thing to CI and
 * another to the app. `manifest.test.ts` carries a refusal case for every
 * rejection the shell makes.
 *
 * ⚠️ **One rejection is deliberately not copied.** The shell refuses a `|` or a
 * tab inside `path`, `licence` or `sha256` because it emits those three as
 * fields of a `|`-separated record; that is its transport rather than a
 * property of the format, and nothing here is emitted through a record. A
 * manifest carrying one is already a red build, so this reader never sees it.
 *
 * ## Nothing is dropped in silence
 *
 * A line this reader cannot make sense of becomes a {@link ManifestProblem},
 * and the problems travel with the entries all the way to the screen —
 * `CreditsView` renders them. The alternative, a parser that skips what it
 * cannot read, is the shape this repository has now shipped five times:
 * `DOC002`'s sticking fence, `XML003`'s unclosed CDATA. Here it would be worse
 * than a quiet gate, because a dropped entry is an asset credited nowhere.
 */

/** One asset's row, exactly as the manifest records it. */
export interface AssetEntry {
  /** Repository-relative, exact — the manifest permits no globs. */
  readonly path: string;
  /** Which pack, which generator, which URL. Prose; nothing parses it. */
  readonly source: string;
  /** An SPDX identifier, checked against the path by `ASSET004`. */
  readonly licence: string;
  /** The date the source and its terms were read, `YYYY-MM-DD`. */
  readonly read: string;
  /** Of the committed bytes. Empty where the entry records none. */
  readonly sha256: string;
  /** ADR 0023 D-3: the name to credit, as the source gives it. */
  readonly creator?: string;
  /** ADR 0023 D-3: a link to the material, per CC BY 4.0 §3(a)(1)(A)(iv). */
  readonly url?: string;
  /** ADR 0023 D-3: what this repository changed, or `"no"`. §3(a)(1)(B). */
  readonly modified?: string;
}

/** A line the reader could not make sense of, and where it was. */
export interface ManifestProblem {
  /** 1-based, so it can be opened. */
  readonly line: number;
  readonly message: string;
}

export interface ParsedManifest {
  readonly entries: readonly AssetEntry[];
  readonly problems: readonly ManifestProblem[];
}

/** The keys an entry may carry. Anything else is refused — ADR 0017 D-4. */
const KEYS = ['path', 'source', 'licence', 'read', 'sha256', 'creator', 'url', 'modified'] as const;

type Key = (typeof KEYS)[number];

/** `key = "value"`, the only value shape the manifest permits. */
const KEY_VALUE = /^([a-z][a-z0-9]*)[ \t]*=[ \t]*"([^"]*)"$/;

/**
 * The shape of the read date, not its validity.
 *
 * The same line `ADR003` and the shell reader both draw: a calendar is not
 * worth the lines, and a typo in a date nobody disputes is not the failure this
 * is here for.
 */
const READ_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isKey(candidate: string): candidate is Key {
  return (KEYS as readonly string[]).includes(candidate);
}

/**
 * Read `ASSETS.toml`.
 *
 * Total: it never throws, because the one caller renders a screen and a
 * malformed manifest must produce a page that says so rather than an
 * application that will not start. Every refusal is a {@link ManifestProblem}.
 */
export function parseAssetManifest(text: string): ParsedManifest {
  const entries: AssetEntry[] = [];
  const problems: ManifestProblem[] = [];
  let open: Partial<Record<Key, string>> | undefined;
  let openedAt = 0;

  const refuse = (line: number, message: string): void => {
    problems.push({ line, message });
  };

  const flush = (): void => {
    if (open === undefined) {
      return;
    }
    const fields = open;
    open = undefined;
    const path = fields.path;
    if (path === undefined) {
      refuse(openedAt, 'the [[asset]] opened here names no path');
      return;
    }
    if (fields.source === undefined) {
      refuse(
        openedAt,
        `the entry for ${path} records no source; where it came from is the point of this file`,
      );
      return;
    }
    if (fields.read === undefined || !READ_DATE.test(fields.read)) {
      refuse(openedAt, `the entry for ${path} records no read date in the form YYYY-MM-DD`);
      return;
    }
    entries.push({
      path,
      source: fields.source,
      licence: fields.licence ?? '',
      read: fields.read,
      sha256: fields.sha256 ?? '',
      ...(fields.creator === undefined ? {} : { creator: fields.creator }),
      ...(fields.url === undefined ? {} : { url: fields.url }),
      ...(fields.modified === undefined ? {} : { modified: fields.modified }),
    });
  };

  const lines = text.split('\n');
  for (const [index, raw] of lines.entries()) {
    const number = index + 1;
    const line = raw.replace(/\r$/, '').trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    if (line === '[[asset]]') {
      flush();
      open = {};
      openedAt = number;
      continue;
    }
    if (line.startsWith('[')) {
      refuse(number, `expected an [[asset]] header, found "${line}"`);
      continue;
    }
    const matched = KEY_VALUE.exec(line);
    if (matched === null) {
      refuse(number, `not a comment, an [[asset]] header or a key = "value" line: "${line}"`);
      continue;
    }
    const [, key = '', value = ''] = matched;
    if (open === undefined) {
      refuse(number, `key "${key}" appears before any [[asset]] header`);
      continue;
    }
    if (value === '') {
      refuse(number, `key "${key}" has an empty value`);
      continue;
    }
    if (!isKey(key)) {
      refuse(
        number,
        `unknown key "${key}"; an unrecognised key is refused rather than ignored, so that a ` +
          'claim about an asset cannot be one nothing reads (ADR 0017 D-4)',
      );
      continue;
    }
    if (open[key] !== undefined) {
      refuse(number, `duplicate key "${key}" in one entry`);
      continue;
    }
    open[key] = value;
  }
  flush();

  return { entries, problems };
}
