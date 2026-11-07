"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-extrabold">Algo deu errado</h1>
      <p className="text-sm text-ink-400">O erro foi registrado{error.digest ? ` (ref ${error.digest})` : ""}. Nenhum detalhe técnico é exibido por segurança.</p>
      <button className="rounded-lg bg-haxis-500 px-4 py-2 text-sm font-semibold text-white" onClick={reset}>Tentar novamente</button>
    </main>
  );
}
