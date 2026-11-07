import type { z } from "zod";
import { allowedBrandColors, approvedBrandFonts, type BrandTokens, BRAND_COLOR_ROLES } from "./brand";
import {
  aspectOf,
  EditPlanSchema,
  SAFE_ZONES,
  TEXT_MOTION_KINDS,
  type ColorRef,
  type EditPlan,
} from "./edit-plan";

export type IssueSeverity = "error" | "warning";

export interface EditPlanIssue {
  code:
    | "SCHEMA"
    | "ITEM_DURATION_NONPOSITIVE"
    | "SOURCE_RANGE_INVALID"
    | "SOURCE_DURATION_MISMATCH"
    | "SOURCE_EXCEEDS_ASSET"
    | "ASSET_NOT_FOUND"
    | "ASSET_FOREIGN_ORG"
    | "ASSET_KIND_MISMATCH"
    | "COLOR_NOT_IN_BRAND"
    | "FONT_NOT_APPROVED"
    | "VOLUME_OUT_OF_RANGE"
    | "ITEM_EXCEEDS_COMPOSITION"
    | "TEXT_OUTSIDE_SAFE_AREA"
    | "CAPTION_TOO_MANY_LINES"
    | "CAPTION_LINE_TOO_LONG"
    | "CAPTION_WORD_OUTSIDE_ITEM"
    | "VIDEO_OVERLAP"
    | "VIDEO_GAP"
    | "DUPLICATE_ID"
    | "PROJECT_MISMATCH"
    | "BRAND_MISMATCH";
  severity: IssueSeverity;
  path: string;
  message: string;
}

export interface AssetRef {
  id: string;
  organizationId: string;
  kind: "video" | "audio" | "image" | "logo" | "font" | "music";
  durationMs: number | null;
}

export interface EditPlanValidationContext {
  organizationId: string;
  projectId?: string;
  brandId?: string;
  brandTokens: BrandTokens;
  /** Lookup for every asset the plan may reference (project assets + brand assets). */
  assets: Map<string, AssetRef>;
}

export interface EditPlanValidationResult {
  ok: boolean;
  plan: EditPlan | null;
  issues: EditPlanIssue[];
}

function zodIssues(error: z.ZodError): EditPlanIssue[] {
  return error.issues.map((i) => ({
    code: "SCHEMA" as const,
    severity: "error" as const,
    path: i.path.join("."),
    message: i.message,
  }));
}

export function resolveColor(ref: ColorRef, tokens: BrandTokens): string {
  if ((BRAND_COLOR_ROLES as readonly string[]).includes(ref)) return tokens.colors[ref as keyof BrandTokens["colors"]];
  return ref.toUpperCase();
}

/**
 * Full validation of an edit plan: schema (strict) + semantic rules from section 12.
 * Returns parsed plan only if there are no errors (warnings are allowed).
 */
