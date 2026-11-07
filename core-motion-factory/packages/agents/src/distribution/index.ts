import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import archiver from "archiver";
import { sha256File } from "@cmf/media";
import type { CaptionsArtifact, DeliveryPackage, QaReport, RenderReport, Script } from "@cmf/schemas";
import { AgentFailure, type AgentModule } from "../core/types";

async function zipFiles(out: string, files: { path: string; name: string }[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(out);
    const zip = archiver("zip", { zlib: { level: 6 } });
    output.on("close", () => resolve());
    zip.on("error", reject);
    zip.pipe(output);
    for (const f of files) zip.file(f.path, { name: f.name });
    void zip.finalize();
  });
}

/**
 * Agente Distribuição (6.14) — MVP: prepares the publication package only.
 * Publishing is out of scope and requires integration, policy and explicit approval.
 */
export const distributionAgent: AgentModule = {
  type: "distribution",
  version: "1.0.0",
  cacheable: true,
  async inputs(ctx) {
    const qa = await ctx.tools.readArtifact("qa_report");
    return { refs: qa ? [{ kind: "qa_report", id: qa.id, version: qa.version }] : [] };
  },
  async run(ctx) {
    await ctx.progress(0.05, "reunindo master, legendas e relatórios", "reading_inputs");
    const rr = await ctx.tools.readArtifact<RenderReport>("render_report");
    const qa = await ctx.tools.readArtifact<QaReport>("qa_report");
    const caps = await ctx.tools.readArtifact<CaptionsArtifact>("captions");
    const script = await ctx.tools.readArtifact<Script>("script");
    if (!rr || rr.payload.kind !== "final" || !qa) throw new AgentFailure("MISSING_INPUTS", "master final ou relatório de QA ausentes");
    if (qa.payload.renderId !== rr.payload.renderId) throw new AgentFailure("QA_MISMATCH", "relatório de QA não corresponde ao master");
    const metrics = await ctx.tools.readProjectMetrics();
    const tmp = await mkdtemp(path.join(os.tmpdir(), "cmf-delivery-"));
    try {
      const renderId = rr.payload.renderId;
      const entries: { name: string; kind: string; objectKey: string }[] = [{ name: "master-1080x1920.mp4", kind: "video", objectKey: rr.payload.objectKey }];
      if (rr.payload.thumbnailKey) entries.push({ name: "capa.jpg", kind: "thumbnail", objectKey: rr.payload.thumbnailKey });
      if (caps) {
        entries.push({ name: "legendas.srt", kind: "srt", objectKey: caps.payload.srtKey });
        entries.push({ name: "legendas.vtt", kind: "vtt", objectKey: caps.payload.vttKey });
      }
      const qaKey = await ctx.tools.storeProjectFile(`delivery/${renderId}/qa-report.json`, { data: JSON.stringify(qa.payload, null, 2) }, "application/json");
      entries.push({ name: "relatorio-qa.json", kind: "qa_report", objectKey: qaKey });
      const publish = script?.payload.publishCaption ?? "";
      const pubKey = await ctx.tools.storeProjectFile(`delivery/${renderId}/publicacao.txt`, { data: `${publish}\n` }, "text/plain; charset=utf-8");
      entries.push({ name: "publicacao.txt", kind: "publish_caption", objectKey: pubKey });
      const costKey = await ctx.tools.storeProjectFile(`delivery/${renderId}/custos-e-tempo.json`, { data: JSON.stringify(metrics, null, 2) }, "application/json");
      entries.push({ name: "custos-e-tempo.json", kind: "cost_report", objectKey: costKey });
      await ctx.progress(0.5, "calculando hashes e montando pacote");
      const files: DeliveryPackage["files"] = [];
      const localFiles: { path: string; name: string }[] = [];
      for (const e of entries) {
        const local = await ctx.tools.materialize(e.objectKey);
        files.push({ ...e, checksum: await sha256File(local), sizeBytes: (await stat(local)).size });
        localFiles.push({ path: local, name: e.name });
      }
      const zipPath = path.join(tmp, "pacote.zip");
      await zipFiles(zipPath, localFiles);
      const zipKey = await ctx.tools.storeProjectFile(`delivery/${renderId}/pacote-entrega.zip`, { path: zipPath }, "application/zip");
      files.push({ name: "pacote-entrega.zip", kind: "zip", objectKey: zipKey, checksum: await sha256File(zipPath), sizeBytes: (await stat(zipPath)).size });
      const pkg: DeliveryPackage = {
        renderId,
        files,
        publishCaption: publish,
        hashtags: script?.payload.hashtags ?? [],
        ctaText: script?.payload.variants[0]?.ctaText ?? "",
        costReport: { aiCents: metrics.aiCents, renderCents: metrics.renderCents, totalCents: metrics.totalCents, byAgent: metrics.byAgent },
        timeReport: { totalMs: metrics.totalMs, byStage: metrics.byStageMs },
        agents: metrics.agents,
        publishing: "not_published",
      };
      const art = await ctx.tools.createArtifact("delivery_package", pkg, { objectKey: zipKey });
      return { summary: `pacote com ${files.length} arquivo(s) pronto para aprovação final (não publicado)`, outputRefs: [{ type: "delivery_package", id: art.id, version: art.version }], model: "heuristic-v1" };
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  },
};
