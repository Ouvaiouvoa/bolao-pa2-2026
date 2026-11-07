export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
        <rect width="28" height="28" rx="7" fill="#FF5A1F" />
        <path d="M8 19V9l6 5 6-5v10" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {!compact && (
        <div className="leading-tight">
          <div className="text-[13px] font-extrabold tracking-wide text-ink-100">CORE Motion Factory</div>
          <div className="text-[10px] font-semibold tracking-[0.18em] text-ink-400 uppercase">by HAXIS Core</div>
        </div>
      )}
    </div>
  );
}
