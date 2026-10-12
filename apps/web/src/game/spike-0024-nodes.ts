// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable -- spike 0024 (#1273): never merged, and three's TSL is typed loosely */
// @ts-nocheck

/**
 * Spike 0024 (#1273). NEVER MERGED. The TSL ports of `three-renderer.ts`'s
 * `onBeforeCompile` patches and `ShaderMaterial`s that the realistic scene
 * needs under `WebGPURenderer`, which runs neither.
 *
 * Each port is called from the top of the function it stands in for, when
 * {@link nodes} is true, and says in its own comment what it leaves out. The
 * write-up's table is this file's comments, counted.
 */

import {
  DoubleSide,
  InstancedInterleavedBuffer,
  DynamicDrawUsage,
  MeshBasicNodeMaterial,
} from 'three/webgpu';
import {
  Discard,
  Fn,
  If,
  Loop,
  abs,
  atan,
  attribute,
  cameraPosition,
  clamp,
  cos,
  cross,
  dFdx,
  dFdy,
  diffuseColor,
  dot,
  exp2,
  float,
  floor,
  fract,
  instanceIndex,
  instancedArray,
  instancedDynamicBufferAttribute,
  int,
  length,
  mat4,
  materialAlphaTest,
  materialColor,
  materialOpacity,
  materialReference,
  materialRoughness,
  max,
  min,
  mix,
  mod,
  modelWorldMatrix,
  modelWorldMatrixInverse,
  normalMap,
  normalViewGeometry,
  normalWorldGeometry,
  normalize,
  positionGeometry,
  positionLocal,
  positionView,
  positionWorld,
  reference,
  screenCoordinate,
  sin,
  smoothstep,
  sqrt,
  step,
  storage,
  texture,
  uniform,
  uniformArray,
  uv,
  varying,
  varyingProperty,
  vec2,
  vec3,
  vec4,
  vertexColor,
} from 'three/tsl';

/** Whether the page draws with `WebGPURenderer` (either backend). Set by `three-shim.ts`. */
export function nodes(): boolean {
  return globalThis.__oylNodes === true;
}

/** Every port that ran, by name, for the write-up's table. */
export const PORTED = new Map();
const ran = (name) => PORTED.set(name, (PORTED.get(name) ?? 0) + 1);
globalThis.__oylPorted = PORTED;

const LUMA = vec3(0.2126, 0.7152, 0.0722);

/** `?debug=a,b`: switches for finding which port is wrong. */
const DEBUG = new Set((new URLSearchParams(globalThis.location?.search ?? '').get('debug') ?? '').split(','));

/**
 * three's `perturbNormal2Arb`, on a UV of our own. `normalMap()` in 0.185.1
 * builds its tangent frame from the geometry's `uv` attribute, and the road
 * and the ground have none: their UV is where they are in the world.
 */
const planarNormal = Fn(([sample, at, scale]) => {
  const mapN = sample.xyz.mul(2).sub(1);
  const q0 = dFdx(positionView);
  const q1 = dFdy(positionView);
  const st0 = dFdx(at);
  const st1 = dFdy(at);
  // The geometry's own normal, never flipped for a back face: `photographicRoadMaterial`
  // takes three's front-face rule out for the same reason (the road is drawn from its back).
  const N = normalize(normalViewGeometry);
  const q1perp = cross(q1, N);
  const q0perp = cross(N, q0);
  const T = q1perp.mul(st0.x).add(q0perp.mul(st1.x));
  const B = q1perp.mul(st0.y).add(q0perp.mul(st1.y));
  const det = max(dot(T, T), dot(B, B));
  const size = det.equal(0).select(0, det.inverseSqrt());
  return normalize(
    T.mul(mapN.x.mul(scale.x).mul(size)).add(B.mul(mapN.y.mul(scale.y).mul(size))).add(N.mul(mapN.z)),
  );
});

// --- the recipe every ported material's diffuse colour is built from ---------

const RECIPES = new WeakMap();

function recipeOf(material) {
  let recipe = RECIPES.get(material);
  if (recipe === undefined) {
    recipe = { colour: undefined, channels: undefined, after: [], alpha: undefined };
    RECIPES.set(material, recipe);
    if (material.isNodeMaterial !== true) {
      throw new Error('spike 0024: a ported material that is not a node material');
    }
    material.setupDiffuseColor = setupDiffuseColor;
  }
  return recipe;
}

