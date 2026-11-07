import { TEMPLATES } from "@cmf/templates";
import { BrandForm } from "@/components/brand-form";
import { requireUserPage } from "@/lib/server/auth";

export const metadata = { title: "Nova marca" };

export default async function NewBrandPage() {
  await requireUserPage("brand.manage");
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <h1 className="text-2xl font-extrabold">Nova marca</h1>
      <BrandForm templates={TEMPLATES} canManage />
    </div>
  );
}
