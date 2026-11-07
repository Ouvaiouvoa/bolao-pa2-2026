/**
 * npm run pipeline:fixture — end-to-end headless run on the real fixture:
 * upload → ingest → transcription → analysis → (brief approval) → script → (script approval)
 * → assembly → compliance hold (human decision) → preview → review comment (cut) → revision
 * → preview v2 → approval → master → QA → master approval → delivered.
 */
import { getDb, closeDb, tables } from "@cmf/db";
import { closeRedis, getStageQueue } from "@cmf/orchestration";
import { eq } from "drizzle-orm";
import { approve, createComment, createFixtureProject, latestArtifact, latestPreview, requestFinalRender, requestRevision, setupTenant, startInProcessWorker, startProject, waitForState } from "../../tests/support/pipeline";

async function main() {
  const db = getDb();
  const t0 = Date.now();
  const worker = startInProcessWorker((e) => console.error("job falhou:", e.message));
  const { user, brandId } = await setupTenant(db);
  const projectId = await createFixtureProject(db, user, brandId);
  console.log(`projeto ${projectId}`);
  const tick = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);
  await startProject(db, user, projectId);
  await waitForState(db, user, projectId, ["AWAITING_BRIEF_APPROVAL"], undefined, tick);
  await approve(db, user, projectId, "brief", "briefing ok");
  await waitForState(db, user, projectId, ["AWAITING_SCRIPT_APPROVAL"], undefined, tick);
  const script = await latestArtifact<{ variants: { hookTitle: string; beats: { kind: string; text: string }[] }[] }>(db, projectId, "script");
  console.log("roteiro:", script?.payload.variants[0]?.hookTitle, "\n  " + script?.payload.variants[0]?.beats.map((b) => `${b.kind}: ${b.text}`).join("\n  "));
  await approve(db, user, projectId, "script", "roteiro ok");
  // Drives until one of `states`, answering compliance holds as a human reviewer would.
  const until = async (states: Parameters<typeof waitForState>[3]) => {
    for (;;) {
      const s = await waitForState(db, user, projectId, states, undefined, tick);
      if (!String(s).includes("hold:compliance")) return s;
      const rep = await latestArtifact<{ findings: { severity: string; text: string; rule: string }[] }>(db, projectId, "compliance_report");
      console.log("compliance:", rep?.payload.findings.map((f) => `${f.severity} ${f.rule}: ${f.text}`).join(" | "));
      await approve(db, user, projectId, "compliance_report", "alegação revisada pelo jurídico; mantida com ressalva");
    }
  };
  await until(["IN_REVIEW"]);
  const preview = await latestPreview(db, projectId);
  console.log(`preview v1: ${preview.id} ${(preview.durationMs! / 1000).toFixed(1)}s`);
  await createComment(db, user, preview.id, { timecodeMs: 3000, endTimecodeMs: 4200, kind: "cut", body: "remover este trecho", replacement: null, parentId: null });
  await requestRevision(db, user, projectId, "cortar trecho e reapresentar");
  await until(["IN_REVIEW"]);
  const preview2 = await latestPreview(db, projectId);
  console.log(`preview v2: ${preview2.id} ${(preview2.durationMs! / 1000).toFixed(1)}s`);
  await approve(db, user, projectId, "render_preview", "preview aprovado");
  await requestFinalRender(db, user, projectId);
  const end = await until(["READY_TO_DELIVER", "BLOCKED"]);
  const qa = await latestArtifact<{ score: number; band: string; blockers: string[]; alerts: string[] }>(db, projectId, "qa_report");
  console.log(`QA: ${qa?.payload.score} ${qa?.payload.band}`, qa?.payload.blockers, qa?.payload.alerts);
  if (end === "READY_TO_DELIVER") {
    await approve(db, user, projectId, "render_master", "master aprovado");
    await waitForState(db, user, projectId, ["DELIVERED"], undefined, tick);
  }
  const runs = await db.select().from(tables.agentRuns).where(eq(tables.agentRuns.projectId, projectId));
  console.log(`agentes: ${runs.length} execuções (${runs.filter((r) => r.status === "cached").length} reaproveitadas)`);
  console.log(`total ${((Date.now() - t0) / 1000).toFixed(0)}s — estado final ${end === "READY_TO_DELIVER" ? "DELIVERED" : end}`);
  await worker.close();
  await getStageQueue().close();
  await closeRedis();
  await closeDb();
  if (end !== "READY_TO_DELIVER") process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