/**
 * `NodeMaterial.setupDiffuseColor` (three 0.185.1), with the product's four
 * differences: the base colour may come from a recipe; an instance's colour may
 * be CHANNELS (#621: `x`, `y` the dither's kept band, `z` the tint's code)
 * rather than a colour to multiply by; steps may follow the vertex colour; and
 * a tree's dither discards after the alpha test.
 */
function setupDiffuseColor(builder) {
  const { object, geometry } = builder;
  const recipe = RECIPES.get(this);
  let colour = recipe.colour !== undefined ? vec4(recipe.colour(builder)) : materialColor;
  if (this.vertexColors === true && geometry.hasAttribute('color')) {
    colour = colour.mul(vertexColor());
  }
  const raw = varyingProperty('vec3', 'vInstanceColor');
  const channels = recipe.channels !== undefined && object.instanceColor;
  if (object.instanceColor && !channels) colour = raw.mul(colour);
  diffuseColor.assign(colour);
  if (channels && !DEBUG.has('no-tint')) {
    diffuseColor.rgb.assign(tinted(diffuseColor.rgb, tintOf(raw.z)));
  }
  for (const each of recipe.after) each(builder);
  diffuseColor.a.assign(diffuseColor.a.mul(materialOpacity));
  if (recipe.alpha !== undefined) recipe.alpha(builder);
  if (this.alphaTest > 0) diffuseColor.a.lessThanEqual(materialAlphaTest).discard();
  if (channels && recipe.channels === 'dither' && !DEBUG.has('no-dither')) treeDither(raw.xy);
  if (DEBUG.has('diffuse-red') && recipe.channels === 'dither') diffuseColor.assign(vec4(1, 0, 0, 1));
}

// --- #621: the seeded tint, and #617's dither --------------------------------

let TINT = { zero: 0, steps: 127, hue: 0, saturation: 0, brightness: 0 };

/** `TINT_DECODE_GLSL`. */
const tintOf = Fn(([stored]) => {
  const whole = stored.add(TINT.zero);
  const brightness = floor(whole.div(65536));
  const rest = whole.sub(brightness.mul(65536));
  const saturation = floor(rest.div(256));
  const hue = rest.sub(saturation.mul(256));
  return vec3(hue, saturation, brightness)
    .sub(TINT.steps)
    .div(TINT.steps)
    .mul(vec3(TINT.hue, TINT.saturation, TINT.brightness));
});

/** `TINT_APPLY_GLSL`. */
const tinted = Fn(([colour, tint]) => {
  const turnCos = cos(tint.x);
  const turnSin = sin(tint.x);
  const grey = vec3(0.57735027);
  const turned = colour
    .mul(turnCos)
    .add(cross(grey, colour).mul(turnSin))
    .add(grey.mul(dot(grey, colour)).mul(turnCos.oneMinus()));
  const luminance = dot(turned, LUMA);
  return max(
    vec3(luminance)
      .add(turned.sub(vec3(luminance)).mul(tint.y.add(1)))
      .mul(tint.z.add(1)),
    0,
  );
});

/** `TREE_DITHER_DISCARD`. */
function treeDither(keep) {
  const dither = fract(
    fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715))).mul(52.9829189),
  );
  Discard(
    keep.y.greaterThan(keep.x).and(dither.lessThan(keep.x).or(dither.greaterThanEqual(keep.y))),
  );
}

/** `withInstanceChannels`. Ported whole. */
export function portInstanceChannels(material, dither, codec) {
  ran(dither ? 'instance channels: tint and dither' : 'instance channels: tint');
  TINT = codec;
  recipeOf(material).channels = dither ? 'dither' : 'tint';
}

// --- #639: one material, several layers --------------------------------------

/**
 * `withMaterialLayers`. Ported: the layer attribute, a branch to ONE layer's
 * colour and normal texture with the gradients taken outside it, each layer's
 * colour factor, normal scale and whether it is cut. Left out: #619's LOD bias
 * on the gradients (0 at the rung measured).
 */
