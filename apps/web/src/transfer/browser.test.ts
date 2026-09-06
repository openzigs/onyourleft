// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The two browser side effects, tested where they can actually run.
 *
 * `URL.createObjectURL` is one of the things jsdom does not implement — it has
 * no blob URL store — so it is stubbed here and the assertions are about what
 * this module *does with it*: the download name it sets, that the anchor is
 * activated, that the anchor does not stay in the document, and that the URL is
 * revoked. The last one is the reason this file exists: an object URL that is
 * never revoked pins the whole file in memory for the life of the document, and
 * a four-hour ride's FIT export is megabytes a tab keeps until it is closed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { saveWithAnchor, webCryptoDigest } from './browser';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A blob-URL implementation jsdom does not have, that records what it is given. */
function stubObjectUrls(): { created: Blob[]; revoked: string[] } {
  const created: Blob[] = [];
  const revoked: string[] = [];
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (blob: Blob): string => {
      created.push(blob);
      return `blob:test/${String(created.length)}`;
    },
    revokeObjectURL: (url: string): void => {
      revoked.push(url);
    },
  });
  return { created, revoked };
}

describe('webCryptoDigest', () => {
  it('is the SHA-256 of the bytes, lowercase hex', async () => {
    // The published SHA-256 of the empty input and of "abc" — constants from
    // FIPS 180-4, so this is checked against the standard rather than against
    // whatever this function happens to return.
    expect(await webCryptoDigest(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(await webCryptoDigest(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes a view onto a larger buffer as that view, not as the buffer', async () => {
    const backing = new TextEncoder().encode('xxabcxx');
    const view = backing.subarray(2, 5);

    // A `File` read in chunks produces exactly this shape. Digesting the whole
    // backing buffer would make two different files hash the same whenever they
    // shared one.
    expect(await webCryptoDigest(view)).toBe(
      await webCryptoDigest(new TextEncoder().encode('abc')),
    );
  });
});

describe('saveWithAnchor', () => {
  it('hands the file to the browser and leaves nothing behind', () => {
    const urls = stubObjectUrls();
    const clicks: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      // Read *during* the click: the anchor is removed immediately
      // afterwards, so an assertion made after the call would be reading a
      // detached element.
      clicks.push(`${this.download}|${this.href}|${String(this.isConnected)}`);
    });

    saveWithAnchor({
      fileName: 'Sunday loop.fit',
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: 'application/vnd.ant.fit',
    });

    expect(click).toHaveBeenCalledTimes(1);
    // Downloaded under the ride's name, from a blob URL, while attached to the
    // document — Chrome ignores a click on an anchor that is not in the tree.
    expect(clicks[0]).toBe('Sunday loop.fit|blob:test/1|true');
    expect(urls.created[0]?.type).toBe('application/vnd.ant.fit');
    expect(urls.revoked).toEqual(['blob:test/1']);
    expect(document.querySelector('a')).toBeNull();
  });
});
