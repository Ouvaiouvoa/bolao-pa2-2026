import { desc, eq } from "drizzle-orm";
import { tables } from "@cmf/db";
import { getProject, patchTranscript } from "@cmf/orchestration";
import { TranscriptPatchRequest } from "@cmf/schemas";
import { actor, body, route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route<{ id: string }>("project.view", async ({ params, user }) => {
  const p = await getProject(db(), user.organizationId, params.id);
  const rows = await db().select().from(tables.transcripts).where(eq(tables.transcripts.projectId, p.id)).orderBy(desc(tables.transcripts.version));
  return rows.map((t) => ({ id: t.id, assetId: t.assetId, version: t.version, language: t.language, provider: t.provider, model: t.model, confidence: t.confidence, editedBy: t.editedBy, words: t.wordsJson, segments: t.segmentsJson, createdAt: t.createdAt.toISOString() }));
});

export const PATCH = route<{ id: string }>("transcript.edit", async ({ req, params, user }) => {
  const input = await body(req, TranscriptPatchRequest);
  return patchTranscript(db(), actor(user), params.id, input);
});