export function portMaterialLayers(material, layers, extra) {
  ran('material layers');
  const count = layers.colours.length;
  // The attribute is a Uint32Array: WebGL hands a `float` its value, WebGPU must be told it is a `uint`.
  // ⚠️ The product's attribute is a Uint32Array read by GLSL as a `float`, which WebGL
  // converts. WebGPU does not (the picture was black and white trees), and read as a
  // `uint` it drew on the WebGPU backend and vanished on the WebGL 2 one. So under the
  // spike the attribute is rebuilt as floats (`three-renderer.ts` §`layeredGeometry`).
  const layer = int(varying(attribute('oylLayer', 'float')).add(0.5));
  const colours = uniformArray(layers.colours, 'color');
  const scales = uniformArray(layers.normalScales, 'vec2');
  const cut = uniformArray(
    layers.cut.map((each) => (each ? 1 : 0)),
    'float',
  );
  const sample = (own, others) =>
    Fn(() => {
      const at = uv();
      const dx = dFdx(at);
      const dy = dFdy(at);
      const texel = vec4(0).toVar();
      let chain;
      for (let index = 1; index < count; index += 1) {
        const map = others[index - 1];
        const body = () => {
          texel.assign(texture(map, at).grad(dx, dy));
        };
        chain = chain === undefined ? If(layer.equal(index), body) : chain.ElseIf(layer.equal(index), body);
      }
      const last = () => {
        texel.assign(texture(own, at).grad(dx, dy));
      };
      if (chain === undefined) last();
      else chain.Else(last);
      return texel;
    })();
  const colourMaps = [];
  const normalMaps = [];
  for (let index = 1; index < count; index += 1) {
    colourMaps.push(extra[2 * (index - 1)]);
    normalMaps.push(extra[2 * (index - 1) + 1]);
  }
  const recipe = recipeOf(material);
  recipe.colour = () => {
    const texel = sample(material.map, colourMaps);
    const tint = materialReference('color', 'color');
    if (DEBUG.has('layer-flat')) return vec4(0.2, 0.5, 0.2, texel.a);
    if (DEBUG.has('layer-texel')) return vec4(texel.rgb, texel.a);
    if (DEBUG.has('layer-nocolours')) return vec4(texel.rgb.mul(tint), texel.a);
    return vec4(
      texel.rgb.mul(tint).mul(colours.element(layer)),
      mix(1, texel.a, step(0.5, cut.element(layer))),
    );
  };
  if (DEBUG.has('geometry-normal')) material.normalNode = normalize(normalViewGeometry);
  else if (!DEBUG.has('no-layer-normal')) material.normalNode = normalMap(sample(material.normalMap, normalMaps), scales.element(layer));
}

// --- #630: the breeze ---------------------------------------------------------

const WIND = {
  time: uniform(0),
  direction: uniform(vec2(0, 1)),
  scale: uniform(1),
};
let WAVES = [];

/** `oylSwayWave`. */
const swayWave = (phase) => {
  let sum = float(0);
  for (const [rate, weight, phases] of WAVES) {
    sum = sum.add(sin(WIND.time.mul(rate).add(phase.mul(phases))).mul(weight));
  }
  return sum.mul(WIND.scale);
};

/** `oylSwayPhase`. */
const swayPhase = (place) =>
  fract(sin(dot(floor(place.mul(10)), vec2(12.9898, 78.233))).mul(43758.5453)).mul(6.2831853);

/** What `three-renderer.ts` writes into `FOLIAGE` each frame, copied to the nodes' uniforms. */
export function syncWind(foliage, waves) {
  WAVES = waves;
  WIND.time.value = foliage.oylWindTime.value;
  WIND.direction.value.copy(foliage.oylWindDirection.value);
  WIND.scale.value = foliage.oylSwayScale.value;
  SUN.toward.value.copy(foliage.oylSunToward.value);
  SUN.ambient.value = foliage.oylSunAmbient.value;
  SUN.direct.value = foliage.oylSunDirect.value;
  SUN.lit.value = foliage.oylImpostorLit.value;
}

/** Spike 0024's optional layer: the sway comes from a storage buffer a compute pass wrote. */
export const COMPUTED_WIND = { node: undefined };

const WIND_BINS = 4096;

/**
 * The optional compute-driven wind. One compute pass a frame writes the
 * breeze's wave for {@link WIND_BINS} phases into a storage buffer; a near
 * tree's vertex shader then reads its phase's bin where the product's shader
 * works three sines out per vertex. Returns the pass, for `renderer.compute`.
 */
export function computedWind() {
  const waves = instancedArray(WIND_BINS, 'float');
  const pass = Fn(() => {
    const phase = float(instanceIndex).div(WIND_BINS).mul(6.2831853);
    waves.element(instanceIndex).assign(swayWave(phase));
  })().compute(WIND_BINS);
  // A second node on the same buffer: `toReadOnly()` changes the node it is called on.
  const read = storage(waves.value, 'float', WIND_BINS).toReadOnly();
  COMPUTED_WIND.node = (phase) =>
    read.element(int(clamp(phase.div(6.2831853).mul(WIND_BINS), 0, WIND_BINS - 1)));
  return pass;
}

