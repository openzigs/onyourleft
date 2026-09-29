// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The realistic trees' far band lit by the world's sun, and every tree's
 * foliage moving in a breeze — #630.
 *
 * ## The impostor's light
 *
 * An impostor strip is eight pictures of the full scan, rendered by
 * `tools/realistic/blender/process_tree.py` under the SCRIPT's own sun — so a
 * far tree was lit from wherever that sun happened to be relative to the
 * instance's random turn, and did not answer `world.ts`'s sun at all. Since
 * #630 the script bakes a second strip beside it, the same views' NORMALS in
 * the plant's own frame, and the shader relights each texel:
 *
 *     texel · shade(world sun, n) / shade(script's sun, n)
 *
 * each shade normalised by its mean over a hemisphere of normals, so a far
 * tree is on average as bright as it was and its LIT SIDE is the world's. The
 * ratio is clamped to {@link IMPOSTOR_RELIGHT_RANGE}: where the script's sun
 * put a texel in its own shadow the division would otherwise lift noise.
 *
 * ## The breeze
 *
 * A VISUAL wind, and deliberately not the rider's (`simulation.ts`
 * §`SimulationSetup.wind`, #326): that one is a force the physics resolves
 * against the road's heading, typed in by the rider and fixed for the ride
 * (#335); this is how leaves look. So a ride with a headwind set and a ride in
 * still air sway alike, gently, from {@link FOLIAGE_WIND_BEARING_DEGREES}. It
 * is driven by the RIDE's clock (`port.ts` §`WaterFrame.seconds`, the clock
 * the ripples already run on), so a held ride is still and a frame is a
 * function of the frame; and each tree's phase is a hash of where it stands,
 * so no two move in lockstep.
 *
 * Pure: names no rendering library.
 */

/**
 * The direction toward the script's sun, in the plant's own frame in three's
 * axes (x across, y up, z the model's front) — what `process_tree.py`'s sun,
 * rotated `(35°, 0°, 135°)` in Blender's XYZ order from pointing straight
 * down, shines FROM. Blender's `(x, y, z)` is three's `(x, z, −y)`.
 */
export function scriptSunToward(): readonly [number, number, number] {
  const rx = (35 * Math.PI) / 180;
  const rz = (135 * Math.PI) / 180;
  // Rz · Rx applied to (0, 0, −1): the direction the light travels.
  const x0 = 0;
  const y0 = Math.sin(rx);
  const z0 = -Math.cos(rx);
  const x = Math.cos(rz) * x0 - Math.sin(rz) * y0;
  const y = Math.sin(rz) * x0 + Math.cos(rz) * y0;
  const z = z0;
  // Toward the sun is against the light's travel; then into three's axes.
  return [-x, -z, y];
}

/**
 * The script's sky against its sun, as the share of a face's light that comes
 * from the whole sky: **0.45**. Its world is a 0.8-strength background of
 * about 0.62 grey, `π · 0.8 · 0.62 ≈ 1.56` on a face turned up, against a sun
 * of 3.5 — the same split `world.ts`'s `SunStyle` states as `ambient` and
 * `direct`.
 */
export const SCRIPT_SKY_SHARE = 0.45;

/**
 * How much of an impostor texel's normal is the CROWN's — a sphere round the
 * scan, from where the texel is on the billboard — rather than the strip's:
 * **0.7**. The strip's normals over a canopy face the camera that rendered
 * them (a leaf card's normal in Cycles' pass faces the ray), so they carry
 * the leaves' detail and not the tree's shape; the crown carries the shape,
 * which is what puts the lit side toward the sun.
 */
export const IMPOSTOR_CROWN_SHARE = 0.7;

/** How far the relighting may brighten or darken a texel: **0.45×** to **1.8×**. */
export const IMPOSTOR_RELIGHT_RANGE: readonly [number, number] = [0.45, 1.8];

/**
 * A shade normalised by its mean over the upper hemisphere of normals: the
 * sky share, plus the sun's cosine, over the same with the cosine's mean (½).
 *
 * @test-facing the arithmetic `foliage-light.test.ts` holds; the shader is
 * built from the same constants.
 */
export function normalisedShade(ambient: number, direct: number, cosine: number): number {
  return (ambient + direct * Math.max(cosine, 0)) / (ambient + direct * 0.5);
}

/**
 * The relighting factor for one texel — {@link normalisedShade} under the
 * world's sun over the same under the script's, clamped.
 *
 * @test-facing as {@link normalisedShade}.
 */
export function relight(
  world: { readonly ambient: number; readonly direct: number; readonly cosine: number },
  scriptCosine: number,
): number {
  const ratio =
    normalisedShade(world.ambient, world.direct, world.cosine) /
    normalisedShade(SCRIPT_SKY_SHARE, 1, scriptCosine);
  return Math.min(IMPOSTOR_RELIGHT_RANGE[1], Math.max(IMPOSTOR_RELIGHT_RANGE[0], ratio));
}

/**
 * Where the breeze comes from, as a compass bearing in degrees: **240**, a
 * south-westerly — the prevailing wind of the temperate latitudes the fixture
 * routes sit in. It sways the leaves and does nothing else.
 */
export const FOLIAGE_WIND_BEARING_DEGREES = 240;

/**
 * How far the top of a tree sways, in metres, at the peak of the summed waves:
 * **0.12** — about 1 % of a 9 m conifer's height, a breeze and not a storm.
 * Down the tree it falls off as the square of the height, so the base is still.
 */
export const FOLIAGE_SWAY_METRES = 0.12;

/** How much of the foliage's sway the wood takes: **0.15** — a trunk is nearly still. */
export const WOOD_SWAY_SHARE = 0.15;

/**
 * The breeze's three waves: angular frequency in radians a second, weight,
 * and how many times the tree's own phase each takes. Summed, they peak at 1.
 * This repository's own figures — a slow sway, a flutter, a quiver.
 */
export const FOLIAGE_WAVES: readonly (readonly [number, number, number])[] = [
  [0.9, 0.55, 1],
  [2.1, 0.3, 1.7],
  [4.3, 0.15, 2.3],
];

/**
 * The breeze's direction in the corridor's frame — `x` WEST, `z` north
 * (`terrain.ts` §`localGroundPosition`) — the way the leaves are pushed:
 * FROM {@link FOLIAGE_WIND_BEARING_DEGREES}, so toward its opposite.
 */
export function foliageWindDirection(): readonly [number, number] {
  const toward = ((FOLIAGE_WIND_BEARING_DEGREES + 180) * Math.PI) / 180;
  // A bearing is clockwise from north: east is sin, north is cos; x is west.
  return [-Math.sin(toward), Math.cos(toward)];
}

/**
 * The sway at a time and a tree's phase, as a share of
 * {@link FOLIAGE_SWAY_METRES} at the top of the tree: in `[−1, 1]`.
 *
 * @test-facing as {@link normalisedShade}.
 */
export function swayAt(seconds: number, phase: number): number {
  return FOLIAGE_WAVES.reduce(
    (sum, [rate, weight, phases]) => sum + weight * Math.sin(seconds * rate + phase * phases),
    0,
  );
}
