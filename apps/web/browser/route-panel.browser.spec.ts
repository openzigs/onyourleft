// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The route panel's artwork is never painted again by the rest of the HUD — #2419.
 *
 * On the owner's tablet a REAL ride with the full route panel on ran at a
 * 166 ms median frame and left the realistic world, and the same ride with
 * the panel hidden held 16.6 ms; fifteen simulated rides with the panel on
 * held 16.6 ms too. What a real ride has and a simulated one does not is a
 * HUD that changes on every frame — power, heart rate and cadence, the zone
 * field and bar, the recent graph's heart-rate line, the trainer's line — and
 * the whole HUD was one compositor layer, so each of those changes took the
 * route panel's clip path and patterns into a GPU raster with it.
 *
 * A raster's milliseconds are the device's, and a runner's would say nothing
 * about a Fire HD. What is the same on every engine is WHICH LAYER a piece of
 * artwork is drawn into and how many times that layer is painted, and the
 * DevTools protocol's layer tree reports both: each layer's owning node and
 * its `paintCount`. So `street-map.html?ride=real` changes everything a real
 * ride changes on every frame (`street-map-harness.tsx` says how), and this
 * spec reads the layer each part of the route panel is drawn into — the
 * layer of the part's own node or of its nearest ancestor that has one — and
 * counts that layer's paints across the ride:
 *
 * 1. **The rider standing still, every value changing.** The whole route's
 *    strip, the rider's marker on it and the road ahead are each on a layer
 *    that is not the HUD's, and none of the three is painted again; the HUD's
 *    own layer is, on nearly every frame, which is the control that the ride
 *    did change it. On `main` before #2419 all three were the HUD's layer.
 * 2. **The rider moving, every value changing.** The strip is still not
 *    painted again, and nor is the marker, which moves by its `transform`
 *    alone — while the control says it did move. The road ahead changes as
 *    the rider moves, and is painted then, on its own layer.
 *
 * The street map's sheet (#2380) is held to the same count in both, as a
 * guard: it was already a layer of its own.
 *
 * ## What it does not prove
 *
 * That the tablet now holds 16.6 ms. Only a real ride on it says that
 * (#2419's last criterion), observed read-only over CDP.
 */

import { expect, test, type CDPSession, type Page } from '@playwright/test';

import { HARNESS_ORIGIN } from '../playwright.config';

/** One layer as `LayerTree.layerTreeDidChange` reports it. */
interface Layer {
  readonly layerId: string;
  readonly backendNodeId?: number;
  readonly paintCount: number;
}

/** A node of `DOM.getDocument`'s tree, as far as this spec reads it. */
interface DomNode {
  readonly nodeId: number;
  readonly backendNodeId: number;
  readonly children?: readonly DomNode[];
  readonly contentDocument?: DomNode;
  readonly shadowRoots?: readonly DomNode[];
}

/** The parts of the route panel, and the control, by what a consumer selects them with. */
const PARTS = {
  strip: '.oyl-hud__profile-svg',
  marker: '[data-testid="oyl-hud-position"]',
  ahead: '[data-testid="oyl-hud-look-ahead"]',
  sheet: '.oyl-hud__street-map-sheet',
  // The control: a field's value, which a real ride changes on every frame.
  hud: '.oyl-hud__field',
} as const;

type Part = keyof typeof PARTS;

async function open(page: Page): Promise<void> {
  const response = await page.goto(`${HARNESS_ORIGIN}/street-map.html?ride=real`);
  if (response === null || !response.ok()) {
    throw new Error(`street-map.html did not load (${String(response?.status())})`);
  }
  await page.waitForFunction(() => window.__oylStreetMap !== undefined);
  const published = await page.evaluate(() => window.__oylStreetMap);
  if (published === undefined || !published.ready) {
    throw new Error(`the harness did not become ready: ${published?.errors.join('; ') ?? ''}`);
  }
}

/** Two animation frames, so a change has been painted and committed. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
  await page.waitForTimeout(250);
}

/**
 * The layer each part is drawn into: its own node's, or its nearest
 * ancestor's that has one. Read from the DOM's tree by backend node id, the
 * id the layer tree names its owners by.
 */
async function layersOf(
  session: CDPSession,
  layers: readonly Layer[],
): Promise<Record<Part, Layer | undefined>> {
  const { root } = (await session.send('DOM.getDocument', { depth: -1, pierce: true })) as {
    readonly root: DomNode;
  };
  const parent = new Map<number, DomNode>();
  const byId = new Map<number, DomNode>();
  const walk = (node: DomNode): void => {
    byId.set(node.nodeId, node);
    for (const child of [
      ...(node.children ?? []),
      ...(node.shadowRoots ?? []),
      ...(node.contentDocument === undefined ? [] : [node.contentDocument]),
    ]) {
      parent.set(child.nodeId, node);
      walk(child);
    }
  };
  walk(root);
  const owned = new Map(
    layers.flatMap((layer) =>
      layer.backendNodeId === undefined ? [] : [[layer.backendNodeId, layer] as const],
    ),
  );
  const found = {} as Record<Part, Layer | undefined>;
  for (const [part, selector] of Object.entries(PARTS) as [Part, string][]) {
    const { nodeId } = (await session.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector,
    })) as { readonly nodeId: number };
    let node = nodeId === 0 ? undefined : byId.get(nodeId);
    let layer: Layer | undefined;
    while (node !== undefined && layer === undefined) {
      layer = owned.get(node.backendNodeId);
      node = parent.get(node.nodeId);
    }
    found[part] = layer;
  }
  return found;
}

