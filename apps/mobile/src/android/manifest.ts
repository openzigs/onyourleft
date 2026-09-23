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
 * this module can say is about the file it was handed — which is exactly why it
 * is safe to point at the merged manifest as well as at ours. #87's first
 * criterion is about the **merged** manifest, which is the Android Gradle
 * Plugin's output; `merged-manifest.ts` locates that artefact and
 * `merged-manifest.test.ts` reads it with the functions below.
 *
 * ⚠️ **Since #318 every scan strips XML comments first**, and a reviewer who
 * remembers it scanning the raw text is reading the old file. The manifests in
 * this repository carry long prose comments that quote element and permission
 * names at each other, and the generated merged manifest reproduces every one
 * of them verbatim — so a comment that happened to contain a `<uses-permission`
 * would have been counted as a declaration. That is the same shape as `DOC002`:
 * a reader that believes something it was only told about.
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

/**
 * The document with every XML comment removed.
 *
 * Applied before every scan below, because the manifests in this repository
 * carry long prose comments that quote permission and element names at each
 * other, and the generated merged manifest reproduces every one of them
 * verbatim.
 *
 * ⚠️ **A single `replace(/<!--[\s\S]*?-->/g, '')` is NOT equivalent and was the
 * first version of this.** CodeQL's `js/incomplete-multi-character-sanitization`
 * flagged it at high severity on #318's own pull request, and the finding is
 * right in kind: one pass can leave a `<!--` in its own output, so a caller that
 * assumed the result was comment-free would be wrong. The forward scan below
 * cannot — each piece it keeps is taken from the current cursor up to the *next*
 * `<!--`, so by construction no `<!--` survives into the result.
 *
 * ⚠️ **An unclosed comment throws rather than being left in place.** That is
 * `DOC002`'s failure mode, and this repository has shipped it several times: a
 * scanner whose state sticks reports the rest of the file as containing nothing,
 * and every "the merge adds no X" assertion then passes over the silence.
 * `XML002` forbids an unclosed comment in a committed file; nothing checks a
 * generated one, which is exactly the input this reader is pointed at.
 */
export function withoutComments(manifest: string): string {
  let kept = '';
  let index = 0;
  for (;;) {
    const open = manifest.indexOf('<!--', index);
    if (open < 0) {
      return kept + manifest.slice(index);
    }
    const close = manifest.indexOf('-->', open + '<!--'.length);
    if (close < 0) {
      throw new Error(`manifest: comment opened at offset ${String(open)} is never closed`);
    }
    kept += manifest.slice(index, open);
    index = close + '-->'.length;
  }
}

