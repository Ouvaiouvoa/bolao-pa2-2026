"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cx } from "./ui";

const ITEMS = [
  { href: "/", label: "Command Center", icon: "◉" },
  { href: "/projects", label: "Projetos", icon: "▶" },
  { href: "/projects/new", label: "Novo projeto", icon: "+" },
  { href: "/brands", label: "Marcas", icon: "◆" },
  { href: "/templates", label: "Templates", icon: "▦" },
  { href: "/analytics", label: "Analytics", icon: "▤", perm: "analytics.view" },
  { href: "/settings", label: "Configurações", icon: "⚙", perm: "org.manage" },
];

export function AppNav({ permissions, user }: { permissions: string[]; user: { name: string; role: string; org: string } }) {
  const path = usePathname();
  const router = useRouter();
  return (
    <nav className="flex h-full flex-col gap-1 p-3" aria-label="Navegação principal">
      {ITEMS.filter((i) => !i.perm || permissions.includes(i.perm)).map((i) => {
        const active = i.href === "/" ? path === "/" : path === i.href || (path.startsWith(i.href + "/") && i.href !== "/projects") || (i.href === "/projects" && path.startsWith("/projects/") && !path.startsWith("/projects/new"));
        return (
          <Link key={i.href} href={i.href} className={cx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition", active ? "bg-ink-700 text-ink-100" : "text-ink-300 hover:bg-ink-800 hover:text-ink-100")}>
            <span className={cx("w-4 text-center", active && "text-haxis-500")}>{i.icon}</span>
            {i.label}
          </Link>
        );
      })}
      <div className="mt-auto rounded-lg border border-ink-700 p-3 text-xs">
        <div className="font-semibold text-ink-100">{user.name}</div>
        <div className="text-ink-400">{user.role} · {user.org}</div>
        <button
          className="mt-2 text-haxis-400 hover:underline"
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            router.push("/login");
            router.refresh();
          }}
        >
          Sair
        </button>
      </div>
    </nav>
  );
}