/**
 * `withFoliageSwayOf`. Ported: the push along the wind, growing with the
 * square of the height, less on wood than on leaves. ⚠️ **One difference**: the
 * tree's phase is seeded from its tint code (the instance colour's `z`, stable
 * per tree) rather than from where it stands, because the instance matrix is
 * not a node three 0.185.1 hands a material.
 */
export function portFoliageSway(material, height, weights, swayMetres, waves) {
  ran('foliage sway');
  WAVES = waves;
  const weight =
    weights.length > 1
      ? uniformArray(weights, 'float').element(int(attribute('oylLayer', 'float').add(0.5)))
      : float(weights[0]);
  if (DEBUG.has('no-sway')) return;
  material.positionNode = Fn((_, builder) => {
    if (!builder.object.isInstancedMesh) return positionLocal;
    const code = varyingProperty('vec3', 'vInstanceColor').z;
    const phase = fract(sin(code.mul(12.9898)).mul(43758.5453)).mul(6.2831853);
    const rise = clamp(positionGeometry.y.div(height), 0, 1);
    const wave =
      COMPUTED_WIND.node !== undefined ? COMPUTED_WIND.node(phase) : swayWave(phase);
    const push = WIND.direction.mul(wave.mul(swayMetres).mul(rise).mul(rise).mul(weight));
    // Already instanced, so already in the model's frame: the push is added as it is.
    return positionLocal.add(vec3(push.x, 0, push.y));
  })();
}

// --- the photographic road -----------------------------------------------------

/** `DETAIL_COMMON`. */
const hash = Fn(([p_]) => {
  const p = fract(p_.mul(vec2(123.34, 456.21))).toVar();
  p.addAssign(dot(p, p.add(45.32)));
  return fract(p.x.mul(p.y));
});
const noise = Fn(([p]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  return mix(
    mix(hash(i), hash(i.add(vec2(1, 0))), u.x),
    mix(hash(i.add(vec2(0, 1))), hash(i.add(vec2(1, 1))), u.x),
    u.y,
  );
});

/**
 * `photographicRoadMaterial`. Ported: the world-planar UV, the photograph as
 * grain on the vertex colour (its luminance over its own mean, clamped), the
 * normal map, #628's wear (wheel tracks, verge dust, the eight patches, faded
 * paint) and the tracks' smoother roughness. Left out: the tracks' flattened
 * normal, the 0.25 sheen, and the front-face rule for the normal.
 */
