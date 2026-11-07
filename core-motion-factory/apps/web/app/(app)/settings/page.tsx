import { asc, eq } from "drizzle-orm";
import { tables } from "@cmf/db";
import { SettingsForm } from "@/components/settings-form";
import { requireUserPage } from "@/lib/server/auth";
import { db } from "@/lib/server/db";

export const metadata = { title: "Configurações" };

export default async function SettingsPage() {
  const user = await requireUserPage("org.manage");
  const [org] = await db().select().from(tables.organizations).where(eq(tables.organizations.id, user.organizationId));
  const users = await db().select().from(tables.users).where(eq(tables.users.organizationId, user.organizationId)).orderBy(asc(tables.users.createdAt));
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <h1 className="text-2xl font-extrabold">Configurações · {org!.name}</h1>
      <SettingsForm
        settings={org!.settingsJson as never}
        providers={{ asr: process.env.CMF_ASR_PROVIDER ?? "sherpa-local", llmConfigured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN), llmModel: process.env.CMF_LLM_MODEL ?? "claude-opus-5-5", llmSmallModel: process.env.CMF_LLM_MODEL_SMALL ?? "claude-haiku-5-5", storage: process.env.CMF_STORAGE_DRIVER ?? "local" }}
        users={users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status }))}
      />
    </div>
  );
}
