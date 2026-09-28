// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What a general vision model on the rider's computer actually answered** —
 * the saved answers behind [spike 0016](../../../../docs/spikes/0016-live-in-ride-coaching.md)
 * §5.4, verbatim, and a second run with #761's question. Test support, never
 * shipped (the `-testing.ts` suffix).
 *
 * Every answer is `gemma3:4b` under Ollama on the spike's M4 Pro Mac, through
 * the product's exact request (`analysis-transport.ts` §`analysisRequestBody`),
 * over the spike's three 256 × 192 pictures: a drawn side-view rider, a blank
 * picture and blurred noise (spike 0016 §5.2). The transport sends no
 * `temperature`, so a re-run does not reproduce any answer; these are the
 * answers that were given, and nothing here was edited, including the two
 * whose JSON does not close.
 *
 * - `SPIKE_0016_*` — the `side-pose` question as #553 shipped it, which
 *   opened *"This picture shows a person riding a bicycle…"*. Saved by the
 *   spike's `roundtrip.py` on 2026-09-28.
 * - `ISSUE_761_*` — #761's question (`analysis-port.ts` §`ANALYSIS_PROMPTS`),
 *   the same model, pictures and request, seven answers each, 2026-09-28.
 */

/** Six answers about the blank picture, to #553’s question. */
export const SPIKE_0016_BLANK_ANSWERS: readonly string[] = [
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":null,"shoulder":null,"elbow":null,"wrist":null,"hip":null,"knee":null,"ankle":null,"heel":null,"toe":null}}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":null,"shoulder":null,"elbow":null,"wrist":null,"hip":null,"knee":null,"ankle":null,"heel":null,"toe":null}}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":null,"shoulder":[0.45,0.6],"elbow":[0.52,0.7],"wrist":[0.58,0.82],"hip":[0.35,0.65],"knee":[0.42,0.78],"ankle":[0.48,0.91],"heel":[0.53,0.96],"toe":[0.58,1.0}}\n```',
  '```json\n{\n  "rider": true,\n  "nearSide": "left",\n  "landmarks": {\n    "ear": null,\n    "shoulder": [\n      0.3,\n      0.45\n    ],\n    "elbow": [\n      0.55,\n      0.6\n    ],\n    "wrist": [\n      0.7,\n      0.7\n    ],\n    "hip": [\n      0.2,\n      0.3\n    ],\n    "knee": [\n      0.45,\n      0.4\n    ],\n    "ankle": [\n      0.65,\n      0.25\n    ],\n    "heel": [\n      0.8,\n      0.15\n    ],\n    "toe": [\n      0.9,\n      0.1\n    ]\n  }\n}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":null,"shoulder":null,"elbow":null,"wrist":null,"hip":null,"knee":null,"ankle":null,"heel":null,"toe":null}}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":null,"shoulder":null,"elbow":null,"wrist":null,"hip":null,"knee":null,"ankle":null,"heel":null,"toe":null}}\n```',
];