/** Every `uses-permission` in a manifest, in document order. */
export function usesPermissions(manifest: string): readonly UsesPermission[] {
  const found: UsesPermission[] = [];
  // Both the self-closing form and the (legal, and used by some plugins) form
  // with a separate closing tag.
  for (const match of withoutComments(manifest).matchAll(
    /<uses-permission\b[\s\S]*?(?:\/>|<\/uses-permission>)/g,
  )) {
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

/** One `uses-feature` element, reduced to what a review needs. */
export interface UsesFeature {
  readonly name: string;
  /**
   * `android:required`, verbatim, or `null` when the attribute is absent.
   *
   * ⚠️ **A string and not a boolean, and `null` and not `true`.** Android's
   * default when the attribute is omitted is `true`, which is exactly the
   * dangerous value — a feature implicitly required is an app Google Play
   * filters off every device without it. Defaulting here would make "the
   * attribute is missing" and "the attribute says true" indistinguishable to a
   * reviewer, and only the first is a mistake somebody made by accident.
   * `Component.exported` is three-valued in this same file for the same reason.
   */
  readonly required: string | null;
}

/** Every `uses-feature` in a manifest, in document order. */
export function usesFeatures(manifest: string): readonly UsesFeature[] {
  const found: UsesFeature[] = [];
  for (const match of withoutComments(manifest).matchAll(
    /<uses-feature\b[\s\S]*?(?:\/>|<\/uses-feature>)/g,
  )) {
    const element = match[0];
    const name = attribute(element, 'android:name');
    if (name === null) {
      // A `uses-feature` may name an OpenGL version rather than a feature
      // (`android:glEsVersion`), which has no `android:name` at all. It is not
      // a hardware requirement this review is about, and skipping it is the
      // same call `usesPermissions` makes for a nameless permission.
      continue;
    }
    found.push({ name, required: attribute(element, 'android:required') });
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
  for (const match of withoutComments(manifest).matchAll(
    /<service\b[\s\S]*?(?:\/>|<\/service>)/g,
  )) {
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

/* -------------------------------------------------------------------------- *
 * #318: what a permission list cannot say.
 *
 * A permission is only one of the three things a merge can inject. The other
 * two are a component the app did not declare — an exported one is a process
 * anybody on the device can start — and a `<queries>` entry, which widens what
 * the app can see of the other applications installed. Neither is visible to
 * `usesPermissions`, so the readers below exist.
 *
 * They scan START TAGS rather than whole elements, because an `<activity>` in a
 * merged manifest contains children and the lazy element matches above would
 * stop at the first `/>` inside one. The scanner tracks quoting, so a `>` in an
 * attribute value does not end a tag early.
 * -------------------------------------------------------------------------- */

const NAME = /^[A-Za-z_][\w.:-]*/;
const ATTRIBUTE = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** One element start tag: its name and its attributes. */
export interface StartTag {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
  /** Nesting depth, counting from 0 for `<manifest>`. */
  readonly depth: number;
}

/**
 * Every element start tag in a manifest, in document order, with its depth.
 *
 * ⚠️ **An unterminated start tag throws rather than ending the scan.** Stopping
 * silently is how a truncated document reports "no exported components" and
 * every assertion below it passes over nothing — `DOC002`'s failure mode, which
 * this repository has now shipped several times.
 */
export function startTags(manifest: string): readonly StartTag[] {
  const xml = withoutComments(manifest);
  const found: StartTag[] = [];
  let depth = 0;
  let index = 0;
  while (index < xml.length) {
    const open = xml.indexOf('<', index);
    if (open < 0) {
      break;
    }
    const next = xml.charAt(open + 1);
    if (next === '/') {
      depth -= 1;
      index = open + 1;
      continue;
    }
    // A processing instruction (`<?xml …?>`) or a declaration (`<![CDATA[`,
    // `<!DOCTYPE`). Neither is an element and neither nests here.
    if (next === '?' || next === '!') {
      index = open + 1;
      continue;
    }
    const name = NAME.exec(xml.slice(open + 1))?.[0];
    if (name === undefined) {
      index = open + 1;
      continue;
    }
    let cursor = open + 1 + name.length;
    let quote: string | null = null;
    while (cursor < xml.length) {
      const character = xml.charAt(cursor);
      if (quote !== null) {
        if (character === quote) {
          quote = null;
        }
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        break;
      }
      cursor += 1;
    }
    if (cursor >= xml.length) {
      throw new Error(`manifest: start tag <${name}> at offset ${String(open)} is never closed`);
    }
    const body = xml.slice(open + 1 + name.length, cursor);
    const attributes = new Map<string, string>();
    for (const match of body.matchAll(ATTRIBUTE)) {
      attributes.set(match[1] ?? '', match[2] ?? match[3] ?? '');
    }
    found.push({ name, attributes, depth });
    if (!body.trimEnd().endsWith('/')) {
      depth += 1;
    }
    index = cursor + 1;
  }
  return found;
}

/** The manifest element kinds that declare something startable. */
const COMPONENT_KINDS = new Set(['activity', 'activity-alias', 'service', 'receiver', 'provider']);

/**
 * What a component or a defined permission is called when it names itself
 * nothing.
 *
 * ⚠️ `usesPermissions` and `services` above **skip** an element with no
 * `android:name`, and the two readers below deliberately do **not**. The
 * attribute is mandatory and the Android Gradle Plugin rejects a manifest
 * without it, so this should be unreachable — but the consequence of skipping
 * is that an exported component this reader could not name would be absent from
 * the exported list, and "the merge exports nothing new" would then be true by
 * omission. That is #318's defect in miniature, so the answer is a name nobody
 * will have reviewed rather than a silence.
 */
export const UNNAMED = '(no android:name)';

/** One declared component, reduced to what decides whether it is reachable. */
export interface Component {
  readonly kind: string;
  readonly name: string;
  /**
   * `null` when the attribute is absent — deliberately NOT defaulted. The
   * platform's own default depends on whether the component has an intent
   * filter and on the target SDK, and a reader that guessed would be answering
   * the question this exists to ask.
   */
  readonly exported: boolean | null;
  /** The `android:permission` a caller must hold, or null. */
  readonly permission: string | null;
}

/** Every component a manifest declares, in document order. */
export function components(manifest: string): readonly Component[] {
  const found: Component[] = [];
  for (const tag of startTags(manifest)) {
    if (!COMPONENT_KINDS.has(tag.name)) {
      continue;
    }
    const exported = tag.attributes.get('android:exported');
    found.push({
      kind: tag.name,
      name: tag.attributes.get('android:name') ?? UNNAMED,
      exported: exported === undefined ? null : exported === 'true',
      permission: tag.attributes.get('android:permission') ?? null,
    });
  }
  return found;
}

/** One `<permission>` the manifest DEFINES (as opposed to uses). */
export interface DefinedPermission {
  readonly name: string;
  readonly protectionLevel: string | null;
}

/** Every `<permission>` a manifest defines, in document order. */
export function definedPermissions(manifest: string): readonly DefinedPermission[] {
  const found: DefinedPermission[] = [];
  for (const tag of startTags(manifest)) {
    if (tag.name !== 'permission') {
      continue;
    }
    found.push({
      name: tag.attributes.get('android:name') ?? UNNAMED,
      protectionLevel: tag.attributes.get('android:protectionLevel') ?? null,
    });
  }
  return found;
}

/**
 * Every entry inside a `<queries>` block, as `kind:name` — `package:com.x`,
 * `provider:some.authority`, or bare `intent` for the shape that has no name.
 *
 * Package visibility is not a permission and appears in no permission list, so
 * a merge that widened it would be invisible to every other reader here.
 */
export function queries(manifest: string): readonly string[] {
  const found: string[] = [];
  let inside: number | null = null;
  for (const tag of startTags(manifest)) {
    if (tag.name === 'queries') {
      inside = tag.depth;
      continue;
    }
    if (inside === null) {
      continue;
    }
    if (tag.depth <= inside) {
      inside = null;
      continue;
    }
    if (tag.depth !== inside + 1) {
      continue;
    }
    const name = tag.attributes.get('android:name') ?? tag.attributes.get('android:authorities');
    found.push(name === undefined ? tag.name : `${tag.name}:${name}`);
  }
  return found;
}
