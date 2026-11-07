import { BrandMark } from "@/components/brand-mark";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,rgba(255,90,31,0.12),transparent_60%)] px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <BrandMark />
        </div>
        {children}
        <p className="mt-8 text-center text-xs text-ink-500">Produzir melhor, mais rápido e com evidência.</p>
      </div>
    </main>
  );
}
