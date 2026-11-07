import { notFound } from "next/navigation";
import { NotFoundError } from "@cmf/orchestration";
import { ProductionRoom } from "@/components/production/production-room";
import { requireUserPage } from "@/lib/server/auth";
import { loadProjectSnapshot } from "@/lib/server/queries";

export const metadata = { title: "Sala de Produção" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUserPage("project.view");
  try {
    const snap = await loadProjectSnapshot(user, id);
    return <ProductionRoom initial={snap} />;
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}
