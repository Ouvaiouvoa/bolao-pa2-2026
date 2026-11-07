import { notFound } from "next/navigation";
import { NotFoundError } from "@cmf/orchestration";
import { LiveOffice } from "@/components/office/live-office";
import { requireUserPage } from "@/lib/server/auth";
import { loadProjectSnapshot } from "@/lib/server/queries";

export const metadata = { title: "Escritório vivo" };

export default async function OfficePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUserPage("project.view");
  try {
    return <LiveOffice initial={await loadProjectSnapshot(user, id)} />;
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}
