// SPDX-License-Identifier: Apache-2.0

/**
 * `@onyourleft/analysis` — the platform-free core of a model-written ride
 * write-up ([ADR 0046](../../../docs/adr/0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md)
 * D-4, D-5; #1094): the runner, the templates, the input builder, the history
 * passages, the write-up screen and the angle matchers it shares with the
 * source scan, the pose summary's shape, and the hosted mask.
 *
 * It names no platform API, depends on nothing but `@onyourleft/domain`, and
 * calls no model: time and the transport to a model are parameters
 * (`RunnerClock`, `ModelStepPort`). The same code runs on a rider's device and,
 * from #1098, on their instance.
 *
 * ⚠️ **`sealStep` is not exported**, on purpose: only `runner.ts` may make a
 * sealed step (#803), and with this package's `exports` naming only this file
 * and `./testing`, nothing outside the package can import it at all.
 * `sealed-step.test.ts` holds both halves.
 */

export * from './disclosure';
export * from './history';
export * from './hosted-mask';
export * from './input';
export * from './masked-words';
export * from './model-step-port';
export * from './pose-summary';
export * from './runner';
export * from './screen/angle-claims';
export * from './screen/model-answer';
export * from './screen/write-up-screen';
export { isSealedStep, type SealedStep } from './sealed-step';
export * from './template/template';
export {
  agentSectionFigures,
  ANALYSIS_AGENT_TEMPLATE_V1,
  fenceData,
  type AgentTemplate,
} from './template/agent-v1';
export { ANALYSIS_TEMPLATE_V1 } from './template/template-v1';
export {
  ANALYSIS_TEMPLATE_V2,
  HISTORY_FENCE_BEGIN,
  HISTORY_FENCE_END,
} from './template/template-v2';
