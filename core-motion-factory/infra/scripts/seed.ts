/**
 * npm run db:seed — development data: one organization, one user per role and a brand.
 * Never run against production (refuses when NODE_ENV=production).
 */
import { closeDb, getDb, runMigrations } from "@cmf/db";
import { createBrand, createUser, signupOrganization } from "@cmf/orchestration";
import { CreateBrandRequest, DEFAULT_BRAND_TOKENS, ROLES } from "@cmf/schemas";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("seed não roda em produção");
  await runMigrations();
  const db = getDb();
  const password = process.env.CMF_SEED_PASSWORD ?? "haxis-core-dev-123";
  const { organizationId, userId } = await signupOrganization(db, { organizationName: "HAXIS Core (dev)", name: "Admin HAXIS", email: "admin@haxis.dev", password });
  for (const role of ROLES.filter((r) => r !== "admin")) await createUser(db, organizationId, { name: `Usuário ${role}`, email: `${role}@haxis.dev`, role, password });
  const brandId = await createBrand(db, { id: userId, organizationId, role: "admin" }, CreateBrandRequest.parse({ name: "HAXIS Core", brandTokens: DEFAULT_BRAND_TOKENS, toneRules: { voice: "claro, técnico e direto", hashtags: ["haxiscore"] } }));
  console.log(`organização ${organizationId}, marca ${brandId}`);
  console.log(`usuários: admin@haxis.dev, ${ROLES.filter((r) => r !== "admin").map((r) => `${r}@haxis.dev`).join(", ")} — senha: ${password}`);
  await closeDb();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