/** Six answers about the noise picture, to #553’s question. */
export const SPIKE_0016_NOISE_ANSWERS: readonly string[] = [
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":null,"shoulder":[0.48,0.52],"elbow":[0.61,0.48],"wrist":[0.73,0.45],"hip":[0.33,0.35],"knee":[0.48,0.32],"ankle":[0.62,0.29],"heel":[0.76,0.24],"toe":[0.89,0.17]}}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":null,"shoulder":[0.45,0.36],"elbow":[0.52,0.48],"wrist":[0.59,0.61],"hip":[0.28,0.25],"knee":[0.32,0.37],"ankle":[0.08,0.25],"heel":[0.02,0.3],"toe":null}}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":null,"shoulder":null,"elbow":null,"wrist":null,"hip":null,"knee":null,"ankle":null,"heel":null,"toe":null}}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":null,"shoulder":[0.52,0.48],"elbow":[0.57,0.61],"wrist":[0.63,0.72],"hip":[0.38,0.33],"knee":[0.42,0.48],"ankle":[0.45,0.63],"heel":[0.48,0.72],"toe":[0.52,0.82]}}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":null,"shoulder":[0.52,0.47],"elbow":[0.58,0.39],"wrist":[0.62,0.33],"hip":[0.41,0.36],"knee":[0.47,0.27],"ankle":[0.51,0.21],"heel":[0.54, 0.18],"toe":[0.58, 0.15]}}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":null,"shoulder":null,"elbow":null,"wrist":null,"hip":null,"knee":null,"ankle":null,"heel":null,"toe":null}}\n```',
];

/** Twenty-one answers about the drawn rider, to #553’s question. */
export const SPIKE_0016_RIDER_ANSWERS: readonly string[] = [
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":[0.35,0.48],"shoulder":[0.35,0.65],"elbow":[0.52,0.72],"wrist":[0.65,0.79],"hip":[0.17,0.30],"knee":[0.32,0.42],"ankle":[0.45,0.48],"heel":[0.55,0.60],"toe":[0.72,0.7]}\n```',
  '```json\n{\n  "rider": true,\n  "nearSide": "left",\n  "landmarks": {\n    "ear": [0.35, 0.48],\n    "shoulder": [0.36, 0.71],\n    "elbow": [0.58, 0.70],\n    "wrist": [0.72, 0.70],\n    "hip": [0.30, 0.34],\n    "knee": [0.49, 0.31],\n    "ankle": [0.65, 0.30],\n    "heel": [0.78, 0.29],\n    "toe": [0.92, 0.29]\n  }\n}\n```',
  '```json\n{\n  "rider": true,\n  "nearSide": "left",\n  "landmarks": {\n    "ear": [0.35, 0.6],\n    "shoulder": [0.38, 0.74],\n    "elbow": [0.52, 0.78],\n    "wrist": [0.68, 0.75],\n    "hip": [0.18, 0.32],\n    "knee": [0.3, 0.45],\n    "ankle": [0.38, 0.59],\n    "heel": [0.41, 0.67],\n    "toe": null\n  }\n}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":[0.32,0.49],"shoulder":[0.38,0.65],"elbow":[0.57,0.81],"wrist":[0.67,0.94],"hip":[0.14,0.33],"knee":[0.25,0.54],"ankle":[0.36,0.68],"heel":[0.46,0.82],"toe":[0.55,0.97]}}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":[0.48,0.35],"shoulder":[0.48,0.67],"elbow":[0.21,0.65],"wrist":[0.14,0.72],"hip":[0.59,0.40],"knee":[0.59,0.20],"ankle":[0.53,0.14],"heel":[0.52,0.11],"toe":[0.51,0.08]}}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":[0.54,0.39],"shoulder":[0.54,0.27],"elbow":[0.31,0.28],"wrist":[0.26,0.30],"hip":[0.31,0.1],"knee":[0.48,0.13],"ankle":[0.54,0.13],"heel":[0.59,0.14],"toe":[0.71,0.16]}}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":[0.36,0.48],"shoulder":[0.36,0.61],"elbow":[0.52,0.67],"wrist":[0.63,0.69],"hip":[0.22,0.3],"knee":[0.27,0.38],"ankle":[0.34,0.41],"heel":[0.40,0.41],"toe":[0.50,0.39]}}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":[0.38,0.45],"shoulder":[0.38,0.62],"elbow":[0.71,0.62],"wrist":[0.89,0.62],"hip":[0.36,0.08],"knee":[0.55,0.08],"ankle":[0.73,0.08],"heel":[0.84,0.08],"toe":[0.94,0.08]}}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":[0.38,0.45],"shoulder":[0.36,0.61],"elbow":[0.23,0.71],"wrist":[0.19,0.82],"hip":[0.34,0.32],"knee":[0.31,0.48],"ankle":[0.24,0.64],"heel":[0.21,0.75],"toe":[0.17,0.87]}}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":[0.35,0.42],"shoulder":[0.35,0.68],"elbow":[0.47,0.68],"wrist":[0.58,0.61],"hip":[0.3,0.3],"knee":[0.42,0.3],"ankle":[0.5,0.22],"heel":[0.56,0.22],"toe":[0.6,0.2]]}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":[0.35,0.4],"shoulder":[0.25,0.65],"elbow":[0.15,0.75],"wrist":[0.1,0.85],"hip":[0.4,0.3],"knee":[0.3,0.5],"ankle":[0.25,0.6],"heel":[0.2,0.7],"toe":[0.15,0.8]]}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":[0.35,0.48],"shoulder":[0.35,0.67],"elbow":[0.51,0.63],"wrist":[0.62,0.65],"hip":[0.17,0.39],"knee":[0.30,0.42],"ankle":[0.38,0.40],"heel":[0.43,0.36],"toe":[0.48,0.34]}}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":[0.35,0.48],"shoulder":[0.35,0.69],"elbow":[0.47,0.71],"wrist":[0.62,0.71],"hip":[0.21,0.35],"knee":[0.21,0.55],"ankle":[0.21,0.68],"heel":[0.21,0.82],"toe":[0.21,0.98]}}\n```',
  '```json\n{\n  "rider": true,\n  "nearSide": "left",\n  "landmarks": {\n    "ear": [\n      0.35,\n      0.48\n    ],\n    "shoulder": [\n      0.35,\n      0.26\n    ],\n    "elbow": [\n      0.51,\n      0.27\n    ],\n    "wrist": [\n      0.60,\n      0.28\n    ],\n    "hip": [\n      0.35,\n      0.16\n    ],\n    "knee": [\n      0.48,\n      0.17\n    ],\n    "ankle": [\n      0.61,\n      0.19\n    ],\n    "heel": [\n      0.67,\n      0.19\n    ],\n    "toe": null\n  }\n}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":[0.35,0.4],"shoulder":[0.35,0.6],"elbow":[0.2,0.8],"wrist":[0.1,0.95],"hip":[0.4,0.3],"knee":[0.4,0.7],"ankle":[0.3,0.9],"heel":[0.25,0.95],"toe":[0.2,1.0]}}\n```',
  '```json\n{\n  "rider": true,\n  "nearSide": "left",\n  "landmarks": {\n    "ear": [0.32, 0.51],\n    "shoulder": [0.37, 0.64],\n    "elbow": [0.58, 0.68],\n    "wrist": [0.71, 0.69],\n    "hip": [0.21, 0.32],\n    "knee": [0.35, 0.44],\n    "ankle": [0.48, 0.49],\n    "heel": [0.55, 0.52],\n    "toe": [0.76, 0.53]\n  }\n}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":[0.35,0.47],"shoulder":[0.38,0.62],"elbow":[0.69,0.63],"wrist":[0.82,0.64],"hip":[0.13,0.20],"knee":[0.36,0.32],"ankle":[0,0.35],"heel":[0.07,0.43],"toe":[0.09,0.53]}}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":[0.35,0.4],"shoulder":[0.35,0.6],"elbow":[0.21,0.75],"wrist":[0.13,0.88],"hip":[0.45,0.3],"knee":[0.45,0.1],"ankle":[0.45,0.05],"heel":[0.45,0.0],"toe":[0.45,0.0]}}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":[0.35,0.47],"shoulder":[0.35,0.62],"elbow":[0.18,0.69],"wrist":[0.12,0.73],"hip":[0.45,0.45],"knee":[0.45,0.63],"ankle":[0.38,0.76],"heel":[0.38,0.84],"toe":[0.38,0.91]}}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":[0.45,0.38],"shoulder":[0.45,0.62],"elbow":[0.71,0.69],"wrist":[0.84,0.69],"hip":[0.15,0.36],"knee":[0.32,0.49],"ankle":[0.32,0.67],"heel":[0.32,0.82],"toe":[0.32,0.98]}}\n```',
  '```json\n{"rider":true,"nearSide":"left","landmarks":{"ear":[0.37,0.45],"shoulder":[0.28,0.61],"elbow":[0.21,0.72],"wrist":[0.09,0.82],"hip":[0.45,0.34],"knee":[0.45,0.18],"ankle":[0.46,0.1],"heel":[0.46,0.05],"toe":[0.47,0.0}}\n```',
];

