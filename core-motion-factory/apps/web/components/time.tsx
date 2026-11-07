"use client";
import { useEffect, useState } from "react";
import { ms } from "./ui";

/** Locale-formatted time rendered only on the client (server and browser clocks/ICU may differ). */
export function LocalTime({ iso, variant = "datetime" }: { iso: string; variant?: "datetime" | "time" }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const d = new Date(iso);
    setText(variant === "time" ? d.toLocaleTimeString("pt-BR") : d.toLocaleString("pt-BR"));
  }, [iso, variant]);
  return <time dateTime={iso}>{text ?? iso.slice(0, 16).replace("T", " ")}</time>;
}

/** Live elapsed time since `since`, ticking every second on the client. */
export function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span>{now === null ? "—" : ms(now - new Date(since).getTime())}</span>;
}
