// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the owner's realistic page draws, read from its URL — ADR 0026 D-12.
 *
 * The page is `browser/realistic.html`, built only by `vite.browser.config.ts`
 * and never by the product's own config, which is what makes it the one place
 * the realistic world can be reached until
 * [#475](https://github.com/openzigs/onyourleft/issues/475) offers it to a
 * rider. It rides the product's own renderer along `route.ts`, with the
 * product's quality ladder deciding the rung from frame times the way
 * `GameView` does.
 *
 * | parameter | what | values |
 * |---|---|---|
 * | `world` | which world the ride starts in | `realistic` (default), `stylised` |
 * | `rung` | which rung of that world's ladder it starts on | `0` (default), `1` |
 * | `ladder` | whether the ladder may move the rung | `1` (default), `0` to hold it |
 * | `seconds` | how long a measurement window is | default 30 |
 * | `soak` | minutes to keep riding, one sample a minute | default 0 |
 * | `at` | hold the rider still this far along the route, for a screenshot | metres |
 * | `panel` | the on-screen controls | `1` (default), `0` for a clean screenshot |
 * | `layers` | layers switched OFF, for their share of the GPU (#616) | `-sky`, `-surfaces`, `-vegetation`, `-impostors`, `-structures`, `-water`, `-riders`, `-grounding`, comma-separated; default none |
 * | `levers` | #619's levers switched OFF, for a before/after pair at one rung — since #622 its air and since #1274 its crag, for a by-eye pair, since #1283 the generated trees and #1294 the generated firs, for both, since #1523 the ground blend and the road wear, for a cost pair, #1523's bounds on both, for a before/after pair, since #1534 the villages' cleared ground, for both, since #1523 the firs' depth pre-pass, for a before/after pair, since #1541 the people, for both, since #1542 the countryside's planting, field boundaries, ground clutter, broken roadside hedge and small stones, for both, since #1622 the holiday decorations, for any `date` without its holiday, since #1659 the mapped windows' reveals, for both, since #1658 the mapped walls' overhang shadows, for both, since #1634 the urban class (an untagged footprint's storeys), for both, since #1660 the split roofs of L-, T- and U-shaped houses, for both, since #1661 the mapped facades' weathering, for both, since #1626 the mapped doors' winter wreath, for a cost pair, since #1662 the rooms behind mapped glass, for both, and since #1665 the village lots' weathering and rooms, for both | `-foliage-order`, `-texture-bias`, `-air`, `-crag`, `-generated-trees`, `-generated-conifers`, `-ground-blend`, `-road-wear`, `-surface-bounds`, `-settlement-clearing`, `-fir-prepass`, `-people`, `-land-planting`, `-land-boundaries`, `-ground-clutter`, `-hedge-breaks`, `-small-stones`, `-decorations`, `-window-reveals`, `-overhang-shadows`, `-urban-class`, `-split-roofs`, `-weathering`, `-facade-wreath`, `-window-rooms`, `-lot-realism`, comma-separated; default none |
 * | `facing` | which way the route is turned, relative to the sun (#702, `route.ts` §"Which way it faces") | `sun`, `away`; default the route unturned, which looks 110° to 160° away from the sun |
 * | `town` | ride through a mapped town instead of `route.ts`' road (#1581): `footprint-fixtures-testing.ts` §`mixedTownFixture`'s mixed footprints, planned, drawn and lotted as a ride's corridor is, from 900 m to 2 100 m; since #1585 `richmond`, `footprint-fixtures-testing.ts` §`richmondStreetFixture`'s narrow lots drawn as house models beside square ones drawn as extrusions, from 900 m to 1 500 m; since #1542 `countryside`, `footprint-fixtures-testing.ts` §`countrysideFixture`'s fields, woods and a park, from 900 m to 2 100 m, for #1542's levers; since #1635 `terrace`, `footprint-fixtures-testing.ts` §`terraceStreetFixture`'s rows of terraced houses, from 900 m to 2 100 m, with `levers=-urban-class` its control; since #1636 `city`, `testing/urban-fixtures.ts` §`cityCentreFixture`'s city centre, its route-facing ground floors shop fronts and a nine-storey tower a curtain wall, from 900 m to 2 100 m; since #1637 `city-street`, `footprint-fixtures-testing.ts` §`cityCentreFixture`'s city centre, its street and its terraced blocks, from 900 m to 2 100 m, whose before is `levers=-urban-class` | `mixed`, `richmond`, `countryside`, `terrace`, `city`, `city-street`; default none |
 * | `date` | the rider's local day the ride starts on (#1622), in either world: its holiday (`season.ts` §`holidayOn`) and the route's season. A malformed or impossible day is REFUSED | `YYYY-MM-DD`; default this device's own day |
 * | `decorations` | #1624's probe: one small box on every decoration anchor of every village in reach, for either holiday, in place of the product's table (`decorations.ts` §`HOLIDAY_DECORATIONS`: since #1625 Halloween's pumpkins, and nothing yet for winter lights). Pair it with a `date` in a holiday and `route=village`; `levers=-decorations` is its control | `probe`; default the product's table |
 * | `place` | where every road is ridden (#1623), for the route's own season: `south`, the same road mirrored into the southern hemisphere; `nordic`, far enough north that a winter's snow lies to sea level (`route.ts` §`PLACES`) | `south`, `nordic`; default 51.5° N, every road where it was |
 * | `route` | which of `route.ts`' roads is ridden (#1559): absent, the valley road every Part Z and Part AH row was taken on; `village`, `route.ts` §`villageRoute`, a level road through two villages, for validation 0002 AE2 (`at=820` holds the first one's church and shops in frame). Refused beside `town`, which is a road of its own | `village`; default none |
 * | `delivery` | #1815: a Delivery round's worst case on every frame, for the two village ceilings (`realistic-budget.ts` §`DELIVERY_VILLAGE_DRAW_CALLS`): this many parcels, house markers and obstacles each, placed on the road ahead of the rider (`realistic/delivery.ts`) and drawn by the product's own belt. Pair it with `route=village` and the frozen frame's query; absent, the frame carries no round, as an ordinary ride's does. More than the belt's 32 is REFUSED, because it would draw 32 under the name of more | `1` to `32`; default none |
 *
 * ⚠️ **Unknown parameters and values are REFUSED**, as #457's page refused
 * them: a typo in a soak URL would otherwise measure the default under another
 * name, and a table of numbers cannot show that it did.
 */

import {
  ANCHOR_KINDS,
  HOLIDAY_DECORATIONS,
  type DecorationKind,
  type ItemTable,
} from '../../src/game/decorations';
import type { CountrysideLever } from '../../src/game/land-class';
import type { RealisticTrees } from '../../src/game/realistic-assets';
import {
  parseCalendarDay,
  seasonOn,
  type CalendarDay,
  type Hemisphere,
  type Season,
} from '../../src/game/season';
import type { DepthPrepassMode, RealisticSurfaces } from '../../src/game/three-renderer';

import { PLACES, type Facing, type Place } from '../../src/demo/synthetic-road';

/**
 * The layers `?layers=` can switch off — #616. What each one holds, in both
 * worlds, is `layers.ts` §`LAYER_OWNERS`; turning one off hides it in whichever
 * world is drawn and replaces it with nothing, and never moves the rung.
 */
export const LAYERS = [
  'sky',
  'surfaces',
  'vegetation',
  'impostors',
  'structures',
  'water',
  'riders',
  // #620: the ground blobs under the scenery — one mesh for trees, shrubs,
  // rocks and structures alike, so a layer of its own rather than a share of
  // two. Off, it is #620's "before": the rock's baked occlusion is in the file
  // and has no switch.
  'grounding',
] as const;

/** One of {@link LAYERS}. */
export type Layer = (typeof LAYERS)[number];

/**
 * #619's levers that `?levers=` can switch off — each a before/after pair the
 * owner runs at one rung (validation 0002 Part AH), the product's setting
 * being the one with every lever on.
 *
 * - `foliage-order` — lever 1: the canopy drawn after the opaque world
 *   (`three-renderer.ts` §`FOLIAGE_RENDER_ORDER`). Off puts every vegetation
 *   mesh back where three draws it unasked. The picture is the same either way.
 * - `texture-bias` — lever 2: the second realistic rung's one-mip-coarser
 *   photographs (`quality.ts` §`QualitySettings.textureLodBias`). Off samples
 *   them at the top rung's detail. It changes nothing on the top rung, which
 *   carries no bias: pair it with `rung=1&ladder=0`.
 * - `air` — #622: the fog leaning towards the sky in the direction looked, and
 *   the valley haze. Off flattens the direction table to its mean and turns the
 *   haze off, which is the picture before #622 — for the owner's BY-EYE
 *   comparison only. ⚠️ **Not a cost pair**: the shader runs either way, so
 *   #622's cost is two builds (validation 0002 Part AH §"The #622 rows").
 * - `crag` — #1274: the rock face a steep bank wears, ambientCG's. Off draws
 *   the bank in the scree's photograph, which is the picture before #1274 —
 *   for the owner's BY-EYE comparison. ⚠️ **Not a cost pair either**: the
 *   ground's shader is the same program with it off, and samples one
 *   photograph on a bank where it sampled the other.
 * - `generated-conifers` — #1294: the firs generated to their budget (ADR
 *   0049 D-1), in Poly Haven's photographed sprigs. Off loads the fir
 *   photoscans they replaced instead and leaves the broadleaves generated,
 *   which is the world #1283 left — the fir's own BY-EYE pair and the tablet's
 *   cost pair for it. Read at load, as `generated-trees` is.
 * - `generated-trees` — #1283: the trees generated to their budget (ADR 0049
 *   D-1). Off loads the photoscans instead — ⚠️ since #1294 EVERY tree's, the
 *   firs' too, with or without `generated-conifers` — which is
 *   the world before #1283 — for the owner's BY-EYE comparison, and for the
 *   tablet's cost pair: the two sets are different files, so the frame time,
 *   the draw calls and the triangles of one run against the other are the
 *   trees' own difference. ⚠️ **Read at load**: it chooses which files are
 *   fetched, so it is a different URL and not a switch on a running page.
 * - `ground-blend` — #1523: the realistic ground as it was before #627's
 *   verge, rock and scree and #1274's crag — #425's near and far photograph
 *   and #460's patchwork, in a program that holds none of the blend's code or
 *   its six maps (`three-renderer.ts` §`realisticSurfacesOf`). The tablet's
 *   COST pair for the blend, which `crag` is not; it changes the picture too.
 * - `road-wear` — #1523: the realistic road without #628's wear and #879's
 *   roughness and relief — no wheel track, no dust, no patch loop in its
 *   program. The tablet's cost pair for the wear, which `game-harness.ts`'s
 *   wear switch is not: that one zeroes uniforms and keeps the loop.
 * - `surface-bounds` — #1523's fix to both: the wear's patch loop only on a
 *   triangle a patch can reach and the paint's noise only on paint, and the
 *   ground blend's derivatives taken once. Off builds both shaders as they
 *   were before it, which draws the same picture (the browser gate holds the
 *   two to one) — the tablet's before/after pair for the fix on one build.
 *
 * None of #1523's changes anything a rider can reach: the product always
 * builds both surfaces, bounded, and only this page's URL turns one off.
 *
 * - `fir-prepass` — #1523's fix to the generated firs (#1294): each fir mesh
 *   drawn after a depth pre-pass that only cuts, so the lit shader runs on
 *   the one fragment a pixel keeps (`three-renderer.ts` §`withDepthPrepass`).
 *   Off draws the firs as they were before it, which is the same picture (the
 *   browser gate holds the two to one) — the tablet's before/after pair for
 *   the fix on one build. The product always draws the pre-pass.
 *
 * - `people` — #1541: the people on the pavements, front paths and footways
 *   (`people.ts`, `three-renderer.ts` §`PeopleBelt`). Off places nobody, so the
 *   frame draws neither their bodies' call nor their impostors' — the tablet's
 *   COST pair for them (validation 0002 Part AJ), and the owner's by-eye pair.
 *   The product draws them on the top realistic rung (`quality.ts`
 *   §`QualitySettings.people`).
 *
 * - `settlement-clearing` — #1534: the trees, shrubs and rocks left standing on
 *   a village's or a farmstead's ground, as every frame was before #1534
 *   (`scene.ts` §`SceneInput.settlementsWooded`). The tablet's cost pair for
 *   the clearing, which can only take instances away, and the owner's BY-EYE
 *   pair for it. Changes nothing a rider can reach.
 *
 * - `decorations` — #1622: no holiday on any `date`, as a rider who switched
 *   Settings' "Holiday decorations" off rides. The route's seasonal nature is
 *   unaffected (`season.ts` §`seasonOn`).
 *
 * - `land-planting`, `land-boundaries`, `ground-clutter` — #1542's three
 *   changes, each off on its own (`scene.ts` §`SceneInput.countrysideOff`):
 *   the species mix and clustering by land class, field boundaries along
 *   farmland's edges, and stones on pasture and a wood's floor. Off is the
 *   countryside before #1542. They change only covered land, so pair them with
 *   `town=countryside`: on `route.ts`' road, which has no corridor, every one
 *   is the same picture. The owner's BY-EYE pair, and the tablet's cost pair
 *   (validation 0002 Part AH, #1542's rows).
 *
 * - `hedge-breaks`, `small-stones` — the owner's ruling of 2026-10-24 on
 *   #1542, each off on its own: mapped farmland's roadside hedge lowered and
 *   broken by gaps, a gate, fence and open verge (`settlements.ts`
 *   §`roadsidePiece`), and rocks on mapped farmland and a wood smaller and
 *   kept back from the road (`scatter.ts` §`STONE_SCALE`). Off, each is the
 *   countryside as #1542 first drew it. `hedge-breaks` has nothing to change
 *   with `land-boundaries` off; `small-stones` has nothing to change only
 *   with BOTH `land-planting` and `ground-clutter` off — with `ground-clutter`
 *   alone off it still shrinks a wood's rocks and keeps them back from the
 *   road.
 *
 * - `window-reveals` — #1659: every mapped window kind's view-dependent
 *   reveal, its sun's shadows on the glass and its sill's on the wall
 *   (`three-renderer.ts` §`windowRevealsOf`). Off builds the facade program
 *   without the term — its two functions built empty, not a uniform at zero,
 *   as `road-wear` does — so every window is drawn flat, as a decal: the
 *   tablet's COST pair and the owner's BY-EYE pair. Pair it with `town=mixed`
 *   or `town=richmond`: on `route.ts`' road there is no mapped building. The
 *   product always builds the reveals.
 *
 * - `mapped-blobs` — #1657: the ground blob under every drawn mapped building
 *   (`three-renderer.ts` §`MappedBuildingBelt.grounded`). Off hands no mapped
 *   building to the blob belt, which is the picture and the cost before
 *   #1657: the tablet's COST pair (two triangles a building, and the blended
 *   ground under it) and the owner's BY-EYE pair. Only a town has mapped
 *   buildings, so pair it with `town=mixed`; on `route.ts`' road the two are
 *   the same picture. The product always grounds them.
 *
 * - `overhang-shadows` — #1658: the sun's own shadow under a mapped wall's
 *   eaves, on the walls the sun lights, as deep as its slant makes it
 *   (`three-renderer.ts` §`overhangShadowsOf`). Off builds the facade program
 *   without the term — its function and its splice left out, not a uniform at
 *   zero, as `road-wear` does — so every wall under eaves has #1588's
 *   symmetric band, sunny side and shaded side alike: the tablet's COST pair
 *   and the owner's BY-EYE pair. Pair it with `town=mixed`: on `route.ts`'
 *   road there is no mapped building. The product always builds the shadows.
 *
 * - `urban-class` — #1634: the town's urban class (`urban-class.ts`), built
 *   from its corridor and mask as `GameView`'s press builds it. Off plans the
 *   footprints with `NO_URBAN_CLASS`, every stretch `unknown`, which is the
 *   class forced to `unknown` that #1638's before row names: today, an
 *   untagged footprint at the flat 2 storeys rather than chosen by class,
 *   use, area and its tagged neighbours. The owner's BY-EYE pair, and the
 *   tablet's cost pair (taller boxes add fill, not draw calls). Only a `town`
 *   has a class; on `route.ts`' road the two are the same picture. The
 *   product always builds the class. Since #1637 off also takes a city
 *   centre's street and terraced blocks with it — `town=city-street`'s before.
 *
 * - `split-roofs` — #1660: L-, T-, U- and Z-shaped mapped houses pitched over
 *   their 2–3 rectangles (`rectilinear-roofs.ts`), and no roof over a notch.
 *   Off plans every footprint by `main`'s rule, every one below 0.85
 *   rectangularity flat behind its parapet. Read at load, as
 *   `generated-trees` is, since plans are built at ride start. The owner's
 *   BY-EYE pair and the tablet's cost pair; pair it with `town=mixed`, whose
 *   every fifth house is an L. The product always splits.
 *
 * - `weathering` — #1661: the mapped facades' weathering — the photograph
 *   laid per building and its repeat broken, splash grime at a wall's foot,
 *   streaks under the sills, a flat roof's drip, a roof's eaves courses and
 *   moss, a parged plinth (`three-renderer.ts` §`weatheringOf`). Off builds
 *   both facade programs without the term — its functions and splices left
 *   out, not a uniform at zero, as `road-wear` does — so every mapped wall is
 *   as freshly rendered as before #1661: the tablet's COST pair and the
 *   owner's BY-EYE pair. Pair it with `town=mixed`: on `route.ts`' road there
 *   is no mapped building. The product always builds the weathering.
 *
 * - `window-rooms` — #1662: the rooms behind every mapped pane — each pane's
 *   ray followed into a procedural room, painted from a seeded palette — and
 *   the glass's reflection weighted by Schlick's Fresnel rather than a
 *   constant metalness (`three-renderer.ts` §`windowRoomsOf`). Off builds the
 *   facade program without the term — the function, its calls and the
 *   finish's change left out, not a uniform at zero, as `road-wear` does — so
 *   every pane is #1581's dark room and gradient at metalness 0.35: the
 *   tablet's COST pair and the owner's BY-EYE pair. Pair it with `town=mixed`:
 *   on `route.ts`' road there is no mapped building. The product always
 *   builds the rooms.
 *
 * - `lot-realism` — #1665: #1661's weathering on the procedural lots' walls
 *   and roofs — the photograph's repeat broken, splash grime at a wall's
 *   foot, moss on a roof — and #1662's rooms behind their glass
 *   (`three-renderer.ts` §`lotRealismOf`). Off builds the lots' wall, roof and
 *   glass programs without the terms — their functions and splices left out,
 *   not a uniform at zero, as `road-wear` does — so every lot is drawn as
 *   before #1665: the tablet's COST pair and the owner's BY-EYE pair. Pair it
 *   with `route=village`, whose villages are lots. The product always builds
 *   it.
 *
 * - `village-models` — #1566: the procedural villages' houses and
 *   main-street blocks drawn as #1585's models (`three-renderer.ts`
 *   §`VillageHouseBelt`). Off draws every plot as its procedural building,
 *   as before the models — its plot layout and its paint stay: the owner's
 *   BY-EYE pair and the tablet's cost pair (one draw call, and the models'
 *   triangles inside the structure term). Pair it with `route=village`: the
 *   default road's villages are far from its holds. The product always
 *   draws the models.
 *
 * - `facade-wreath` — #1626: the wreath the facade draws on every mapped
 *   front door while the winter lights are on (`three-renderer.ts`
 *   §`facadeWreathOf`). Off writes the wreath's uniform 0 whatever the
 *   holiday: the proof that the wreath costs no call (the frame's calls are
 *   the same either way) and the owner's BY-EYE pair. Pair it with a `date`
 *   in the winter lights and `town=mixed`: only a town has mapped buildings.
 *   The product always draws the wreath.
 */
export const LEVERS = [
  'air',
  'crag',
  'decorations',
  'facade-wreath',
  'fir-prepass',
  'foliage-order',
  'generated-conifers',
  'generated-trees',
  'ground-blend',
  'ground-clutter',
  'hedge-breaks',
  'land-boundaries',
  'land-planting',
  'lot-realism',
  'mapped-blobs',
  'overhang-shadows',
  'people',
  'road-wear',
  'settlement-clearing',
  'small-stones',
  'split-roofs',
  'surface-bounds',
  'texture-bias',
  'urban-class',
  'village-models',
  'weathering',
  'window-reveals',
  'window-rooms',
] as const;

/** One of {@link LEVERS}. */
export type Lever = (typeof LEVERS)[number];

/** One configuration of the page. */
export interface RealisticPageConfig {
  readonly world: 'realistic' | 'stylised';
  readonly rung: 0 | 1;
  readonly ladder: boolean;
  readonly seconds: number;
  readonly soakMinutes: number;
  readonly at: number | undefined;
  readonly panel: boolean;
  /** The layers switched off, in {@link LAYERS}' order, each at most once — #616. */
  readonly layersOff: readonly Layer[];
  /** #619's levers switched off, in {@link LEVERS}' order, each at most once. */
  readonly leversOff: readonly Lever[];
  /**
   * Which way the route is turned — #702. `undefined` is the route unturned,
   * the one every Part Z and Part AH row was taken on.
   */
  readonly facing: Facing | undefined;
  /**
   * A mapped town to ride through — #1581's by-eye pair for the owner, near a
   * town and inside one. `undefined` is `route.ts`' road, with no corridor.
   */
  readonly town:
    'mixed' | 'richmond' | 'countryside' | 'terrace' | 'city' | 'city-street' | undefined;
  /**
   * #1559: `route.ts` §`villageRoute` instead of its default road, for
   * validation 0002 AE2. `undefined` is the default road, unchanged.
   */
  readonly route: 'village' | undefined;
  /**
   * #1622: the rider's local day the ride starts on. `undefined` is this
   * device's own day, as a ride reads it (`season.ts` §`deviceToday`).
   */
  readonly date: CalendarDay | undefined;
  /**
   * #1624: what the holidays decorate with — `probe` for {@link PROBE_DECORATIONS},
   * `undefined` for the product's own table.
   */
  readonly decorations: 'probe' | undefined;
  /**
   * #1623: where every road is ridden, for the route's season. `undefined` is
   * 51.5° N, every road where it was. @see route.ts §PLACES
   */
  readonly place: Place | undefined;
  /**
   * #1815: how many of each Delivery piece every frame carries, ahead of the
   * rider. `undefined` is a frame with no round, as an ordinary ride's.
   * @see realistic/delivery.ts
   */
  readonly delivery: number | undefined;
}

/** The ride the owner is asked to look at: the realistic world, the ladder running. */
export const DEFAULT_CONFIG: RealisticPageConfig = {
  world: 'realistic',
  rung: 0,
  ladder: true,
  seconds: 30,
  soakMinutes: 0,
  at: undefined,
  panel: true,
  layersOff: [],
  leversOff: [],
  facing: undefined,
  town: undefined,
  route: undefined,
  date: undefined,
  decorations: undefined,
  place: undefined,
  delivery: undefined,
};

const KNOWN = new Set([
  'world',
  'rung',
  'ladder',
  'seconds',
  'soak',
  'at',
  'panel',
  'layers',
  'levers',
  'facing',
  'town',
  'route',
  'date',
  'decorations',
  'place',
  'delivery',
]);

/**
 * `?layers=-vegetation,-water` as the layers it switches off — #616.
 *
 * ⚠️ Every entry is a `-` and a name from {@link LAYERS}, and anything else is
 * REFUSED, for the reason every other parameter here is: a typo in a layer's
 * name would otherwise measure every layer on under the name of one that was
 * off, and a row of numbers cannot show that it did. Only `-` exists, because
 * every layer is on unless the URL says otherwise.
 */
function layersFrom(value: string | null): readonly Layer[] {
  return switchedOff('layers', LAYERS, value);
}

/**
 * `?levers=-texture-bias` as the levers it switches off — #619, refused on the
 * same terms as {@link layersFrom} and for the same reason.
 */
function leversFrom(value: string | null): readonly Lever[] {
  return switchedOff('levers', LEVERS, value);
}

/** A `-name,-name` list of `names` switched off, in `names`' order; anything else refused. */
function switchedOff<T extends string>(
  key: string,
  names: readonly T[],
  value: string | null,
): readonly T[] {
  if (value === null) return [];
  const off = new Set<T>();
  for (const entry of value.split(',')) {
    const name = entry.startsWith('-') ? entry.slice(1) : undefined;
    const found = names.find((each) => each === name);
    if (found === undefined) {
      throw new Error(
        `realistic: ${key} is a comma-separated list of -${names.join(', -')}, not "${value}"`,
      );
    }
    off.add(found);
  }
  return names.filter((each) => off.has(each));
}

/** #1542's changes a run switches off, as `scene.ts` §`SceneInput.countrysideOff` takes them. */
export function countrysideWithLevers(leversOff: readonly Lever[]): readonly CountrysideLever[] {
  const off: CountrysideLever[] = [];
  if (leversOff.includes('land-planting')) off.push('planting');
  if (leversOff.includes('land-boundaries')) off.push('boundaries');
  if (leversOff.includes('ground-clutter')) off.push('clutter');
  if (leversOff.includes('hedge-breaks')) off.push('hedge-breaks');
  if (leversOff.includes('small-stones')) off.push('small-stones');
  return off;
}

/**
 * A rung as this run draws it: the product's own, with a lever that works
 * through the rung taken back out — #619. Only `texture-bias` does; the
 * foliage order is the view's, and `realistic-harness.ts` switches it there.
 */
export function rungWithLevers<R extends { readonly textureLodBias: number }>(
  rung: R,
  leversOff: readonly Lever[],
): R {
  return leversOff.includes('texture-bias') ? { ...rung, textureLodBias: 0 } : rung;
}

/**
 * Which trees this run loads — #1283, #1294: the generated ones, as the
 * product does; with `generated-conifers` off the scanned firs beside the
 * generated broadleaves; or with `generated-trees` off every tree's scan.
 * `realistic-harness.ts` hands it to `three-renderer.ts` §`setRealisticTrees`
 * before the world is loaded.
 */
export function treesWithLevers(leversOff: readonly Lever[]): RealisticTrees {
  if (leversOff.includes('generated-trees')) return 'scanned';
  return leversOff.includes('generated-conifers') ? 'scanned-conifers' : 'generated';
}

/**
 * Which of the realistic surfaces' shaders this run builds — #1523: both,
 * bounded, as the product does, unless `ground-blend`, `road-wear` or
 * `surface-bounds` is off.
 * `realistic-harness.ts` hands it to `three-renderer.ts` §`realisticSurfacesOf`.
 */
export function surfacesWithLevers(leversOff: readonly Lever[]): RealisticSurfaces {
  return {
    groundBlend: !leversOff.includes('ground-blend'),
    roadWear: !leversOff.includes('road-wear'),
    bounded: !leversOff.includes('surface-bounds'),
  };
}

/**
 * How this run draws the firs — #1523: after their depth pre-pass, as the
 * product does, unless `fir-prepass` is off. `realistic-harness.ts` hands it
 * to `three-renderer.ts` §`firDepthPrepassOf`.
 */
export function firPrepassWithLevers(leversOff: readonly Lever[]): DepthPrepassMode {
  return leversOff.includes('fir-prepass') ? 'off' : 'drawn';
}

/**
 * Whether this run draws the mapped doors' winter wreath — #1626: as the
 * product does, unless `facade-wreath` is off. `realistic-harness.ts` hands
 * it to `three-renderer.ts` §`facadeWreathOf`.
 */
export function facadeWreathWithLevers(leversOff: readonly Lever[]): boolean {
  return !leversOff.includes('facade-wreath');
}

/**
 * Whether this run builds the mapped windows' reveals — #1659: as the product
 * does, unless `window-reveals` is off. `realistic-harness.ts` hands it to
 * `three-renderer.ts` §`windowRevealsOf`.
 */
export function windowRevealsWithLevers(leversOff: readonly Lever[]): boolean {
  return !leversOff.includes('window-reveals');
}

/**
 * Whether this run builds the mapped walls' overhang shadows — #1658: as the
 * product does, unless `overhang-shadows` is off. `realistic-harness.ts`
 * hands it to `three-renderer.ts` §`overhangShadowsOf`.
 */
export function overhangShadowsWithLevers(leversOff: readonly Lever[]): boolean {
  return !leversOff.includes('overhang-shadows');
}

/**
 * Whether this run builds the mapped facades' weathering — #1661: as the
 * product does, unless `weathering` is off. `realistic-harness.ts` hands it
 * to `three-renderer.ts` §`weatheringOf`.
 */
export function weatheringWithLevers(leversOff: readonly Lever[]): boolean {
  return !leversOff.includes('weathering');
}

/**
 * Whether this run builds the rooms behind mapped glass — #1662: as the
 * product does, unless `window-rooms` is off. `realistic-harness.ts` hands it
 * to `three-renderer.ts` §`windowRoomsOf`.
 */
export function windowRoomsWithLevers(leversOff: readonly Lever[]): boolean {
  return !leversOff.includes('window-rooms');
}

/**
 * Whether this run builds the procedural lots' weathering and rooms — #1665:
 * as the product does, unless `lot-realism` is off. `realistic-harness.ts`
 * hands it to `three-renderer.ts` §`lotRealismOf`.
 */
export function lotRealismWithLevers(leversOff: readonly Lever[]): boolean {
  return !leversOff.includes('lot-realism');
}

/**
 * Whether this run plans the town's footprints with its urban class — #1634:
 * as the product's press does, unless `urban-class` is off.
 * `realistic-harness.ts` hands the class, or `NO_URBAN_CLASS`, to
 * `footprint-buildings.ts` §`footprintPlans`.
 */
export function urbanClassWithLevers(leversOff: readonly Lever[]): boolean {
  return !leversOff.includes('urban-class');
}

/**
 * Whether this run pitches L-, T-, U- and Z-shaped mapped houses over their
 * 2–3 rectangles — #1660: the product always does; `-split-roofs` plans every
 * footprint by `main`'s rule, every one below 0.85 rectangularity flat. Read
 * at load, as `generated-trees` is, because plans are built at ride start.
 */
export function splitRoofsWithLevers(leversOff: readonly Lever[]): boolean {
  return !leversOff.includes('split-roofs');
}

/** A configuration from a query string. @see RealisticPageConfig */
export function parseConfig(search: string): RealisticPageConfig {
  const params = new URLSearchParams(search);
  for (const key of params.keys()) {
    if (!KNOWN.has(key)) throw new Error(`realistic: unknown parameter "${key}"`);
  }
  const oneOf = <T extends string | number>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = params.get(key);
    if (value === null) return fallback;
    const found = allowed.find((each) => String(each) === value);
    if (found === undefined) {
      throw new Error(`realistic: ${key} is one of ${allowed.join(', ')}, not "${value}"`);
    }
    return found;
  };
  const atLeast = (key: string, fallback: number, minimum: number): number => {
    const value = params.get(key);
    if (value === null) return fallback;
    const number = Number(value);
    if (!Number.isFinite(number) || number < minimum) {
      throw new Error(
        `realistic: ${key} is a number of at least ${String(minimum)}, not "${value}"`,
      );
    }
    return number;
  };
  return {
    world: oneOf('world', ['realistic', 'stylised'] as const, DEFAULT_CONFIG.world),
    rung: oneOf('rung', [0, 1] as const, DEFAULT_CONFIG.rung),
    ladder: oneOf('ladder', ['1', '0'] as const, '1') === '1',
    seconds: atLeast('seconds', DEFAULT_CONFIG.seconds, 1),
    soakMinutes: atLeast('soak', 0, 0),
    at: params.has('at') ? atLeast('at', 0, 0) : undefined,
    panel: oneOf('panel', ['1', '0'] as const, '1') === '1',
    layersOff: layersFrom(params.get('layers')),
    leversOff: leversFrom(params.get('levers')),
    facing: params.has('facing') ? oneOf('facing', ['sun', 'away'] as const, 'sun') : undefined,
    town: params.has('town')
      ? oneOf(
          'town',
          ['mixed', 'richmond', 'countryside', 'terrace', 'city', 'city-street'] as const,
          'mixed',
        )
      : undefined,
    route: params.has('route') ? routeFrom(params) : undefined,
    date: params.has('date') ? dateFrom(params.get('date') ?? '') : undefined,
    decorations: params.has('decorations')
      ? oneOf('decorations', ['probe'] as const, 'probe')
      : undefined,
    place: params.has('place') ? oneOf('place', PLACES, 'south') : undefined,
    delivery: params.has('delivery') ? deliveryFrom(params.get('delivery') ?? '') : undefined,
  };
}

/**
 * The most of each Delivery piece the product's belt draws:
 * `three-renderer.ts` §`DELIVERY_PIECE_CAPACITY`, restated so that this
 * module loads no renderer; `delivery.test.ts` holds the two equal.
 */
export const DELIVERY_PIECES_MOST = 32;

/**
 * `?delivery=20` — #1815. A whole number from 1 to {@link DELIVERY_PIECES_MOST},
 * and anything else REFUSED: past the belt's capacity it draws the first 32
 * and not the rest, so a URL asking for more would measure 32 under its name.
 */
function deliveryFrom(value: string): number {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > DELIVERY_PIECES_MOST) {
    throw new Error(
      `realistic: delivery is a whole number from 1 to ${String(DELIVERY_PIECES_MOST)}, not "${value}"`,
    );
  }
  return count;
}

/**
 * `?date=2026-10-31` — #1622. REFUSED unless it is a strict `YYYY-MM-DD`
 * naming a real day, on the terms an unknown lever is: a typo would otherwise
 * ride today under the named day, and a screenshot cannot show that it did.
 */
function dateFrom(value: string): CalendarDay {
  const day = parseCalendarDay(value);
  if (day === undefined) {
    throw new Error(`realistic: date is a real day written YYYY-MM-DD, not "${value}"`);
  }
  return day;
}

/**
 * The season this run's view is told — #1622: the URL's `date`, or `today`
 * when it names none, in whichever world; no holiday with `-decorations`, and
 * the route's own nature either way. `realistic-harness.ts` hands it to
 * `GameView.setSeason`, as `GameView` does at a ride's start.
 */
export function seasonWithLevers(
  config: Pick<RealisticPageConfig, 'date' | 'leversOff'>,
  place: { readonly hemisphere: Hemisphere; readonly absLatitude: number },
  today: () => CalendarDay,
): Season {
  return seasonOn(
    config.date ?? today(),
    place.hemisphere,
    place.absLatitude,
    !config.leversOff.includes('decorations'),
  );
}

/**
 * #1624's probe: ONE small box, standing on every anchor of every kind
 * (`decorations.ts` §`ANCHOR_KINDS`), for both holidays. It exists so that
 * the browser gate's "one call for the belt" cannot pass over a belt with
 * nothing in it, and it lives on this page alone: `realistic.html` is built
 * only by `vite.browser.config.ts`, so no rider reaches it. Since #1625 the
 * gate rides Halloween on the product's own pumpkins instead
 * (`realistic-town.browser.spec.ts`); #1626 does the same for winter lights.
 */
const PROBE: DecorationKind = {
  item: 'probe',
  anchors: ANCHOR_KINDS,
  chance: 1,
  radius: 0.15,
  parts: [{ size: [0.3, 0.3, 0.3], at: [0, 0.15, 0], colour: 0xe07a1f, glows: false }],
};

/** {@link PROBE} for every holiday. */
export const PROBE_DECORATIONS: ItemTable = { halloween: [PROBE], 'winter-lights': [PROBE] };

/** What this run decorates with — #1624. `realistic-harness.ts` hands it to `decorationKindsOf`. */
export function decorationsWithConfig(config: Pick<RealisticPageConfig, 'decorations'>): ItemTable {
  return config.decorations === 'probe' ? PROBE_DECORATIONS : HOLIDAY_DECORATIONS;
}

/**
 * `?route=village` — #1559. Refused beside `town`, which rides a road of its
 * own: a URL naming both would measure one of them under the other's name.
 */
function routeFrom(params: URLSearchParams): 'village' {
  const value = params.get('route');
  if (value !== 'village')
    throw new Error(`realistic: route is one of village, not "${String(value)}"`);
  if (params.has('town')) {
    throw new Error('realistic: route and town are two roads; name one of them, not both');
  }
  return value;
}

/** The query string that reproduces a configuration — the inverse of {@link parseConfig}. */
export function configQuery(config: RealisticPageConfig): string {
  const params = new URLSearchParams();
  if (config.world !== DEFAULT_CONFIG.world) params.set('world', config.world);
  if (config.rung !== DEFAULT_CONFIG.rung) params.set('rung', String(config.rung));
  if (!config.ladder) params.set('ladder', '0');
  if (config.seconds !== DEFAULT_CONFIG.seconds) params.set('seconds', String(config.seconds));
  if (config.soakMinutes !== 0) params.set('soak', String(config.soakMinutes));
  if (config.at !== undefined) params.set('at', String(config.at));
  if (!config.panel) params.set('panel', '0');
  if (config.layersOff.length > 0) {
    params.set('layers', config.layersOff.map((layer) => `-${layer}`).join(','));
  }
  if (config.leversOff.length > 0) {
    params.set('levers', config.leversOff.map((lever) => `-${lever}`).join(','));
  }
  if (config.facing !== undefined) params.set('facing', config.facing);
  if (config.town !== undefined) params.set('town', config.town);
  if (config.route !== undefined) params.set('route', config.route);
  if (config.date !== undefined) {
    const { year, month, day } = config.date;
    params.set(
      'date',
      `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    );
  }
  if (config.decorations !== undefined) params.set('decorations', config.decorations);
  if (config.place !== undefined) params.set('place', config.place);
  if (config.delivery !== undefined) params.set('delivery', String(config.delivery));
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

/** The 50th, 90th and 99th percentiles of a sample, nearest-rank. */
export interface Percentiles {
  readonly p50: number;
  readonly p90: number;
  readonly p99: number;
  readonly count: number;
}

/**
 * Nearest-rank percentiles: the smallest sample with at least p% of the
 * samples at or below it. NaN for an empty sample rather than 0 — a frame time
 * of zero reads as "fast", and an empty sample means nothing was timed.
 */
export function percentiles(samples: readonly number[]): Percentiles {
  if (samples.length === 0) return { p50: NaN, p90: NaN, p99: NaN, count: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = (p: number): number =>
    sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] as number;
  return { p50: rank(50), p90: rank(90), p99: rank(99), count: sorted.length };
}
