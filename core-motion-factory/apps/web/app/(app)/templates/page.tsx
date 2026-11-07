import { OBJECTIVE_LABELS } from "@cmf/schemas";
import { TEMPLATES } from "@cmf/templates";
import { Badge, Card } from "@/components/ui";
import { requireUserPage } from "@/lib/server/auth";

export const metadata = { title: "Templates" };

export default async function TemplatesPage() {
  await requireUserPage();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold">Biblioteca de templates</h1>
        <p className="text-sm text-ink-400">Templates são regras de layout e ritmo consumidas pelos agentes — a composição continua editável. Status honesto: só “disponível” tem frames de referência validados.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {TEMPLATES.map((t) => (
          <Card key={t.id} title={t.name} actions={<Badge tone={t.status === "available" ? "ok" : t.status === "beta" ? "info" : "neutral"}>{t.status === "available" ? "disponível" : t.status === "beta" ? "beta" : "planejado"}</Badge>}>
            <p className="text-sm text-ink-300">{t.description}</p>
            <div className="mt-2 flex flex-wrap gap-1">{t.objectives.map((o) => <Badge key={o}>{OBJECTIVE_LABELS[o]}</Badge>)}</div>
            <div className="mt-2 text-xs text-ink-400">Legendas {t.captionPreset} · cortes em pausas &gt; {t.pacing.removePausesOverMs}ms · formatos {Object.keys(t.layouts).join(", ") || "—"}{t.hasReferenceFrames ? " · frames de referência ✓" : ""}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
