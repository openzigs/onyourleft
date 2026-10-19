// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * No Android backup and no device-to-device transfer of the app's storage
 * ([#1451](https://github.com/openzigs/onyourleft/issues/1451), owner ruling
 * 2026-10-19).
 *
 * The app's storage is the rider's rides and their GPS tracks, in the
 * WebView's storage. They leave the device by the rider's export or by sync to
 * an instance the rider connected; Android's backup to a Google account and its
 * transfer to a new phone would be a third way nobody chose. Two settings close
 * it, and each is needed:
 *
 * - `android:allowBackup="false"` turns off backup, and is all Android 11 and
 *   below read;
 * - on Android 12 and later that alone does not stop a device-to-device
 *   transfer on every manufacturer's build, so `android:dataExtractionRules`
 *   names a file that excludes every domain from both cloud backup and device
 *   transfer.
 *
 * ⚠️ These assert against the app's own manifest, the input to the merge. The
 * merged output is checked in `merged-manifest.test.ts`, which skips where
 * Gradle has never run. What Android actually does on a device is the owner's
 * check on the tablet (#733): `adb shell bmgr` there, not this file.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { startTags, type StartTag } from './manifest';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, '..', '..', 'android', 'app', 'src', 'main');

const APP_MANIFEST = readFileSync(join(MAIN, 'AndroidManifest.xml'), 'utf8');

/**
 * Every domain Android's data extraction rules know, from the platform's
 * documentation (developer.android.com/identity/data/autobackup). `root` alone
 * covers the app's data directory, which is where the WebView keeps its
 * storage; the others are listed because device-protected storage and the
 * external files directory are not under it, and listing every one means no
 * reader has to work out which are.
 */
const DOMAINS = [
  'root',
  'file',
  'database',
  'sharedpref',
  'external',
  'device_root',
  'device_file',
  'device_database',
  'device_sharedpref',
] as const;

/** The two modes the ruling closes. */
const MODES = ['cloud-backup', 'device-transfer'] as const;

function application(manifest: string): StartTag {
  const found = startTags(manifest).filter((tag) => tag.name === 'application');
  expect(found).toHaveLength(1);
  return found[0] as StartTag;
}

/** The file an `@xml/<name>` reference resolves to, read. */
function xmlResource(reference: string | undefined): string {
  const name = /^@xml\/([a-z0-9_]+)$/.exec(reference ?? '')?.[1];
  expect(name, `${String(reference)} is not an @xml resource`).toBeDefined();
  const path = join(MAIN, 'res', 'xml', `${String(name)}.xml`);
  expect(existsSync(path), `${path} does not exist`).toBe(true);
  return readFileSync(path, 'utf8');
}

/** Each section of a rules file, with the rules directly inside it. */
function sections(rules: string): ReadonlyMap<string, readonly StartTag[]> {
  const tags = startTags(rules);
  expect(tags[0]?.name).toBe('data-extraction-rules');
  const result = new Map<string, StartTag[]>();
  let current: StartTag[] | undefined;
  for (const tag of tags.slice(1)) {
    if (tag.depth === 1) {
      current = [];
      result.set(tag.name, current);
    } else if (tag.depth === 2) {
      current?.push(tag);
    }
  }
  return result;
}

const RULES = xmlResource(application(APP_MANIFEST).attributes.get('android:dataExtractionRules'));

describe('Android backup is off — #1451', () => {
  it('sets allowBackup to false on the application', () => {
    // Absent is not false: Android's default for an omitted allowBackup is
    // true, so the attribute has to be there and say false.
    expect(application(APP_MANIFEST).attributes.get('android:allowBackup')).toBe('false');
  });

  it('names a data extraction rules file that is there', () => {
    expect(application(APP_MANIFEST).attributes.get('android:dataExtractionRules')).toBe(
      '@xml/data_extraction_rules',
    );
  });

  it('has exactly the two sections it closes, and no cross-platform transfer', () => {
    // A missing section leaves that mode fully on, so both must be present. A
    // cross-platform-transfer section is how an app opts in to a transfer to
    // an iPhone, so its appearance is a change to the ruling, not a detail.
    expect([...sections(RULES).keys()].sort()).toEqual([...MODES].sort());
  });

  it.each(MODES)('includes nothing in %s', (mode) => {
    // One include element makes Android back up exactly what it names, which
    // would turn this file from "nothing" into "this".
    const names = (sections(RULES).get(mode) ?? []).map((tag) => tag.name);
    expect(names).not.toContain('include');
    expect(names.every((name) => name === 'exclude')).toBe(true);
  });

  it.each(MODES)('excludes every domain at its root in %s', (mode) => {
    const excluded = (sections(RULES).get(mode) ?? [])
      .filter((tag) => tag.name === 'exclude' && tag.attributes.get('path') === '.')
      .map((tag) => tag.attributes.get('domain'));
    expect([...excluded].sort()).toEqual([...DOMAINS].sort());
  });
});

describe('reading a rules file', () => {
  it('sees an include that a rules file adds', () => {
    // The control for the two cases above: a reader that found no rules at all
    // would pass "includes nothing" over any file.
    const read = sections(
      '<data-extraction-rules><cloud-backup><include domain="root" path="." />' +
        '</cloud-backup><device-transfer /></data-extraction-rules>',
    );
    expect(read.get('cloud-backup')?.map((tag) => tag.name)).toEqual(['include']);
    expect(read.get('device-transfer')).toEqual([]);
  });

  it('does not count a rule that is only in a comment', () => {
    const read = sections(
      '<data-extraction-rules><cloud-backup>' +
        '<!-- <exclude domain="root" path="." /> --></cloud-backup></data-extraction-rules>',
    );
    expect(read.get('cloud-backup')).toEqual([]);
  });
});