/**
 * Ride `frames` paced frames of `metresPerFrame` with every real-ride value
 * changing, and return each part's layer and how many times it was painted.
 */
async function ride(page: Page, frames: number, metresPerFrame: number) {
  await open(page);
  const session = await page.context().newCDPSession(page);
  let latest: readonly Layer[] = [];
  session.on('LayerTree.layerTreeDidChange', (event: { readonly layers?: readonly Layer[] }) => {
    if (event.layers !== undefined) latest = event.layers;
  });
  await session.send('DOM.enable');
  await session.send('LayerTree.enable');
  await settle(page);
  const before = new Map(latest.map((layer) => [layer.layerId, layer.paintCount]));
  // Where the marker says it is: the number its place is drawn from.
  const marker = async () =>
    page.evaluate(
      () =>
        document.querySelector('[data-testid="oyl-hud-position"]')?.getAttribute('data-position') ??
        '',
    );
  const placed = await marker();
  const ridden = await page.evaluate(
    async ([count, step]) => window.__oylStreetMap?.ride?.(count, step, true),
    [frames, metresPerFrame] as const,
  );
  await settle(page);
  if (ridden === undefined) throw new Error('the harness published no ride');
  const layers = await layersOf(session, latest);
  const moved = (await marker()) !== placed;
  await session.detach();
  const paints = (part: Part): number => {
    const layer = layers[part];
    if (layer === undefined) return Number.NaN;
    const after = latest.find((each) => each.layerId === layer.layerId)?.paintCount ?? 0;
    return after - (before.get(layer.layerId) ?? 0);
  };
  return { ridden, layers, paints, moved };
}

test('#2419 a real ride’s changing values never paint the route panel’s artwork again', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  // The rider standing still: what changes is only what a real ride changes
  // beside the road (`street-map-harness.tsx` §`?ride=real`).
  const frames = 60;
  const { ridden, layers, paints } = await ride(page, frames, 0);
  expect(ridden.frames).toBe(frames);
  const hud = layers.hud?.layerId;
  expect(hud, 'the HUD’s fields are drawn into a layer').toBeDefined();
  // The control: the ride did change the HUD, and the layer tree saw it.
  expect(paints('hud')).toBeGreaterThan(frames / 2);
  for (const part of ['strip', 'marker', 'ahead', 'sheet'] as const) {
    expect(layers[part], `the ${part} is drawn into a layer`).toBeDefined();
    expect(
      layers[part]?.layerId,
      `the ${part} is drawn into the HUD’s own layer, which every value change paints`,
    ).not.toBe(hud);
    expect(
      paints(part),
      `the ${part}’s layer was painted ${String(paints(part))} times in ${String(frames)} frames`,
    ).toBeLessThanOrEqual(1);
  }
  console.log(
    `#2419 ${String(frames)} paced frames standing still, every real-ride value changing: the ` +
      `HUD’s layer painted ${String(paints('hud'))} times; the strip ${String(paints('strip'))}, ` +
      `the marker ${String(paints('marker'))}, the road ahead ${String(paints('ahead'))}, ` +
      `the street map ${String(paints('sheet'))}`,
  );
});

test('#2419 moving the rider’s marker paints neither it nor the whole route’s strip', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  // 300 m in 60 paced frames of 5 m, as `street-map.browser.spec.ts`
  // paints: the marker's place changes on every frame (by a fraction of a
  // pixel over the 40 km route), and every real-ride value changes too.
  const frames = 60;
  const { ridden, layers, paints, moved } = await ride(page, frames, 5);
  expect(ridden.frames).toBe(frames);
  expect(moved, 'the marker moved').toBe(true);
  expect(paints('hud')).toBeGreaterThan(frames / 2);
  for (const part of ['strip', 'marker'] as const) {
    expect(layers[part]?.layerId).toBeDefined();
    expect(layers[part]?.layerId).not.toBe(layers.hud?.layerId);
    expect(
      paints(part),
      `the ${part}’s layer was painted ${String(paints(part))} times in ${String(frames)} frames`,
    ).toBeLessThanOrEqual(1);
  }
  // The road ahead does change as the rider moves, on a layer of its own.
  expect(layers.ahead?.layerId).not.toBe(layers.hud?.layerId);
  console.log(
    `#2419 ${String(frames)} paced frames of 5 m, every real-ride value changing: the HUD’s ` +
      `layer painted ${String(paints('hud'))} times; the strip ${String(paints('strip'))}, the ` +
      `marker ${String(paints('marker'))}, the road ahead ${String(paints('ahead'))}`,
  );
});
