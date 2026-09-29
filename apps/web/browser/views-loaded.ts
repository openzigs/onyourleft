// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Every lazily loaded view group, loaded before a harness renders the shell —
 * #674.
 *
 * Since #674 every group but Home is a chunk the shell `import()`s on first
 * visit, so a page that renders the shell and measures it at once measures the
 * loading fallback. `main.tsx` preloads the groups once Home has painted; a
 * harness does the same thing BEFORE it renders, so each view renders on the
 * render that asks for it, exactly as every one did before the split — the
 * layout gates measure views, not a loading state. What the split does to a
 * rider with the network off is `offline.browser.spec.ts`'s, which loads the
 * product, not a harness.
 */

import { VIEW_GROUPS } from '../src/shell/AppShell';

export async function viewGroupsLoaded(): Promise<void> {
  await Promise.all(VIEW_GROUPS.map(async (group) => group.load()));
}
