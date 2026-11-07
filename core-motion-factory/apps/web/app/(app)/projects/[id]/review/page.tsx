import { notFound } from "next/navigation";
import { NotFoundError } from "@cmf/orchestration";
import { ReviewRoom } from "@/components/review/review-room";
import { requireUserPage } from "@/lib/server/auth";
import { loadProjectSnapshot } from "@/lib/server/queries";

export const metadata = { title: "Review" };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUserPage("project.view");
  try {
    return <ReviewRoom initial={await loadProjectSnapshot(user, id)} />;
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}
