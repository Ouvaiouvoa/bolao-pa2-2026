import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3">
      <h1 className="text-2xl font-extrabold">Não encontrado</h1>
      <p className="text-ink-400">O recurso não existe ou pertence a outra organização.</p>
      <Link className="text-haxis-400" href="/">Voltar ao Command Center</Link>
    </main>
  );
}
