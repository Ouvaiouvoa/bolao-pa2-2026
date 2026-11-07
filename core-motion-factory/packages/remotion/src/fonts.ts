import { useEffect, useState } from "react";
import { cancelRender, continueRender, delayRender } from "remotion";
import type { RenderFont } from "./types";

const loaded = new Map<string, Promise<void>>();

function loadOne(f: RenderFont): Promise<void> {
  const key = `${f.family}|${f.weight}|${f.style}|${f.url}`;
  let p = loaded.get(key);
  if (!p) {
    p = (async () => {
      const face = new FontFace(f.family, `url(${JSON.stringify(f.url)}) format("woff2")`, { weight: String(f.weight), style: f.style });
      await face.load();
      document.fonts.add(face);
    })();
    loaded.set(key, p);
  }
  return p;
}

/**
 * Loads every brand font before the first frame is captured. A missing/broken font cancels the
 * render with an explicit FONT_MISSING error — never a silent fallback to a system font.
 */
export function useBrandFonts(fonts: RenderFont[], requiredFamilies: string[]): boolean {
  const [handle] = useState(() => delayRender("Carregando fontes da marca", { timeoutInMilliseconds: 30_000 }));
  const [ready, setReady] = useState(false);
  const key = JSON.stringify([fonts, requiredFamilies]);
  useEffect(() => {
    let cancelled = false;
    const missing = requiredFamilies.filter((fam) => !fonts.some((f) => f.family === fam));
    if (missing.length) {
      cancelRender(new Error(`FONT_MISSING: nenhum arquivo de fonte para ${missing.join(", ")}`));
      return;
    }
    Promise.all(fonts.map(loadOne))
      .then(() => {
        if (cancelled) return;
        setReady(true);
        continueRender(handle);
      })
      .catch((err: Error) => cancelRender(new Error(`FONT_MISSING: falha ao carregar fonte (${err.message})`)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, handle]);
  return ready;
}
