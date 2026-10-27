// SPDX-License-Identifier: Apache-2.0

/**
 * `@onyourleft/analysis` — the platform-free core of a model-written ride
 * write-up ([ADR 0046](../../../docs/adr/0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md)
 * D-4, D-5; #1094): the templates, the input builder, the history passages,
 * the write-up screen and the angle matchers it shares with the source scan,
 * the pose summary's shape, the hosted mask, and the run's time budget.
 *
 * It names no platform API, depends on nothing but `@onyourleft/domain`, and
 * calls no model. The device builds a ride's input and screens a write-up with
 * it; the instance's agent runs the write-up.
 *
 * ⚠️ **No runner since #1103**: the chain that ran a write-up on the device
 * (`runner.ts`, its step port and its sealed step, #811, #803) went with the
 * device's own write-up paths (ADR 0046 D-1). A reviewer who remembers
 * `runAnalysis` or `ModelStepPort` here is reading the old file.
 */

export * from './disclosure';
export * from './history';
export * from './hosted-mask';
export * from './input';
export * from './masked-words';
export * from './pose-summary';
export * from './budget';
export * from './screen/angle-claims';
export * from './screen/model-answer';
export * from './screen/write-up-screen';
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
