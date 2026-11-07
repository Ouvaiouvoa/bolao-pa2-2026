import type { Aspect, Box, Objective } from "@cmf/schemas";

/**
 * Template library (section 13.6). A template is a set of layout and pacing rules consumed by
 * the Director, Editor, Motion and Captions agents — compositions stay editable data.
 * Status is explicit: only "available" templates can be chosen for production.
 */

export interface TemplateLayout {
  hookTitle: { box: Box; durationSec: number } | null;
  lowerThird: { box: Box; atSec: number; durationSec: number } | null;
  callouts: { box: Box; max: number; durationSec: number } | null;
  cta: { box: Box; durationSec: number };
  progressBar: { box: Box } | null;
  captionsBottomPercent: number;
  footer: { box: Box };
}

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  objectives: Objective[];
  status: "available" | "beta" | "planned";
  captionPreset: "bold-pop" | "clean" | "karaoke";
  pacing: { removePausesOverMs: number; cutPaddingMs: number; punchInEveryNthCut: number; punchInScale: number };
  layouts: Partial<Record<Aspect, TemplateLayout>>;
  hasReferenceFrames: boolean;
}

const vertical: TemplateLayout = {
  hookTitle: { box: { x: 8, y: 16, w: 84, h: 20 }, durationSec: 2.8 },
  lowerThird: { box: { x: 8, y: 58, w: 70, h: 9 }, atSec: 3.2, durationSec: 3.4 },
  callouts: { box: { x: 8, y: 12, w: 84, h: 8 }, max: 3, durationSec: 2.2 },
  cta: { box: { x: 8, y: 30, w: 84, h: 36 }, durationSec: 3.4 },
  progressBar: { box: { x: 6, y: 8, w: 88, h: 0.6 } },
  captionsBottomPercent: 22,
  footer: { box: { x: 30, y: 95.2, w: 40, h: 2.6 } },
};

const square: TemplateLayout = {
  hookTitle: { box: { x: 7, y: 9, w: 86, h: 22 }, durationSec: 2.8 },
  lowerThird: { box: { x: 7, y: 60, w: 60, h: 11 }, atSec: 3.2, durationSec: 3.4 },
  callouts: { box: { x: 7, y: 8, w: 86, h: 10 }, max: 3, durationSec: 2.2 },
  cta: { box: { x: 7, y: 22, w: 86, h: 46 }, durationSec: 3.4 },
  progressBar: { box: { x: 5, y: 5, w: 90, h: 0.8 } },
  captionsBottomPercent: 12,
  footer: { box: { x: 30, y: 95, w: 40, h: 3 } },
};

const horizontal: TemplateLayout = {
  hookTitle: { box: { x: 6, y: 10, w: 60, h: 26 }, durationSec: 2.8 },
  lowerThird: { box: { x: 6, y: 66, w: 40, h: 13 }, atSec: 3.2, durationSec: 3.4 },
  callouts: { box: { x: 6, y: 8, w: 50, h: 12 }, max: 3, durationSec: 2.2 },
  cta: { box: { x: 20, y: 22, w: 60, h: 50 }, durationSec: 3.4 },
  progressBar: { box: { x: 5, y: 5, w: 90, h: 1 } },
  captionsBottomPercent: 12,
  footer: { box: { x: 38, y: 95, w: 24, h: 3.2 } },
};

