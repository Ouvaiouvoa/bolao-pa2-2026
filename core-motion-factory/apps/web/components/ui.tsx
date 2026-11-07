import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

export function Button({ variant = "secondary", size = "md", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" | "success"; size?: "sm" | "md" }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
        variant === "primary" && "bg-haxis-500 text-white hover:bg-haxis-400",
        variant === "secondary" && "border border-ink-600 bg-ink-800 text-ink-100 hover:border-ink-500 hover:bg-ink-700",
        variant === "ghost" && "text-ink-300 hover:bg-ink-800 hover:text-ink-100",
        variant === "danger" && "bg-bad-500/90 text-white hover:bg-bad-500",
        variant === "success" && "bg-ok-500/90 text-ink-950 hover:bg-ok-500",
        className,
      )}
    />
  );
}

export function Card({ title, actions, children, className, dense }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; dense?: boolean }) {
  return (
    <section className={cx("rounded-xl border border-ink-700 bg-ink-850", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-ink-700 px-4 py-2.5">
          <h2 className="text-xs font-semibold tracking-wider text-ink-300 uppercase">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={dense ? "p-2" : "p-4"}>{children}</div>
    </section>
  );
}

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "ok" | "warn" | "bad" | "info" | "accent"; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        tone === "neutral" && "bg-ink-700 text-ink-200",
        tone === "ok" && "bg-ok-500/15 text-ok-500",
        tone === "warn" && "bg-warn-500/15 text-warn-500",
        tone === "bad" && "bg-bad-500/15 text-bad-500",
        tone === "info" && "bg-info-500/15 text-info-500",
        tone === "accent" && "bg-haxis-500/15 text-haxis-400",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Field({ label, hint, children, error }: { label: string; hint?: string; children: ReactNode; error?: string | null }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-ink-200">{label}</span>
      {children}
      {hint && !error && <span className="text-xs text-ink-400">{hint}</span>}
      {error && <span className="text-xs text-bad-500">{error}</span>}
    </label>
  );
}

const inputCls = "h-10 rounded-lg border border-ink-600 bg-ink-900 px-3 text-sm text-ink-100 placeholder:text-ink-500 focus:border-haxis-500 focus:outline-none";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, "h-auto min-h-24 py-2", props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, props.className)} />;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
      <div className="text-xs font-medium tracking-wider text-ink-400 uppercase">{label}</div>
      <div className="mt-1 text-2xl font-extrabold text-ink-100 tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-400">{hint}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink-600 p-8 text-center">
      <div className="text-sm font-semibold text-ink-200">{title}</div>
      {children && <div className="text-sm text-ink-400">{children}</div>}
    </div>
  );
}

export function Progress({ value, tone = "accent" }: { value: number; tone?: "accent" | "ok" | "bad" }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-700" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx("h-full rounded-full transition-[width]", tone === "accent" && "bg-haxis-500", tone === "ok" && "bg-ok-500", tone === "bad" && "bg-bad-500")} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-bad-500/40 bg-bad-500/10 px-3 py-2 text-sm text-bad-500" role="alert">{children}</div>;
}

export function cents(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `US$ ${(v / 100).toFixed(v < 100 ? 3 : 2)}`;
}

export function ms(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  if (v < 1000) return `${Math.round(v)} ms`;
  if (v < 60_000) return `${(v / 1000).toFixed(1)} s`;
  return `${Math.floor(v / 60000)} min ${Math.round((v % 60000) / 1000)} s`;
}
