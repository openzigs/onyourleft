// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reading an Android `res/values*` file as a document (#672) — the way
 * `manifest.ts` reads a manifest, and with its comment stripping.
 *
 * Two shapes and no more: a simple value (`<color name="…">#rrggbb</color>`,
 * `<drawable name="…">@drawable/…</drawable>`) and the items of a `<style>`.
 * An XML parser would be a dependency for two element types, which is
 * `manifest.ts`' own argument.
 */

import { withoutComments } from './manifest';

/**
 * Every `<element name="…">value</element>` in a values file, name to value,
 * trimmed. A second declaration of one name in one file throws: aapt refuses
 * it, and a reader that kept either would be checking a file that cannot
 * build.
 */
export function valueResources(xml: string, element: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  const pattern = new RegExp(`<${element}\\s+name\\s*=\\s*"([^"]+)"\\s*>([^<]*)</${element}>`, 'g');
  for (const match of withoutComments(xml).matchAll(pattern)) {
    const [, name, value] = match;
    if (name === undefined || value === undefined) continue;
    if (values.has(name)) {
      throw new Error(`<${element} name="${name}"> is declared twice in one values file`);
    }
    values.set(name, value.trim());
  }
  return values;
}

/**
 * The items of one `<style name="…">`, item name to value, or `undefined`
 * when the file declares no such style.
 */
export function styleItems(xml: string, style: string): ReadonlyMap<string, string> | undefined {
  const text = withoutComments(xml);
  const escaped = style.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = new RegExp(`<style\\s+name\\s*=\\s*"${escaped}"[^>]*>([\\s\\S]*?)</style>`).exec(
    text,
  );
  if (block?.[1] === undefined) return undefined;
  const items = new Map<string, string>();
  for (const match of block[1].matchAll(/<item\s+name\s*=\s*"([^"]+)"\s*>([^<]*)<\/item>/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) items.set(name, value.trim());
  }
  return items;
}
