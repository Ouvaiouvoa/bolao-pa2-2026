export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando">
      <div className="h-8 w-64 animate-pulse rounded bg-ink-800" />
      <div className="grid grid-cols-4 gap-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-ink-850" />)}</div>
      <div className="h-80 animate-pulse rounded-xl bg-ink-850" />
    </div>
  );
}