export function portRoad(material, c) {
  ran('photographic road');
  const planar = positionWorld.xz.div(c.tileMetres);
  const patches = uniformArray(
    Array.from({ length: c.maximumPatches * 2 }, () => ({ x: 0, y: 0, z: 0, w: 0, isVector4: true })),
    'vec4',
  );
  const on = uniform(1);
  const colourOn = uniform(1);
  const across = varying(attribute('oylAcross', 'float'));
  const trackOf = () => {
    let track = float(0);
    for (const offset of c.trackOffsets) {
      track = max(
        track,
        smoothstep(c.trackHalfWidth, c.trackHalfWidth + c.trackEdge, abs(across.sub(offset))).oneMinus(),
      );
    }
    return track.mul(on);
  };
  const paintOf = () => smoothstep(0.35, 0.55, dot(vertexColor().rgb, LUMA));
  const recipe = recipeOf(material);
  recipe.colour = () => {
    const texel = dot(texture(material.map, planar).rgb, LUMA);
    const mean = max(dot(texture(material.map, vec2(0.5)).level(16).rgb, LUMA), 1e-3);
    const tint = materialReference('color', 'color');
    return vec4(tint.mul(clamp(texel.div(mean), 1 - c.grain, 1 + c.grain)), 1);
  };
  recipe.after.push(() => {
    const world = positionWorld.xz;
    const worn = trackOf().mul(c.trackLighten).toVar();
    worn.addAssign(
      on.mul(c.dustLighten).mul(smoothstep(c.carriagewayHalf - c.dustBand, c.carriagewayHalf, abs(across))),
    );
    Loop(c.maximumPatches, ({ i }) => {
      const place = patches.element(i.mul(2));
      const size = patches.element(i.mul(2).add(1));
      const from = world.sub(place.xy);
      const along = abs(dot(from, place.zw));
      const over = abs(dot(from, vec2(place.w.negate(), place.z)));
      const inside = smoothstep(size.x.sub(0.08), size.x, along)
        .oneMinus()
        .mul(smoothstep(size.y.sub(0.08), size.y, over).oneMinus());
      worn.addAssign(size.z.mul(inside).mul(step(0.0001, size.x)).mul(on));
    });
    const carriageway = colourOn.mul(clamp(worn, -c.maximumWear, c.maximumWear)).add(1);
    const paint = paintOf();
    const faded = float(1).sub(
      on
        .mul(colourOn)
        .mul(c.paintWear)
        .mul(smoothstep(0.35, 0.85, noise(world.mul(0.13)).mul(0.7).add(noise(world.mul(1.7)).mul(0.3)))),
    );
    diffuseColor.rgb.mulAssign(mix(carriageway, faded, paint));
  });
  material.normalNode = planarNormal(texture(material.normalMap, planar), planar, vec2(material.normalScale.x, material.normalScale.y));
  material.roughnessNode = Fn(() =>
    materialRoughness.mul(mix(1, c.trackRoughness, trackOf().mul(paintOf().oneMinus()))),
  )();
  // The belt writes its patches into `wear.patches`; they reach the uniform each frame.
  material.onBeforeRender = () => {
    on.value = c.wear.on;
    colourOn.value = c.wear.colour;
    const array = patches.array;
    for (let index = 0; index < array.length; index += 1) {
      const each = array[index];
      each.x = c.wear.patches[index * 4];
      each.y = c.wear.patches[index * 4 + 1];
      each.z = c.wear.patches[index * 4 + 2];
      each.w = c.wear.patches[index * 4 + 3];
    }
  };
  return { patches, on, colourOn };
}

// --- the photographic ground ---------------------------------------------------

/**
 * `photographicGroundMaterial`. Ported: the world-planar UV, the photograph
 * over its own mean with the second, larger sample in the distance, and #624's
 * blend to the verge beside the road and to rock on a steep slope or above the
 * tree line, colour and normal, each sampled only where its share is above
 * zero. Left out: #619's LOD bias on the gradients (0 at the rung measured).
 * The field pattern is not drawn by the product on this material either.
 */
export function portGround(material, c) {
  ran('photographic ground');
  const planar = positionWorld.xz.div(c.tileMetres);
  const blended = c.verge !== undefined && c.rock !== undefined;
  const shares = uniform(c.shares);
  const treeLine = reference('value', 'float', c.treeLine);
  const fields = varying(attribute('fields', 'vec2'));
  const groundUp = varying(normalWorldGeometry.y);
  const vergeUv = positionWorld.xz.div(c.vergeTile);
  const rockUv = positionWorld.xz.div(c.rockTile);
  const sharesOf = () => {
    const fromEdge = abs(fields.y).sub(c.roadEdge);
    const verge = smoothstep(c.vergeBlend[0], c.vergeBlend[1], fromEdge).oneMinus().mul(shares.x);
    const rock = smoothstep(c.rockCos[1], c.rockCos[0], groundUp).oneMinus().mul(shares.y);
    const scree = smoothstep(treeLine.sub(c.screeBand), treeLine.add(c.screeBand), positionWorld.y).mul(shares.z);
    const rockShare = max(rock, scree);
    return { rockShare, vergeShare: verge.mul(rockShare.oneMinus()) };
  };
  const recipe = recipeOf(material);
  const tint = materialReference('color', 'color');
  recipe.colour = () => {
    const near = texture(material.map, planar).rgb;
    const far = texture(material.map, planar.mul(0.111).add(vec2(0.37, 0.61))).rgb;
    const farShare = smoothstep(8, 120, positionView.z.negate());
    const texel = mix(near, mix(near, far, 0.5).mul(0.55).add(far.mul(0.45)), farShare);
    const mean = max(texture(material.map, vec2(0.5)).level(16).rgb, vec3(1e-3));
    return vec4(tint.mul(texel.div(mean)), 1);
  };
  if (blended) {
    recipe.after.push(() => {
      const { rockShare, vergeShare } = sharesOf();
      const vergeTexel = vec3(1).toVar();
      const rockTexel = vec3(1).toVar();
      const vergeDx = dFdx(vergeUv);
      const vergeDy = dFdy(vergeUv);
      const rockDx = dFdx(rockUv);
      const rockDy = dFdy(rockUv);
      If(vergeShare.greaterThan(0), () => {
        vergeTexel.assign(
          texture(c.verge.colour, vergeUv)
            .grad(vergeDx, vergeDy)
            .rgb.div(max(texture(c.verge.colour, vec2(0.5)).level(16).rgb, vec3(1e-3))),
        );
      });
      If(rockShare.greaterThan(0), () => {
        rockTexel.assign(
          texture(c.rock.colour, rockUv)
            .grad(rockDx, rockDy)
            .rgb.div(max(texture(c.rock.colour, vec2(0.5)).level(16).rgb, vec3(1e-3))),
        );
      });
      const other = vergeShare.add(rockShare);
      const surfaces = tint
        .mul(vertexColor().rgb)
        .mul(vergeTexel.mul(vergeShare).add(rockTexel.mul(rockShare)));
      diffuseColor.rgb.assign(diffuseColor.rgb.mul(other.oneMinus()).add(surfaces));
    });
  }
  material.normalNode = planarNormal(
    Fn(() => {
      const texel = texture(material.normalMap, planar).xyz.toVar();
      if (blended) {
        const { rockShare, vergeShare } = sharesOf();
        const vergeDx = dFdx(vergeUv);
        const vergeDy = dFdy(vergeUv);
        const rockDx = dFdx(rockUv);
        const rockDy = dFdy(rockUv);
        If(vergeShare.greaterThan(0), () => {
          texel.assign(mix(texel, texture(c.verge.normal, vergeUv).grad(vergeDx, vergeDy).xyz, vergeShare));
        });
        If(rockShare.greaterThan(0), () => {
          texel.assign(mix(texel, texture(c.rock.normal, rockUv).grad(rockDx, rockDy).xyz, rockShare));
        });
      }
      return vec4(texel, 1);
    })(),
    planar,
    vec2(material.normalScale.x, material.normalScale.y),
  );
}

