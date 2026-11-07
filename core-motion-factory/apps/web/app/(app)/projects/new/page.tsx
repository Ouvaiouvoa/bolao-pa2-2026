import { desc, eq } from "drizzle-orm";
import { tables } from "@cmf/db";
import { TEMPLATES } from "@cmf/templates";
import { NewProjectWizard } from "@/components/new-project-wizard";
import { requireUserPage } from "@/lib/server/auth";
import { db } from "@/lib/server/db";

export const metadata = { title: "Novo projeto" };

export default async function NewProjectPage() {
  const user = await requireUserPage("project.create");
  const brands = await db().select({ id: tables.brands.id, name: tables.brands.name, defaultTemplateId: tables.brands.defaultTemplateId }).from(tables.brands).where(eq(tables.brands.organizationId, user.organizationId)).orderBy(desc(tables.brands.updatedAt));
  return <NewProjectWizard brands={brands} templates={TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, status: t.status, objectives: t.objectives }))} />;
}
