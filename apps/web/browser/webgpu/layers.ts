// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable -- spike 0024 (#1273): never merged, and three's TSL is typed loosely */
// @ts-nocheck

/**
 * Spike 0024 (#1273). NEVER MERGED. The three optional layers, each behind its
 * own switch, all three's own parts from the installed 0.185.1:
 *
 * - `?traa=1`: temporal anti-aliasing, `TRAANode`, from the scene pass's
 *   colour, depth and a velocity target;
 * - `?ao=1`: screen-space ambient occlusion, `GTAONode` at HALF resolution, 16
 *   samples, multiplied into the scene's colour before tone mapping;
 * - `?wind=1`: the breeze's wave, worked out once a frame by a COMPUTE pass
 *   into a storage buffer the near trees' vertex shader reads, in place of
 *   three sines a vertex.
 *
 * The first two need a render pipeline, so the view's one `renderer.render`
 * is caught and the pipeline drawn in its place.
 */

import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { mrt, normalView, output, pass, vec3, vec4, velocity } from 'three/tsl';
import { RenderPipeline } from 'three/webgpu';

import { computedWind } from '../../src/game/spike-0024-nodes';

export interface LayerSwitches {
  readonly traa: boolean;
  readonly ao: boolean;
  readonly wind: boolean;
}

export interface Layers {
  beforeFrame(elapsedSeconds: number): void;
}

export async function installLayers(
  renderer,
  switches: LayerSwitches,
  _fail: (message: string) => void,
): Promise<Layers> {
  const wind = switches.wind ? computedWind() : undefined;
  if (switches.traa || switches.ao) {
    const direct = renderer.render.bind(renderer);
    let pipeline;
    let inside = false;
    renderer.render = (scene, camera) => {
      if (inside || scene.isScene !== true || !scene.fog) return direct(scene, camera);
      if (pipeline === undefined) {
        pipeline = new RenderPipeline(renderer);
        const scenePass = pass(scene, camera);
        const targets = { output };
        if (switches.traa) targets.velocity = velocity;
        if (switches.ao) targets.normal = normalView;
        scenePass.setMRT(mrt(targets));
        let colour = scenePass.getTextureNode('output');
        const depth = scenePass.getTextureNode('depth');
        if (switches.ao) {
          const occlusion = ao(depth, scenePass.getTextureNode('normal'), camera);
          occlusion.resolutionScale = 0.5;
          colour = colour.mul(vec4(vec3(occlusion.getTextureNode().r), 1));
        }
        if (switches.traa) {
          colour = traa(colour, depth, scenePass.getTextureNode('velocity'), camera);
        }
        pipeline.outputNode = colour;
      }
      inside = true;
      try {
        pipeline.render();
      } finally {
        inside = false;
      }
    };
  }
  return {
    beforeFrame: () => {
      if (wind !== undefined) renderer.compute(wind);
    },
  };
}