// --- #623: the rider's kit ---------------------------------------------------------

/** `riderBodyMaterial`'s patch. Ported whole. */
export function portRiderKit(material, kit, plain, mean) {
  ran('rider kit colour');
  material.oylKit = kit;
  material.oylPlain = plain;
  const recipe = recipeOf(material);
  recipe.colour = () => {
    // Through the MATERIAL, not the object: five riders' materials build one program, and
    // a `reference` to one rider's kit object dressed all five in it (the pacer rode in green).
    const diffuse = materialReference('color', 'color');
    const kitColour = materialReference('oylKit.value', 'color');
    const kitPlain = materialReference('oylPlain.value', 'float');
    const texel = texture(material.map, uv());
    const masked = diffuse
      .mul(texel.rgb)
      .add(diffuse.mul(kitColour).mul(texture(material.roughnessMap, uv()).b));
    const flat = diffuse.mul(vec3(...mean.unmasked).add(kitColour.mul(mean.shade)));
    return vec4(mix(masked, flat, kitPlain), texel.a);
  };
}

// --- #620: the ground blob ---------------------------------------------------------

/**
 * `withGroundBlobShading`. Ported: the round falloff and the instance's
 * strength. Left out: the two clip lines that stop a blob at a bridge's edge
 * (they need the instance matrix; see {@link portFoliageSway}).
 */
export function portGroundBlob(material, darkness, core) {
  ran('ground blob');
  const recipe = recipeOf(material);
  recipe.alpha = () => {
    const local = varying(positionGeometry.xz);
    const strength = varying(attribute('blobStrength', 'float'));
    const alpha = strength.mul(darkness).mul(smoothstep(core, 1, length(local)).oneMinus());
    Discard(alpha.lessThanEqual(0));
    diffuseColor.a.mulAssign(alpha);
  };
}

// --- #617, #630: the far trees' impostors ----------------------------------------------

const SUN = {
  toward: uniform(vec3(0, 1, 0)),
  ambient: uniform(0.5),
  direct: uniform(0.5),
  lit: uniform(1),
};

const INSTANCE_MATRICES = new WeakMap();
const TRACKED = new Set();

/**
 * The instance matrix as a node of our own, built as three 0.185.1 builds its
 * own (`InstanceNode`'s attribute path), because three does not hand it to a
 * material. ⚠️ So an impostor mesh's matrices are uploaded twice a frame.
 */
