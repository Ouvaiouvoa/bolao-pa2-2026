import { can, PERMISSIONS, ROLE_LABELS } from "@cmf/schemas";
import { AppNav } from "@/components/app-nav";
import { BrandMark } from "@/components/brand-mark";
import { requireUserPage } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUserPage();
  return (
    <div className="grid min-h-screen grid-cols-[232px_1fr]">
      <aside className="sticky top-0 flex h-screen flex-col border-r border-ink-700 bg-ink-950">
        <div className="border-b border-ink-700 px-4 py-4">
          <BrandMark />
        </div>
        <AppNav permissions={PERMISSIONS.filter((p) => can(user.role, p))} user={{ name: user.name, role: ROLE_LABELS[user.role], org: user.organizationName }} />
      </aside>
      <div className="flex min-w-0 flex-col">
        <main className="min-w-0 flex-1 p-6">{children}</main>
        <footer className="border-t border-ink-800 px-6 py-3 text-center text-[11px] tracking-[0.2em] text-ink-500 uppercase">CORE Motion Factory · by HAXIS Core</footer>
      </div>
    </div>
  );
}
