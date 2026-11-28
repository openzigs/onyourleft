// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * No Swift in `apps/mobile/ios/` opens a network connection (#1756, ahead of
 * #3244's fuller gate). The allowed list is EMPTY: a Swift file that needs the
 * network is a reviewed entry here, with the reason, in the pull request that
 * adds it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { networkUses, swiftCode } from './swift-network';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const IOS = join(ROOT, 'apps', 'mobile', 'ios');

/**
 * What `cap sync ios` and Xcode write and Capacitor's `ios/.gitignore` keeps
 * out of the repository: the copied web build, the Cordova plugin tree and
 * build output. The same trees `scripts/check-repo-rules.sh` prunes.
 */
const GENERATED = new Set([
  'public',
  'capacitor-cordova-ios-plugins',
  'build',
  'DerivedData',
  'Pods',
]);

function swiftFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (GENERATED.has(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return swiftFiles(path);
    return entry.name.endsWith('.swift') ? [relative(ROOT, path)] : [];
  });
}

/** `path:line: api` for each use the allowed list admits. Empty, by decision. */
const ALLOWED: readonly string[] = [];

describe('the Swift in apps/mobile/ios opens no network connection', () => {
  it('finds the Swift it is meant to read', () => {
    // The two delegates and the plugin package, at least: a walk that found
    // nothing would pass every case below.
    const files = swiftFiles(IOS);
    expect(files).toContain('apps/mobile/ios/App/App/AppDelegate.swift');
    expect(files).toContain('apps/mobile/ios/App/App/SceneDelegate.swift');
    expect(files).toContain('apps/mobile/ios/App/CapApp-SPM/Package.swift');
  });

  it('names no network API outside the allowed list, which is empty', () => {
    const found = swiftFiles(IOS).flatMap((file) =>
      networkUses(readFileSync(join(ROOT, file), 'utf8')).map(
        (use) => `${file}:${String(use.line)}: ${use.api}`,
      ),
    );
    expect(found.filter((use) => !ALLOWED.includes(use))).toEqual([]);
    expect(ALLOWED).toEqual([]);
  });
});

describe('the scan', () => {
  it('finds each kind of network API, on its line', () => {
    const source = [
      'import UIKit',
      'import Network',
      'let task = URLSession.shared.dataTask(with: url)',
      'var request = URLRequest(url: url)',
      'let c = NWConnection(host: "10.0.0.2", port: 80, using: .tcp)',
      'CFStreamCreatePairWithSocketToHost(nil, host, 80, &r, &w)',
      'let data = try Data(contentsOf: URL(string: "https://example.invalid")!)',
      'let fd = socket(AF_INET, SOCK_STREAM, 0)',
      'Stream.getStreamsToHost(withName: h, port: 80, inputStream: &i, outputStream: &o)',
      'let s = NetService(domain: "", type: "_x._tcp.", name: "")',
      'let old = NSURLConnection(request: r, delegate: nil)',
    ].join('\n');
    expect(networkUses(source)).toEqual([
      { api: 'import Network', line: 2 },
      { api: 'URLSession', line: 3 },
      { api: 'URLRequest', line: 4 },
      { api: 'Network framework', line: 5 },
      { api: 'CFNetwork', line: 6 },
      { api: 'contentsOf:', line: 7 },
      { api: 'BSD socket', line: 8 },
      { api: 'Stream to a host', line: 9 },
      { api: 'NetService', line: 10 },
      { api: 'NSURLConnection', line: 11 },
    ]);
  });

  it('reads an import with an attribute or a kind, and an interpolation', () => {
    expect(networkUses('@preconcurrency import Network')).toEqual([
      { api: 'import Network', line: 1 },
    ]);
    expect(networkUses('import struct Network.NWEndpoint')).toHaveLength(2);
    expect(networkUses('print("\\(URLSession.shared)")')).toEqual([{ api: 'URLSession', line: 1 }]);
  });

  it('is not fooled by a URL literal’s `//` into reading the rest of a line as a comment', () => {
    expect(
      networkUses('let u = "https://example.invalid"; URLSession.shared.dataTask(with: x)'),
    ).toEqual([{ api: 'URLSession', line: 1 }]);
  });

  it('ignores a comment, nested block comments included, and keeps line numbers', () => {
    const source = [
      '// URLSession is not used here',
      '/* NWConnection either /* nested */ URLRequest, still in the comment */',
      'let ok = true',
      '/** Data(contentsOf: url) */',
      'let task = URLSession.shared',
    ].join('\n');
    expect(networkUses(source)).toEqual([{ api: 'URLSession', line: 5 }]);
    expect(swiftCode(source).split('\n')).toHaveLength(5);
  });

  it('passes what the template Swift does and what is only a lookalike', () => {
    for (const clean of [
      'window?.rootViewController = CAPBridgeViewController()',
      'SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)',
      '.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.3")',
      'let reconnect = true',
      'func disconnect() {}',
      'let url = URL(fileURLWithPath: path)',
    ]) {
      expect(networkUses(clean), clean).toEqual([]);
    }
  });
});
