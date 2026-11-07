import { z } from "zod";
import { eq } from "drizzle-orm";
import { tables } from "@cmf/db";
import { body, route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

const Settings = z.strictObject({
  ai: z.strictObject({ allowExternalProviders: z.boolean(), allowTrainingOnCustomerData: z.literal(false) }),
  retentionDays: z.number().int().min(30).max(3650),
  baselineManualMinutesPerVideo: z.number().int().min(0).max(10_000).nullable().default(null),
});

export const GET = route("org.manage", async ({ user }) => {
  const [o] = await db().select().from(tables.organizations).where(eq(tables.organizations.id, user.organizationId));
  return {
    name: o!.name,
    plan: o!.plan,
    settings: o!.settingsJson,
    providers: {
      asr: process.env.CMF_ASR_PROVIDER ?? "sherpa-local",
      llmConfigured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
      llmModel: process.env.CMF_LLM_MODEL ?? "claude-opus-5-5",
      llmSmallModel: process.env.CMF_LLM_MODEL_SMALL ?? "claude-haiku-5-5",
      storage: process.env.CMF_STORAGE_DRIVER ?? "local",
    },
  };
});

export const PATCH = route("org.manage", async ({ req, user }) => {
  const settings = await body(req, Settings);
  await db().update(tables.organizations).set({ settingsJson: settings }).where(eq(tables.organizations.id, user.organizationId));
  return { ok: true };
});
