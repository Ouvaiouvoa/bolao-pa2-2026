import { frameToMs, type RenderReport } from "@cmf/schemas";
import { AgentFailure, type AgentModule } from "../core/types";

const centsPerMinute = () => Number(process.env.CMF_RENDER_CENTS_PER_MINUTE ?? 4);

/** Agente Render (6.13): preview (540p) or master (1080p) through the restricted render tool. */
export const renderAgent: AgentModule = {
  type: "render",
  version: "1.0.0",
  cacheable: true,
  async inputs(ctx) {
    const plan = await ctx.tools.readEditPlan();
    return { refs: plan ? [{ kind: "edit_plan", id: plan.id, version: plan.version }] : [], params: { kind: ctx.stage === "FINAL_RENDERING" ? "final" : "preview" } };
  },
  async estimateCostCents(ctx) {
    const plan = await ctx.tools.readEditPlan();
    if (!plan) return {};
    const minutes = frameToMs(plan.plan.composition.durationInFrames, plan.plan.composition.fps) / 60000;
    const factor = ctx.stage === "FINAL_RENDERING" ? 1 : 0.3;
    return { renderCents: minutes * centsPerMinute() * factor };
  },
  async run(ctx) {
    const kind = ctx.stage === "FINAL_RENDERING" ? "final" : "preview";
    await ctx.progress(0.02, `preparando render ${kind}`, "reading_inputs");
    const plan = await ctx.tools.readEditPlan();
    if (!plan) throw new AgentFailure("MISSING_EDIT_PLAN", "edit plan ausente");
    const issues = await ctx.tools.validateEditPlan(plan.plan);
    if (issues.some((i) => i.severity === "error")) throw new AgentFailure("INVALID_EDIT_PLAN", `edit plan inválido: ${issues.find((i) => i.severity === "error")!.message}`);
    const out = await ctx.tools.renderMedia(kind, plan.id, (f) => void ctx.progress(0.05 + f * 0.9, `renderizando ${kind} (${Math.round(f * 100)}%)`));
    // Compute cost of the render is attributed to this run (totals count it once, from `renders`).
    ctx.recordUsage({ model: "remotion", tokensIn: 0, tokensOut: 0, costCents: out.costCents });
    const report: RenderReport = {
      renderId: out.renderId,
      kind,
      objectKey: out.objectKey,
      thumbnailKey: out.thumbnailKey,
      durationMs: out.durationMs,
      width: out.width,
      height: out.height,
      fps: out.fps,
      codec: out.codec,
      audioCodec: out.audioCodec,
      fileSize: out.fileSize,
      checksum: out.checksum,
      renderMs: out.renderMs,
      framesRendered: out.framesRendered,
      costCents: out.costCents,
      loudness: out.loudness,
    };
    const art = await ctx.tools.createArtifact("render_report", report, { objectKey: out.objectKey });
    return {
      summary: `${kind} ${out.width}×${out.height} ${(out.durationMs / 1000).toFixed(1)}s em ${(out.renderMs / 1000).toFixed(1)}s · sha256 ${out.checksum.slice(0, 12)}…`,
      outputRefs: [
        { type: "render", id: out.renderId },
        { type: "render_report", id: art.id, version: art.version },
      ],
      model: "remotion",
    };
  },
};
