import type { BrandTokens, EditPlan } from "@cmf/schemas";

export interface RenderMediaRef {
  src: string;
  kind: "video" | "audio" | "image";
}

export interface RenderFont {
  family: string;
  weight: number;
  style: "normal" | "italic";
  url: string;
}

/** Input props of the CmfEditPlan composition (JSON-serialisable). */
export interface CompositionProps extends Record<string, unknown> {
  plan: EditPlan;
  brand: { name: string; tokens: BrandTokens };
  media: Record<string, RenderMediaRef>;
  fonts: RenderFont[];
}