export const TEMPLATES: TemplateDefinition[] = [
  {
    id: "tpl_authority_001",
    name: "Autoridade Premium",
    description: "Fala direta para câmera com gancho tipográfico, lower third, destaques semânticos, barra de progresso e CTA final com marca.",
    objectives: ["authority", "podcast_cut", "training", "institutional"],
    status: "available",
    captionPreset: "bold-pop",
    pacing: { removePausesOverMs: 380, cutPaddingMs: 90, punchInEveryNthCut: 2, punchInScale: 1.12 },
    layouts: { "9:16": vertical, "1:1": square, "16:9": horizontal },
    hasReferenceFrames: true,
  },
  {
    id: "tpl_offer_001",
    name: "Oferta Direta",
    description: "Ritmo acelerado, legendas karaokê e CTA estendido para campanhas de oferta.",
    objectives: ["offer", "before_after"],
    status: "beta",
    captionPreset: "karaoke",
    pacing: { removePausesOverMs: 280, cutPaddingMs: 70, punchInEveryNthCut: 1, punchInScale: 1.15 },
    layouts: {
      "9:16": { ...vertical, lowerThird: null, cta: { box: { x: 8, y: 26, w: 84, h: 40 }, durationSec: 4.2 } },
      "1:1": { ...square, lowerThird: null },
      "16:9": { ...horizontal, lowerThird: null },
    },
    hasReferenceFrames: false,
  },
  {
    id: "tpl_tutorial_001",
    name: "Tutorial Limpo",
    description: "Legendas limpas, passos destacados como chamadas e cortes conservadores.",
    objectives: ["tutorial", "training"],
    status: "beta",
    captionPreset: "clean",
    pacing: { removePausesOverMs: 600, cutPaddingMs: 120, punchInEveryNthCut: 0, punchInScale: 1 },
    layouts: { "9:16": { ...vertical, progressBar: null }, "1:1": { ...square, progressBar: null }, "16:9": { ...horizontal, progressBar: null } },
    hasReferenceFrames: false,
  },
  { id: "tpl_testimonial_001", name: "Depoimento", description: "Planejado: depoimento com citação em destaque.", objectives: ["testimonial"], status: "planned", captionPreset: "clean", pacing: { removePausesOverMs: 500, cutPaddingMs: 120, punchInEveryNthCut: 0, punchInScale: 1 }, layouts: {}, hasReferenceFrames: false },
  { id: "tpl_podcast_001", name: "Podcast / Entrevista", description: "Planejado: dois falantes com troca de enquadramento por diarização.", objectives: ["podcast_cut"], status: "planned", captionPreset: "bold-pop", pacing: { removePausesOverMs: 450, cutPaddingMs: 100, punchInEveryNthCut: 2, punchInScale: 1.1 }, layouts: {}, hasReferenceFrames: false },
  { id: "tpl_training_001", name: "Treinamento com capítulos", description: "Planejado: capítulos e índice para treinamento interno.", objectives: ["training"], status: "planned", captionPreset: "clean", pacing: { removePausesOverMs: 700, cutPaddingMs: 150, punchInEveryNthCut: 0, punchInScale: 1 }, layouts: {}, hasReferenceFrames: false },
  { id: "tpl_institutional_001", name: "Institucional", description: "Planejado: B-roll aprovado e trilha institucional.", objectives: ["institutional"], status: "planned", captionPreset: "clean", pacing: { removePausesOverMs: 600, cutPaddingMs: 150, punchInEveryNthCut: 0, punchInScale: 1 }, layouts: {}, hasReferenceFrames: false },
  { id: "tpl_before_after_001", name: "Antes / Depois", description: "Planejado: tela dividida de comparação.", objectives: ["before_after"], status: "planned", captionPreset: "bold-pop", pacing: { removePausesOverMs: 400, cutPaddingMs: 100, punchInEveryNthCut: 2, punchInScale: 1.1 }, layouts: {}, hasReferenceFrames: false },
];

export function getTemplate(id: string): TemplateDefinition {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`template desconhecido: ${id}`);
  return t;
}

export function isSelectable(id: string): boolean {
  const t = TEMPLATES.find((x) => x.id === id);
  return Boolean(t && t.status !== "planned");
}

export function layoutFor(template: TemplateDefinition, aspect: Aspect): TemplateLayout {
  const layout = template.layouts[aspect] ?? template.layouts["9:16"];
  if (!layout) throw new Error(`template ${template.id} não possui layout para ${aspect}`);
  return layout;
}

export function templateForObjective(objective: Objective): TemplateDefinition {
  return TEMPLATES.find((t) => t.status === "available" && t.objectives.includes(objective)) ?? getTemplate("tpl_authority_001");
}
