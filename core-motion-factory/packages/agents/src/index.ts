import type { AgentType } from "@cmf/schemas";
import { audioAgent } from "./audio";
import { brandAgent } from "./brand";
import { captionsAgent } from "./captions";
import { complianceAgent } from "./compliance";
import type { AgentModule } from "./core/types";
import { curatorAgent } from "./curator";
import { directorAgent } from "./director";
import { distributionAgent } from "./distribution";
import { editorAgent } from "./editor";
import { ingestAgent } from "./ingest";
import { motionAgent } from "./motion";
import { qaAgent } from "./qa";
import { renderAgent } from "./render";
import { transcriptAgent } from "./transcript";
import { writerAgent } from "./writer";

export * from "./core/types";
export * from "./core/llm";
export * as text from "./core/text";
export { curate } from "./curator";
export { buildVariant, calloutFor } from "./writer";
export { assembleVideoItems, applyCut, wordAtTimeline, emptyPlan } from "./editor";
export { buildCaptionPages, breakLines, timelineWords, pagesToItems } from "./captions";
export { speechRanges, synthesizeAmbientPad, GENERATED_MUSIC_ORIGIN } from "./audio";
export { checkBrand, onScreenTexts } from "./brand";
export { scanCompliance } from "./compliance";
export { evaluateQa } from "./qa";
export { DIRECTOR_SYSTEM_PROMPT } from "./director";

export const AGENT_MODULES: Record<AgentType, AgentModule> = {
  director: directorAgent,
  ingest: ingestAgent,
  transcript: transcriptAgent,
  curator: curatorAgent,
  writer: writerAgent,
  editor: editorAgent,
  motion: motionAgent,
  captions: captionsAgent,
  audio: audioAgent,
  brand: brandAgent,
  compliance: complianceAgent,
  qa: qaAgent,
  render: renderAgent,
  distribution: distributionAgent,
};
