"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ROLE_LABELS, ROLES, type Role } from "@cmf/schemas";
import { api, errorText } from "@/lib/client/api";
import { Badge, Button, Card, ErrorBox, Field, Input, Select } from "./ui";

interface Props {
  settings: { ai?: { allowExternalProviders?: boolean }; retentionDays?: number; baselineManualMinutesPerVideo?: number | null };
  providers: { asr: string; llmConfigured: boolean; llmModel: string; llmSmallModel: string; storage: string };
  users: { id: string; name: string; email: string; role: string; status: string }[];
}

export function SettingsForm({ settings, providers, users }: Props) {
  const router = useRouter();
  const [allowExternal, setAllowExternal] = useState(Boolean(settings.ai?.allowExternalProviders));
  const [retention, setRetention] = useState(settings.retentionDays ?? 365);
  const [baseline, setBaseline] = useState<string>(settings.baselineManualMinutesPerVideo?.toString() ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nu, setNu] = useState({ name: "", email: "", role: "editor" as Role, password: "" });
  async function saveSettings() {
    setError(null);
    try {
      await api("/api/org/settings", { method: "PATCH", body: { ai: { allowExternalProviders: allowExternal, allowTrainingOnCustomerData: false }, retentionDays: Number(retention), baselineManualMinutesPerVideo: baseline ? Number(baseline) : null } });
      setMsg("Configurações salvas.");
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    }
  }
  async function addUser() {
    setError(null);
    try {
      await api("/api/users", { body: nu, idempotent: true });
      setNu({ name: "", email: "", role: "editor", password: "" });
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Política de IA e dados">
        <div className="flex flex-col gap-3 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={allowExternal} onChange={(e) => setAllowExternal(e.target.checked)} /> Permitir provedores externos de IA (LLM/ASR fora da infraestrutura)</label>
          <p className="text-xs text-ink-400">Treinamento com dados do cliente: sempre proibido. Sem esta permissão, os agentes usam apenas o motor determinístico e a transcrição local.</p>
          <Field label="Retenção de mídia (dias)"><Input type="number" value={retention} onChange={(e) => setRetention(Number(e.target.value))} /></Field>
          <Field label="Linha de base medida do processo manual (min/vídeo)" hint="usada para estimar economia; vazio = nenhuma economia é declarada"><Input type="number" value={baseline} onChange={(e) => setBaseline(e.target.value)} /></Field>
          <Button variant="primary" onClick={saveSettings}>Salvar</Button>
          {msg && <span className="text-ok-500">{msg}</span>}
        </div>
      </Card>
      <Card title="Provedores (sem segredos expostos)">
        <ul className="flex flex-col gap-2 text-sm">
          <li>Transcrição: <Badge>{providers.asr}</Badge></li>
          <li>LLM: <Badge tone={providers.llmConfigured ? "ok" : "neutral"}>{providers.llmConfigured ? "chave configurada no cofre" : "não configurado (heuristic-v1)"}</Badge> <span className="text-xs text-ink-400">{providers.llmModel} / {providers.llmSmallModel}</span></li>
          <li>Storage: <Badge>{providers.storage}</Badge></li>
        </ul>
      </Card>
      <Card title="Usuários e permissões" className="lg:col-span-2">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-400"><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Status</th></tr></thead>
          <tbody>{users.map((u) => <tr key={u.id} className="border-t border-ink-800"><td className="py-1">{u.name}</td><td>{u.email}</td><td>{ROLE_LABELS[u.role as Role] ?? u.role}</td><td>{u.status}</td></tr>)}</tbody>
        </table>
        <div className="mt-4 grid gap-3 sm:grid-cols-5">
          <Input placeholder="Nome" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} />
          <Input placeholder="E-mail" type="email" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} />
          <Select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select>
          <Input placeholder="Senha inicial (≥10)" type="password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} />
          <Button onClick={addUser} disabled={nu.password.length < 10 || !nu.email}>Adicionar</Button>
        </div>
        {error && <div className="mt-2"><ErrorBox>{error}</ErrorBox></div>}
      </Card>
    </div>
  );
}
