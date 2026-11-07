import { clampToSafe, logoBox, safeAreaFor } from "@cmf/brand-engine";
import { findTrack, type CreativeDirection, type EditPlan, type MotionItem, type MotionPlan, type RevisionPlan, type Script } from "@cmf/schemas";
import { planPartsHash } from "../core/hash";
import { AgentFailure, type AgentModule } from "../core/types";

/**
 * Agente Motion (6.7): titles, lower thirds, callouts, CTA card, progress bar, logo and footer
 * as editable Remotion component props — never baked video.
 */
export const motionAgent: AgentModule = {
  type: "motion",
  version: "1.1.0",
  cacheable: true,
  async inputs(ctx) {
    const plan = await ctx.tools.readEditPlan();
    const script = await ctx.tools.readArtifact("script");
    const revisions = await ctx.tools.readArtifact<RevisionPlan>("revision_plan");
    const brand = await ctx.tools.readBrandTokens();
    const brief = await ctx.tools.readProjectBrief();
    return {
      refs: [
        ...(plan ? [{ kind: "edit_plan.video", id: "content", checksum: planPartsHash(plan.plan, ["composition", "video"]) }] : []),
        ...(script ? [{ kind: "script", id: script.id, version: script.version }] : []),
        { kind: "brief", id: brief.briefId, version: brief.version },
      ],
      params: { suppressed: revisions?.payload.suppressedMotion ?? [], tokens: brand.tokens, logo: brand.logoAssetId },
    };
  },
  async run(ctx) {
    await ctx.progress(0.05, "lendo timeline, roteiro e kit de marca", "reading_inputs");
    const current = await ctx.tools.readEditPlan();
    const script = await ctx.tools.readArtifact<Script>("script");
    const dir = await ctx.tools.readArtifact<CreativeDirection>("creative_direction");
    if (!current || !script || !dir) throw new AgentFailure("MISSING_INPUTS", "edit plan, roteiro ou direção ausentes");
    const brief = (await ctx.tools.readProjectBrief()).content;
    const brand = await ctx.tools.readBrandTokens();
    const template = await ctx.tools.readTemplate(current.plan.templateId);
    const plan: EditPlan = structuredClone(current.plan);
    const { fps, durationInFrames: total, width, height } = plan.composition;
    const layout = template.layouts[dir.payload.aspect] ?? template.layouts["9:16"]!;
    const safe = safeAreaFor(width, height);
    const tk = brand.tokens;
    const approvals = await ctx.tools.listApprovals();
    const grantedScript = approvals.find((a) => a.artifactType === "script" && a.decision === "granted" && a.artifactId === script.id);
    const variant = script.payload.variants.find((v) => v.id === (grantedScript && /variante B/.test(grantedScript.reason) ? "B" : script.payload.chosenVariant)) ?? script.payload.variants[0]!;

    // Elements removed by humans in review (kind|text) are never recreated.
    const suppressed = new Set<string>();
    const revisionArtifacts = await ctx.tools.readArtifact<RevisionPlan>("revision_plan");
    for (const d of revisionArtifacts?.payload.suppressedMotion ?? []) suppressed.add(d);
    const allowed = (kind: string, text: string) => !suppressed.has(`${kind}|${text}`);

    const items: MotionItem[] = [];
    const sec = (s: number) => Math.round(s * fps);
    const ctaFrames = Math.min(sec(layout.cta.durationSec), Math.max(sec(1.5), Math.floor(total * 0.25)));
    const ctaStart = Math.max(0, total - ctaFrames);
    await ctx.progress(0.3, "posicionando gancho e lower third");
    if (layout.hookTitle && allowed("hook_title", variant.hookTitle)) {
      items.push({
        id: "mo-hook",
        kind: "hook_title",
        fromFrame: 0,
        durationInFrames: Math.min(sec(layout.hookTitle.durationSec), ctaStart || total),
        box: clampToSafe(layout.hookTitle.box, safe),
        text: variant.hookTitle,
        emphasis: variant.hookEmphasis,
        color: "#FFFFFF",
        accentColor: "accent",
        fontFamily: tk.typography.heading,
      });
    }
    if (layout.lowerThird && brief.speaker && allowed("lower_third", brief.speaker.name)) {
      const from = sec(layout.lowerThird.atSec);
      const dur = sec(layout.lowerThird.durationSec);
      if (from + dur < ctaStart)
        items.push({
          id: "mo-lower-third",
          kind: "lower_third",
          fromFrame: from,
          durationInFrames: dur,
          box: clampToSafe(layout.lowerThird.box, safe),
          name: brief.speaker.name,
          role: brief.speaker.role,
          color: "primary",
          accentColor: "accent",
          fontFamily: tk.typography.body,
        });
    }
    // Callouts: on-screen texts from the script, anchored to the clip of their beat.
    await ctx.progress(0.5, "criando destaques sincronizados");
    const video = findTrack(plan, "video");
    let callouts = 0;
    const maxCallouts = Math.min(layout.callouts?.max ?? 0, tk.motion.maxAnimationsPerScene);
    for (const beat of variant.beats) {
      if (!layout.callouts || callouts >= maxCallouts || beat.kind === "cta" || !beat.onScreenText) continue;
      const clip = video?.items.find((i) => i.beatId === beat.id);
      if (!clip) continue;
      const from = clip.fromFrame + sec(0.25);
      const dur = Math.min(sec(layout.callouts.durationSec), clip.durationInFrames);
      const overlapsHook = items.some((m) => m.kind === "hook_title" && from < m.fromFrame + m.durationInFrames);
      if (from + dur > ctaStart || overlapsHook || !allowed("callout", beat.onScreenText)) continue;
      items.push({
        id: `mo-callout-${++callouts}`,
        kind: "callout",
        fromFrame: from,
        durationInFrames: dur,
        box: clampToSafe(layout.callouts.box, safe),
        text: beat.onScreenText.slice(0, 60),
        color: "accent",
        fontFamily: tk.typography.heading,
      });
    }
    await ctx.progress(0.7, "montando cartela de CTA, logo e rodapé");
    if (allowed("cta", brief.cta.text))
      items.push({
        id: "mo-cta",
        kind: "cta",
        fromFrame: ctaStart,
        durationInFrames: total - ctaStart,
        box: clampToSafe(layout.cta.box, safe),
        headline: brief.cta.text,
        subline: brief.cta.url ?? brand.name,
        color: "accent",
        showLogo: Boolean(brand.logoAssetId),
        fontFamily: tk.typography.heading,
      });
    if (layout.progressBar)
      items.push({ id: "mo-progress", kind: "progress_bar", fromFrame: 0, durationInFrames: ctaStart || total, box: clampToSafe(layout.progressBar.box, safe), color: "accent" });
    if (brand.logoAssetId)
      items.push({ id: "mo-logo", kind: "logo", fromFrame: 0, durationInFrames: ctaStart || total, box: logoBox(tk, width, height), assetId: brand.logoAssetId, opacity: 0.92 });
    if (tk.footer.enabled && tk.footer.text)
      items.push({ id: "mo-footer", kind: "footer", fromFrame: 0, durationInFrames: total, box: clampToSafe(layout.footer.box, safe, { allowFooter: true }), text: tk.footer.text, color: "#FFFFFF", fontFamily: tk.typography.body });

    const track = findTrack(plan, "motion");
    if (!track) throw new AgentFailure("NO_MOTION_TRACK", "edit plan sem trilha de motion");
    track.items = items;
    const saved = await ctx.tools.saveEditPlan(plan, `motion: ${items.length} elementos`);
    const mp: MotionPlan = {
      intensity: dir.payload.motionIntensity,
      items: items.map((m) => ({
        id: m.id,
        kind: m.kind,
        fromFrame: m.fromFrame,
        durationInFrames: m.durationInFrames,
        text: "text" in m ? m.text : "headline" in m ? m.headline : "name" in m ? m.name : "",
      })),
    };
    const art = await ctx.tools.createArtifact("motion_plan", mp);
    return {
      summary: `${items.length} elementos de motion (${callouts} destaque(s))${suppressed.size ? `, ${suppressed.size} removido(s) pela revisão` : ""}`,
      outputRefs: [
        { type: "edit_plan", id: saved.id, version: saved.version },
        { type: "motion_plan", id: art.id, version: art.version },
      ],
      model: "heuristic-v1",
    };
  },
};
