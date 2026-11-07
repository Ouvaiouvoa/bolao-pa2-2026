"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorText } from "@/lib/client/api";
import { Button, ErrorBox, Field, Input } from "./ui";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await api("/api/auth/login", { body: { email: f.get("email"), password: f.get("password") } });
      else await api("/api/auth/signup", { body: { organizationName: f.get("organizationName"), name: f.get("name"), email: f.get("email"), password: f.get("password") } });
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-ink-700 bg-ink-850 p-6 shadow-2xl">
      <h1 className="text-lg font-extrabold">{mode === "login" ? "Entrar" : "Criar organização"}</h1>
      {mode === "signup" && (
        <>
          <Field label="Organização">
            <Input name="organizationName" required minLength={2} placeholder="Ex.: HAXIS Core" />
          </Field>
          <Field label="Seu nome">
            <Input name="name" required minLength={2} />
          </Field>
        </>
      )}
      <Field label="E-mail">
        <Input name="email" type="email" required autoComplete="email" />
      </Field>
      <Field label="Senha" hint={mode === "signup" ? "mínimo de 10 caracteres" : undefined}>
        <Input name="password" type="password" required minLength={mode === "signup" ? 10 : 1} autoComplete={mode === "login" ? "current-password" : "new-password"} />
      </Field>
      {error && <ErrorBox>{error}</ErrorBox>}
      <Button variant="primary" type="submit" disabled={busy}>
        {busy ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar e entrar"}
      </Button>
      <p className="text-center text-sm text-ink-400">
        {mode === "login" ? (
          <>
            Nova organização? <Link className="text-haxis-400 hover:underline" href="/signup">Criar conta</Link>
          </>
        ) : (
          <>
            Já tem conta? <Link className="text-haxis-400 hover:underline" href="/login">Entrar</Link>
          </>
        )}
      </p>
    </form>
  );
}
