import { contrastRatio } from "@cmf/brand-engine";
import { findTrack, resolveColor, type BrandReport, type Check, type EditPlan, type EditPlanIssue } from "@cmf/schemas";
import { isSelectable } from "@cmf/templates";
import type { BrandInfo } from "../core/types";
import { planPartsHash } from "../core/hash";
import { AgentFailure, type AgentModule } from "../core/types";

export function onScreenTexts(plan: EditPlan): { text: string; kind: string; fromFrame: number }[] {
  const out: { text: string; kind: string; fromFrame: number }[] = [];
  for (const m of findTrack(plan, "motion")?.items ?? []) {
    if ("text" in m) out.push({ text: m.text, kind: m.kind, fromFrame: m.fromFrame });
    if (m.kind === "cta") out.push({ text: `${m.headline} ${m.subline}`, kind: "cta", fromFrame: m.fromFrame });
    if (m.kind === "lower_third") out.push({ text: `${m.name} ${m.role}`, kind: "lower_third", fromFrame: m.fromFrame });
  }
  for (const c of findTrack(plan, "captions")?.items ?? []) out.push({ text: c.lines.join(" "), kind: "caption", fromFrame: c.fromFrame });
  return out;
}

/** Pure brand verification (section 20 "Marca" + 6.10). */
export function checkBrand(plan: EditPlan, brand: BrandInfo, validationIssues: EditPlanIssue[]): BrandReport {
  const checks: Check[] = [];
  const tk = brand.tokens;
  const add = (id: string, label: string, status: Check["status"], detail: string) => checks.push({ id, label, status, detail });
  const colorIssues = validationIssues.filter((i) => i.code === "COLOR_NOT_IN_BRAND");
  add("colors", "Cores do kit", colorIssues.length ? "fail" : "pass", colorIssues.length ? colorIssues.map((i) => i.message).join("; ") : "todas as cores pertencem ao kit");
  const fontIssues = validationIssues.filter((i) => i.code === "FONT_NOT_APPROVED");
  add("fonts", "Fontes aprovadas", fontIssues.length ? "fail" : "pass", fontIssues.length ? fontIssues.map((i) => i.message).join("; ") : `${tk.typography.heading} / ${tk.typography.body}`);
  const motion = findTrack(plan, "motion")?.items ?? [];
  const logo = motion.find((m) => m.kind === "logo");
  if (brand.logoAssetId) {
    if (!logo) add("logo", "Logotipo", "fail", "marca possui logo aprovado, mas ele não está na composição");
    else if (logo.kind === "logo" && logo.assetId !== brand.logoAssetId) add("logo", "Logotipo", "fail", "logo diferente do logo aprovado da marca");
    else if (logo.box.w < tk.logo.minWidthPercent) add("logo", "Logotipo", "fail", `logo com ${logo.box.w}% de largura (mínimo ${tk.logo.minWidthPercent}%)`);
    else add("logo", "Logotipo", "pass", "logo aprovado, tamanho mínimo respeitado");
  } else add("logo", "Logotipo", "warn", "marca sem logotipo cadastrado");
  const safeIssues = validationIssues.filter((i) => i.code === "TEXT_OUTSIDE_SAFE_AREA");
  add("safe_area", "Área segura", safeIssues.length ? "fail" : "pass", safeIssues.length ? `${safeIssues.length} elemento(s) fora da área segura` : "textos dentro da área segura");
  const footer = motion.find((m) => m.kind === "footer");
  if (tk.footer.enabled) add("footer", "Rodapé institucional", footer && footer.kind === "footer" && footer.text === tk.footer.text ? "pass" : "fail", footer ? `"${footer.kind === "footer" ? footer.text : ""}"` : `rodapé "${tk.footer.text}" ausente`);
  else add("footer", "Rodapé institucional", "skip", "rodapé desativado no kit");
  add("template", "Template da marca", isSelectable(plan.templateId) && plan.brandId === brand.brandId ? "pass" : "fail", plan.brandId === brand.brandId ? plan.templateId : "edit plan referencia outra marca");
  const captions = findTrack(plan, "captions")?.items ?? [];
  const capColor = resolveColor(captions[0]?.color ?? "#FFFFFF", tk);
  // Captions render with a dark stroke/shadow; contrast checked against a dark scrim.
  const ratio = contrastRatio(capColor, "#111111");
  add("caption_contrast", "Contraste das legendas", ratio >= 4.5 ? "pass" : "fail", `contraste ${ratio}:1 (mínimo 4.5:1)`);
  const texts = onScreenTexts(plan);
  const forbidden = brand.tone.forbiddenWords.filter((w) => texts.some((t) => t.text.toLowerCase().includes(w.toLowerCase())));
  add("tone_forbidden", "Palavras proibidas pelo tom", forbidden.length ? "fail" : "pass", forbidden.length ? `encontradas: ${forbidden.join(", ")}` : "nenhuma");
  const spelling = Object.entries(brand.tone.preferredSpellings).filter(([wrong]) => texts.some((t) => new RegExp(`\\b${wrong}\\b`, "i").test(t.text)));
  add("spelling", "Grafia preferida", spelling.length ? "warn" : "pass", spelling.length ? spelling.map(([w, r]) => `"${w}" → "${r}"`).join("; ") : "sem desvios");
  const blockers = checks.filter((c) => c.status === "fail").map((c) => `${c.label}: ${c.detail}`);
  const warnings = checks.filter((c) => c.status === "warn").map((c) => `${c.label}: ${c.detail}`);
  const score = Math.max(0, 100 - blockers.length * 25 - warnings.length * 5);
  return { ok: blockers.length === 0, score, checks, blockers, warnings };
}

/** Agente Marca (6.10). */
export const brandAgent: AgentModule = {
  type: "brand",
  version: "1.0.0",
  cacheable: true,
  async inputs(ctx) {
    const plan = await ctx.tools.readEditPlan();
    const brand = await ctx.tools.readBrandTokens();
    return { refs: plan ? [{ kind: "edit_plan", id: "content", checksum: planPartsHash(plan.plan, ["all"]) }] : [], params: { tokens: brand.tokens, tone: brand.tone, logo: brand.logoAssetId } };
  },
  async run(ctx) {
    await ctx.progress(0.1, "lendo kit de marca e composição", "reading_inputs");
    const current = await ctx.tools.readEditPlan();
    if (!current) throw new AgentFailure("MISSING_EDIT_PLAN", "edit plan ausente");
    const brand = await ctx.tools.readBrandTokens();
    const issues = await ctx.tools.validateEditPlan(current.plan);
    await ctx.progress(0.5, "verificando cores, fontes, logo, área segura e tom");
    const report = checkBrand(current.plan, brand, issues);
    const art = await ctx.tools.createArtifact("brand_report", report);
    return { summary: report.ok ? `marca OK (nota ${report.score})` : `${report.blockers.length} bloqueio(s) de marca`, outputRefs: [{ type: "brand_report", id: art.id, version: art.version }], model: "heuristic-v1" };
  },
};
