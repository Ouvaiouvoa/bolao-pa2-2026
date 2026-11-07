import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CORE Motion Factory", template: "%s · CORE Motion Factory" },
  description: "Linha de produção audiovisual multiagente governada — by HAXIS Core",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