const instanceMatrixNode = Fn((_, builder) => {
  const matrices = builder.object.instanceMatrix;
  let buffer = INSTANCE_MATRICES.get(matrices);
  if (buffer === undefined) {
    buffer = new InstancedInterleavedBuffer(matrices.array, 16, 1);
    buffer.setUsage(DynamicDrawUsage);
    INSTANCE_MATRICES.set(matrices, buffer);
    TRACKED.add({ matrices, buffer });
  }
  return mat4(
    instancedDynamicBufferAttribute(buffer, 'vec4', 16, 0),
    instancedDynamicBufferAttribute(buffer, 'vec4', 16, 4),
    instancedDynamicBufferAttribute(buffer, 'vec4', 16, 8),
    instancedDynamicBufferAttribute(buffer, 'vec4', 16, 12),
  );
});

/** Keeps our copies of the instance matrices as fresh as three keeps its own. Once a frame. */
export function syncInstanceMatrices() {
  for (const { matrices, buffer } of TRACKED) {
    if (buffer.array !== matrices.array) continue;
    if (buffer.version !== matrices.version) buffer.version = matrices.version;
  }
}

/**
 * `impostorMaterial`, a `ShaderMaterial` in the product. Ported: the frame of
 * the strip chosen from where the camera stands round the tree, the quad
 * turned to face it, the breeze, the alpha cut, the dither, #630's relighting
 * from the strip's normals and the crown's own, and #621's tint. Fog is
 * three's own rather than #622's air.
 */
export function portImpostor(strip, normals, c) {
  ran('impostor strip');
  const material = new MeshBasicNodeMaterial({ side: DoubleSide });
  material.fog = true;
  const quadY = positionGeometry.y.mul(c.quadH).add(c.quadBottom);
  // Everything the fragment needs of the instance, worked out once in the vertex stage.
  const setup = () => {
    const matrix = instanceMatrixNode();
    const centre = modelWorldMatrix.mul(matrix).mul(vec4(0, 0, 0, 1)).xyz;
    const across = matrix.mul(vec4(1, 0, 0, 0)).xyz;
    const along = matrix.mul(vec4(0, 0, 1, 0)).xyz;
    const size = length(across);
    const toCamera = cameraPosition.sub(centre);
    const facing = normalize(toCamera.xz.add(vec2(1e-5)));
    const localX = dot(toCamera.xz, across.xz.div(size));
    const localZ = dot(toCamera.xz, along.xz.div(size));
    const frame = mod(floor(atan(localX, localZ).div(2 * Math.PI).mul(c.frames).add(0.5)), c.frames);
    return { centre, across, along, size, facing, frame };
  };
  material.positionNode = Fn(() => {
    const { centre, size, facing } = setup();
    const right = vec3(facing.y, 0, facing.x.negate());
    const world = centre
      .add(right.mul(positionGeometry.x).mul(c.quadW).mul(size))
      .add(vec3(0, quadY, 0).mul(size))
      .toVar();
    const rise = clamp(quadY.div(c.treeHeight), 0, 1);
    world.xz.addAssign(
      WIND.direction.mul(swayWave(swayPhase(centre.xz)).mul(c.swayMetres).mul(rise).mul(rise)),
    );
    return modelWorldMatrixInverse.mul(vec4(world, 1)).xyz;
  })();
  // Through the recipe, not `colorNode`: three multiplies an instance's colour into a
  // `colorNode`, and here that colour is the dither's band and the tint's code.
  const recipe = recipeOf(material);
  recipe.channels = 'dither';
  recipe.colour = () => {
    const { across, along, facing, frame } = setup();
    const stripUv = varying(vec2(frame.add(uv().x).div(c.frames), uv().y));
    const texel = texture(strip, stripUv).toVar();
    Discard(texel.a.lessThan(c.alphaCutoff));
    if (normals !== undefined && !DEBUG.has('no-impostor-relight')) {
      const acrossXZ = varying(normalize(across.xz.add(vec2(1e-6, 0))));
      const alongXZ = varying(normalize(along.xz.add(vec2(0, 1e-6))));
      const facingXZ = varying(facing);
      const crown = varying(
        vec2(
          positionGeometry.x.mul(2 * c.quadW).div(c.treeWidth),
          quadY.div(c.treeHeight).mul(2).sub(1),
        ),
      );
      const local = texture(normals, stripUv).xyz.mul(2).sub(1);
      If(dot(local, local).greaterThan(0.0025), () => {
        const acrossW = vec3(acrossXZ.x, 0, acrossXZ.y);
        const alongW = vec3(alongXZ.x, 0, alongXZ.y);
        const bakedW = acrossW.mul(local.x).add(vec3(0, local.y, 0)).add(alongW.mul(local.z));
        const right = vec3(facingXZ.y, 0, facingXZ.x.negate());
        const toward = vec3(facingXZ.x, 0, facingXZ.y);
        const on = clamp(crown, -1, 1);
        const crownW = right
          .mul(on.x)
          .add(vec3(0, on.y, 0))
          .add(toward.mul(sqrt(max(float(1).sub(dot(on, on)), 0))));
        const world = normalize(mix(bakedW, crownW, c.crownShare).add(vec3(0, 1e-4, 0)));
        const inPlant = vec3(dot(world, acrossW), world.y, dot(world, alongW));
        const under = SUN.ambient
          .add(SUN.direct.mul(max(dot(world, SUN.toward), 0)))
          .div(max(SUN.ambient.add(SUN.direct.mul(0.5)), 1e-4));
        const baked = max(dot(inPlant, vec3(...c.scriptSun)), 0)
          .add(c.scriptSkyShare)
          .div(c.scriptSkyShare + 0.5);
        const relit = clamp(under.div(baked), c.relightRange[0], c.relightRange[1]);
        texel.rgb.mulAssign(mix(1, relit, SUN.lit));
      });
    }
    return vec4(texel.rgb, 1);
  };
  // `drawOrder` reads `uniforms.strip` to know a cut piece; the belt reads nothing else.
  material.uniforms = { strip: { value: strip }, stripNormals: { value: normals ?? null } };
  return material;
}