export function validateEditPlan(input: unknown, ctx: EditPlanValidationContext): EditPlanValidationResult {
  const parsed = EditPlanSchema.safeParse(input);
  if (!parsed.success) return { ok: false, plan: null, issues: zodIssues(parsed.error) };
  const plan = parsed.data;
  const issues: EditPlanIssue[] = [];
  const push = (code: EditPlanIssue["code"], severity: IssueSeverity, path: string, message: string) =>
    issues.push({ code, severity, path, message });

  const { fps, durationInFrames, width, height } = plan.composition;
  const frameMs = 1000 / fps;
  const colors = allowedBrandColors(ctx.brandTokens);
  const fonts = approvedBrandFonts(ctx.brandTokens);
  const zone = SAFE_ZONES[aspectOf(width, height)];

  if (ctx.projectId && plan.projectId !== ctx.projectId)
    push("PROJECT_MISMATCH", "error", "projectId", "edit plan pertence a outro projeto");
  if (ctx.brandId && plan.brandId !== ctx.brandId) push("BRAND_MISMATCH", "error", "brandId", "edit plan usa outra marca");

  const seenIds = new Set<string>();
  const checkId = (id: string, path: string) => {
    if (seenIds.has(id)) push("DUPLICATE_ID", "error", path, `id duplicado: ${id}`);
    seenIds.add(id);
  };
  const checkSpan = (from: number, dur: number, path: string) => {
    if (dur <= 0) push("ITEM_DURATION_NONPOSITIVE", "error", path, "duração deve ser maior que zero");
    if (from + dur > durationInFrames)
      push("ITEM_EXCEEDS_COMPOSITION", "error", path, `item termina no frame ${from + dur}, após o fim da composição (${durationInFrames})`);
  };
  const checkColor = (ref: ColorRef, path: string) => {
    const hex = resolveColor(ref, ctx.brandTokens);
    const base = hex.length === 9 ? hex.slice(0, 7) : hex;
    if (!colors.has(base)) push("COLOR_NOT_IN_BRAND", "error", path, `cor ${hex} não pertence ao kit da marca`);
  };
  const checkFont = (family: string | undefined, path: string) => {
    if (family && !fonts.has(family)) push("FONT_NOT_APPROVED", "error", path, `fonte "${family}" não aprovada para a marca`);
  };
  const checkAsset = (assetId: string, path: string, kinds: AssetRef["kind"][]): AssetRef | undefined => {
    const asset = ctx.assets.get(assetId);
    if (!asset) {
      push("ASSET_NOT_FOUND", "error", path, `asset ${assetId} não encontrado`);
      return undefined;
    }
    if (asset.organizationId !== ctx.organizationId) {
      push("ASSET_FOREIGN_ORG", "error", path, `asset ${assetId} pertence a outra organização`);
      return undefined;
    }
    if (!kinds.includes(asset.kind)) push("ASSET_KIND_MISMATCH", "error", path, `asset ${assetId} é ${asset.kind}, esperado ${kinds.join("/")}`);
    return asset;
  };

  plan.tracks.forEach((track, ti) => {
    checkId(track.id, `tracks.${ti}.id`);
    if (track.type === "video") {
      const sorted = [...track.items].sort((a, b) => a.fromFrame - b.fromFrame);
      sorted.forEach((item, idx) => {
        const ii = track.items.indexOf(item);
        const p = `tracks.${ti}.items.${ii}`;
        checkId(item.id, `${p}.id`);
        checkSpan(item.fromFrame, item.durationInFrames, p);
        if (item.sourceEndMs <= item.sourceStartMs)
          push("SOURCE_RANGE_INVALID", "error", `${p}.sourceEndMs`, "sourceEndMs deve ser posterior a sourceStartMs");
        else {
          const srcFrames = (item.sourceEndMs - item.sourceStartMs) / frameMs;
          if (Math.abs(srcFrames - item.durationInFrames) > 1.01)
            push("SOURCE_DURATION_MISMATCH", "error", p, `trecho de origem (${srcFrames.toFixed(1)} frames) difere da duração do item (${item.durationInFrames})`);
        }
        const asset = checkAsset(item.assetId, `${p}.assetId`, ["video"]);
        if (asset?.durationMs != null && item.sourceEndMs > asset.durationMs + frameMs)
          push("SOURCE_EXCEEDS_ASSET", "error", `${p}.sourceEndMs`, `trecho termina em ${item.sourceEndMs}ms, após o fim do asset (${asset.durationMs}ms)`);
        if (item.volume < 0 || item.volume > 2) push("VOLUME_OUT_OF_RANGE", "error", `${p}.volume`, "volume fora da faixa segura (0–2)");
        const next = sorted[idx + 1];
        if (next) {
          const end = item.fromFrame + item.durationInFrames;
          if (next.fromFrame < end) push("VIDEO_OVERLAP", "error", p, `clipe sobrepõe o próximo em ${end - next.fromFrame} frames`);
          else if (next.fromFrame > end) push("VIDEO_GAP", "warning", p, `lacuna de ${next.fromFrame - end} frames sem vídeo`);
        }
      });
    } else if (track.type === "captions") {
      const bottomMin = Math.max(ctx.brandTokens.captions.safeBottomPercent, zone.bottom);
      track.items.forEach((item, ii) => {
        const p = `tracks.${ti}.items.${ii}`;
        checkId(item.id, `${p}.id`);
        checkSpan(item.fromFrame, item.durationInFrames, p);
        if (item.lines.length > ctx.brandTokens.captions.maxLines)
          push("CAPTION_TOO_MANY_LINES", "error", `${p}.lines`, `legenda com ${item.lines.length} linhas (máximo ${ctx.brandTokens.captions.maxLines})`);
        item.lines.forEach((line, li) => {
          if (line.length > ctx.brandTokens.captions.maxCharsPerLine)
            push("CAPTION_LINE_TOO_LONG", "warning", `${p}.lines.${li}`, `linha com ${line.length} caracteres (preferido até ${ctx.brandTokens.captions.maxCharsPerLine})`);
        });
        if (item.bottomPercent < bottomMin)
          push("TEXT_OUTSIDE_SAFE_AREA", "error", `${p}.bottomPercent`, `legenda a ${item.bottomPercent}% da base; mínimo seguro ${bottomMin}%`);
        const end = item.fromFrame + item.durationInFrames;
        item.words.forEach((w, wi) => {
          if (w.startFrame < item.fromFrame || w.endFrame > end || w.endFrame < w.startFrame)
            push("CAPTION_WORD_OUTSIDE_ITEM", "error", `${p}.words.${wi}`, `palavra "${w.text}" fora do intervalo da legenda`);
        });
        checkColor(item.color, `${p}.color`);
        checkColor(item.highlightColor, `${p}.highlightColor`);
        checkFont(item.fontFamily, `${p}.fontFamily`);
      });
    } else if (track.type === "motion") {
      track.items.forEach((item, ii) => {
        const p = `tracks.${ti}.items.${ii}`;
        checkId(item.id, `${p}.id`);
        checkSpan(item.fromFrame, item.durationInFrames, p);
        checkFont(item.fontFamily, `${p}.fontFamily`);
        if ("color" in item && item.color) checkColor(item.color, `${p}.color`);
        if ("accentColor" in item && item.accentColor) checkColor(item.accentColor, `${p}.accentColor`);
        if (item.kind === "logo") checkAsset(item.assetId, `${p}.assetId`, ["logo", "image"]);
        if (TEXT_MOTION_KINDS.has(item.kind) || item.kind === "logo") {
          const { x, y, w, h } = item.box;
          const bottomLimit = item.kind === "footer" ? 100 - 1 : 100 - zone.bottom;
          if (x < zone.side - 0.01 || x + w > 100 - zone.side + 0.01 || y < zone.top - 0.01 || y + h > bottomLimit + 0.01)
            push("TEXT_OUTSIDE_SAFE_AREA", "error", `${p}.box`, `elemento "${item.kind}" fora da área segura`);
        }
      });
    } else if (track.type === "audio") {
      track.items.forEach((item, ii) => {
        const p = `tracks.${ti}.items.${ii}`;
        checkId(item.id, `${p}.id`);
        checkSpan(item.fromFrame, item.durationInFrames, p);
        checkAsset(item.assetId, `${p}.assetId`, ["audio", "music"]);
        if (item.volume < 0 || item.volume > 1) push("VOLUME_OUT_OF_RANGE", "error", `${p}.volume`, "volume fora da faixa segura (0–1)");
        if (item.ducking && item.ducking.duckedVolume > item.volume)
          push("VOLUME_OUT_OF_RANGE", "warning", `${p}.ducking.duckedVolume`, "volume com ducking maior que o volume base");
      });
    }
  });

  const ok = !issues.some((i) => i.severity === "error");
  return { ok, plan: ok ? plan : null, issues };
}
