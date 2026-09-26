// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * That the link in the app points at a document that is actually there
 * ([#95](https://github.com/openzigs/onyourleft/issues/95)).
 *
 * ⚠️ **A URL constant is the easiest thing in a codebase to assert vacuously.**
 * `expect(PRIVACY_POLICY_URL).toBe('https://…')` restates the constant and
 * passes whatever it says, including after the file it names has been renamed.
 * So the assertions here are against the FILE SYSTEM: the path resolves to a
 * document in this repository, the URL is built from that path, and the
 * document says the things the Play listing and the Data Safety form claim it
 * says. A rename breaks the first, a hand-edited URL breaks the second, and a
 * policy quietly emptied out breaks the third.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PRIVACY_POLICY_PATH, PRIVACY_POLICY_URL } from './policy';

/** The repository root, resolved from this file rather than from `cwd`. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const POLICY = join(ROOT, PRIVACY_POLICY_PATH);

describe('the published privacy policy', () => {
  it('is a document that exists at the path the app links to', () => {
    expect(existsSync(POLICY), `${PRIVACY_POLICY_PATH} is missing`).toBe(true);
  });

  it('is the document the URL resolves to, rather than a second copy of the path', () => {
    expect(PRIVACY_POLICY_URL.endsWith(`/${PRIVACY_POLICY_PATH}`)).toBe(true);
    expect(PRIVACY_POLICY_URL.startsWith('https://')).toBe(true);
  });

  it('says what Play is told it says', () => {
    const text = readFileSync(POLICY, 'utf8');
    // Not a word count. Each of these is a claim the Data Safety form makes,
    // and a policy that stopped making one of them would contradict the form
    // while still being a valid Markdown file of the right length.
    expect(text).toContain('We collect nothing');
    expect(text.toLowerCase()).toContain('location');
    expect(text.toLowerCase()).toContain('heart rate');
    expect(text).toContain('Last updated:');
  });

  it('says what the one network call does, and whose computer it reaches — #387', () => {
    // The Data Safety form now answers Photos and videos `collected: true`,
    // optional, not shared (`apps/mobile/src/android/data-safety.ts`). A policy
    // that did not say so would contradict the form — and a policy that did
    // not say WHOSE computer would let a reader conclude the app had started
    // uploading to a server of ours.
    const text = readFileSync(POLICY, 'utf8');
    expect(text).toContain('Pictures sent to your own computer');
    expect(text).toContain('on its own the app uploads');
    // By name, and distinguished from the instance this project may one day run.
    expect(text).toContain('That computer is yours, not ours');
    expect(text).toContain('https://github.com/openzigs/onyourleft/issues/7');
    // The honest half: plain http on a home network is not encrypted.
    expect(text).toContain('not encrypted on the way');
    // And the claim the old policy made about the source, which #387 made
    // false, is gone rather than left standing beside the new one.
    expect(text).not.toContain('`sendBeacon` call at all');
  });

  it('says what the side-camera link carries — #529 — and, since #530, the pictures', () => {
    // ADR 0033 D-10: the policy changes in the pull request that sends the
    // first link byte, and the words about pictures land with #530. So this
    // pins the section AND the count it made false.
    const text = readFileSync(POLICY, 'utf8');
    expect(text).toContain('A second phone you pair as a side camera');
    expect(text).toContain('exactly **two** network calls');
    expect(text).not.toContain('exactly **one** network call');
    expect(text).toContain('A pairing lasts one session');
    expect(text).toContain('keeps filming for up to 30 seconds, then stops');
    // #530. The sentence #529 pinned is gone rather than left beside the new
    // ones, because it is false now.
    expect(text).not.toContain('in this version — **no picture**');
    expect(text).toContain('second go from the phone to the tablet');
    // D-6, in the owner's words' terms: none kept, none shown, none sent on.
    expect(text).toContain('No picture is ever saved on the tablet');
    // And the dependency that would report home, disclosed with what stops it.
    expect(text).toContain('contains a usage logger');
    expect(text).toContain('The app blocks it');
    expect(text).not.toContain('No third-party SDK of any kind is linked into the app');
  });
});