// --- #426: the rider's thrown silhouette ---------------------------------------------

/**
 * `RiderSilhouetteBelt`'s material, a `ShaderMaterial` in the product. Ported
 * whole: the quad stretched to hold the thrown shape, and the 32 taps up the
 * sun's ray through the silhouette texture.
 */
export function portSilhouette(silhouette, bounds, darkness, c) {
  ran('rider silhouette shadow');
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
  material.fog = false;
  const box = uniform(bounds);
  const thrown = attribute('oylThrow', 'vec2');
  const ground = () => {
    const topAcross = box.z.mul(thrown.x);
    const topAlong = box.z.mul(thrown.y);
    const edge = box.w.add(c.margin);
    const across = mix(min(0, topAcross).sub(edge), max(0, topAcross).add(edge), positionGeometry.x);
    const along = mix(
      box.x.add(min(0, topAlong)).sub(c.margin),
      box.y.add(max(0, topAlong)).add(c.margin),
      positionGeometry.z,
    );
    return vec2(across, along);
  };
  material.positionNode = Fn(() => {
    const at = ground();
    return instanceMatrixNode().mul(vec4(at.x, 0, at.y, 1)).xyz;
  })();
  material.colorNode = vec3(0);
  material.opacityNode = Fn(() => {
    const at = varying(ground());
    const sun = varying(thrown);
    const height = box.z;
    const reach = box.w;
    const low = float(0).toVar();
    const high = float(height).toVar();
    If(abs(sun.x).greaterThan(1e-4), () => {
      const a = at.x.sub(reach).div(sun.x);
      const b = at.x.add(reach).div(sun.x);
      low.assign(max(0, min(a, b)));
      high.assign(min(height, max(a, b)));
    });
    Discard(high.lessThan(low));
    const cover = float(0).toVar();
    Loop(c.taps, ({ i }) => {
      const y = low.add(high.sub(low).mul(float(i).add(0.5)).div(c.taps));
      const z = at.y.sub(y.mul(sun.y));
      const x = abs(at.x.sub(y.mul(sun.x)));
      const where = vec2(z.sub(box.x).div(box.y.sub(box.x)), y.div(height));
      const inside01 = where.x
        .greaterThanEqual(0)
        .and(where.x.lessThan(1))
        .and(where.y.greaterThanEqual(0))
        .and(where.y.lessThan(1));
      If(inside01, () => {
        const texel = texture(silhouette, where).level(0).rg;
        const edge = texel.g.mul(reach);
        const inside = smoothstep(edge.sub(c.edge), edge.add(c.edge), x).oneMinus();
        cover.assign(max(cover, texel.r.mul(inside)));
      });
    });
    Discard(cover.lessThanEqual(0));
    return reference('value', 'float', darkness).mul(cover);
  })();
  return material;
}
