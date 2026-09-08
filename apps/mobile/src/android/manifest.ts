// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reading `uses-permission` elements out of an Android manifest (#87).
 *
 * A deliberately small reader rather than an XML parser: the only shapes this
 * has to understand are `uses-permission` and `service`, and adding an XML
 * dependency to a client whose codec (`packages/fit`) refuses a `<!DOCTYPE`
 * outright would be a strange trade for two element types.
 *
 * ⚠️ **It reads a manifest as a DOCUMENT. It does not merge one.** Everything
 * this module can say is about the file it was handed. #87's first criterion is
 * about the **merged** manifest, which is the Android Gradle Plugin's output,
 * and `manifest.test.ts` says in terms which half it discharges and which it
 * cannot.
 */

/** One `uses-permission` element, reduced to what matters here. */
export interface UsesPermission {
  readonly name: string;
  readonly maxSdkVersion: number | null;
  /** The `android:usesPermissionFlags` value, verbatim, or null when absent. */
  readonly flags: string | null;
  /** The `tools:replace` value, verbatim, or null when absent. */
  readonly replaces: string | null;
}

const attribute = (element: string, name: string): string | null => {
  const match = new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(element);
  return match?.[1] ?? null;
};

/** Every `uses-permission` in a manifest, in document order. */
export function usesPermissions(manifest: string): readonly UsesPermission[] {
  const found: UsesPermission[] = [];
  // Both the self-closing form and the (legal, and used by some plugins) form
  // with a separate closing tag.
  for (const match of manifest.matchAll(/<uses-permission\b[\s\S]*?(?:\/>|<\/uses-permission>)/g)) {
    const element = match[0];
    const name = attribute(element, 'android:name');
    if (name === null) {
      continue;
    }
    const max = attribute(element, 'android:maxSdkVersion');
    found.push({
      name,
      maxSdkVersion: max === null ? null : Number(max),
      flags: attribute(element, 'android:usesPermissionFlags'),
      replaces: attribute(element, 'tools:replace'),
    });
  }
  return found;
}

/** One declared `service`, reduced the same way. */
export interface DeclaredService {
  readonly name: string;
  readonly foregroundServiceType: string | null;
  readonly exported: string | null;
}

export function services(manifest: string): readonly DeclaredService[] {
  const found: DeclaredService[] = [];
  for (const match of manifest.matchAll(/<service\b[\s\S]*?(?:\/>|<\/service>)/g)) {
    const element = match[0];
    const name = attribute(element, 'android:name');
    if (name === null) {
      continue;
    }
    found.push({
      name,
      foregroundServiceType: attribute(element, 'android:foregroundServiceType'),
      exported: attribute(element, 'android:exported'),
    });
  }
  return found;
}

/** Find one permission by name, or `undefined`. */
export function permission(manifest: string, name: string): UsesPermission | undefined {
  return usesPermissions(manifest).find((one) => one.name === `android.permission.${name}`);
}