/** Seven answers about the blank picture, to #761’s question. */
export const ISSUE_761_BLANK_ANSWERS: readonly string[] = [
  '{"rider":false}',
  '{"rider":false}',
  '{"rider":false}',
  '{"rider":false}',
  '{"rider":false}',
  '{"rider":false}',
  '{"rider":false}',
];

/** Seven answers about the noise picture, to #761’s question. */
export const ISSUE_761_NOISE_ANSWERS: readonly string[] = [
  '{"rider":false}',
  '{"rider":false}',
  '{"rider":false}',
  '{"rider":false}',
  '{"rider":false}',
  '{"rider":false}',
  '{"rider":false}',
];

/** Seven answers about the drawn rider, to #761’s question. */
export const ISSUE_761_RIDER_ANSWERS: readonly string[] = [
  '{"rider":true,"nearSide":"left","landmarks":{"ear":[0.38,0.35],"shoulder":[0.42,0.63],"elbow":[0.67,0.63],"wrist":[0.81,0.35],"hip":[0.17,0.39],"knee":[0.31,0.65],"ankle":[0.45,0.35],"heel":[0.49,0.24],"toe":[0.52,0.18]}}',
  '{"rider":true,"nearSide":"left","landmarks":{"ear":[0.38,0.41],"shoulder":[0.38,0.52],"elbow":[0.67,0.58],"wrist":[0.74,0.71],"hip":[0.23,0.3],"knee":[0.35,0.43],"ankle":[0.54,0.53],"heel":[0.62,0.64],"toe":[0.70,0.8]]}',
  '{"rider":true,"nearSide":"left","landmarks":{"ear":[0.34,0.26],"shoulder":[0.39,0.45],"elbow":[0.61,0.48],"wrist":[0.71,0.48],"hip":[0.18,0.59],"knee":[0.31,0.65],"ankle":[0.42,0.68],"heel":[0.45,0.69],"toe":[0.5,0.7}}',
  '{"rider":true,"nearSide":"left","landmarks":{"ear":[0.35,0.41],"shoulder":[0.3,0.64],"elbow":[0.18,0.7],"wrist":[0.12,0.81],"hip":[0.37,0.28],"knee":[0.31,0.17],"ankle":[0.25,0.09],"heel":[0.24,0.06],"toe":[0.23,0.03]}}',
  '{"rider":true,"nearSide":"left","landmarks":{"ear":[0.37,0.49],"shoulder":[0.37,0.61],"elbow":[0.58,0.61],"wrist":[0.64,0.61],"hip":[0.23,0.72],"knee":[0.32,0.72],"ankle":[0.38,0.72],"heel":[0.43,0.72],"toe":[0.5,0.72]}}',
  '{"rider":true,"nearSide":"left","landmarks":{"ear":[0.38,0.45],"shoulder":[0.38,0.62],"elbow":[0.71,0.62],"wrist":[0.81,0.62],"hip":[0.3,0.48],"knee":[0.3,0.28],"ankle":[0.19,0.28],"heel":[0.19,0.18],"toe":[0.19,0.08]}}',
  '{"rider":true,"nearSide":"left","landmarks":{"ear":[0.41,0.32],"shoulder":[0.47,0.58],"elbow":[0.69,0.58],"wrist":[0.76,0.51],"hip":[0.33,0.44],"knee":[0.48,0.44],"ankle":[0.52,0.41],"heel":[0.55,0.39],"toe":[0.59,0.37]}}',
];
