// SPDX-License-Identifier: AGPL-3.0-or-later
/** Spike 0024: no layers on `WebGLRenderer`. NEVER MERGED. */
export interface LayerSwitches {
  readonly traa: boolean;
  readonly ao: boolean;
  readonly wind: boolean;
}
export interface Layers {
  beforeFrame(elapsedSeconds: number): void;
}
export async function installLayers(): Promise<Layers> {
  return { beforeFrame: () => undefined };
}
