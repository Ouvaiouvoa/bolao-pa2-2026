/** Portuguese-aware text utilities used by the deterministic agents. */

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function normalize(s: string): string {
  return stripAccents(s.toLowerCase()).replace(/[^\p{L}\p{N}%\s]/gu, " ").replace(/\s+/g, " ").trim();
}

export const STOPWORDS_PT = new Set(
  "a o as os um uma uns umas de do da dos das em no na nos nas por pelo pela pelos pelas para pra com sem e ou mas que se como ao aos à às é eu tu ele ela nós vós eles elas me te lhe nos vos lhes meu minha seu sua seus suas nosso nossa isso isto aquilo esse essa este esta aquele aquela já não sim muito mais menos também só então ser estar ter foi era são está estão tem vai vou aqui ali lá onde quando qual quais quem porque pois até sobre entre depois antes cada mesmo todo toda todos todas".split(
    " ",
  ).map((w) => stripAccents(w)),
);

/** Filler words / disfluencies (clarity penalty). */
export const FILLERS_PT = new Set(["hum", "hmm", "ahn", "ah", "eh", "tipo", "ne", "entao", "assim", "bom", "enfim", "deixa", "comecar", "novo"].map(stripAccents));
const FALSE_START = /\b(deixa eu comecar de novo|vou comecar de novo|corta|de novo|errei|espera)\b/;

export function tokenize(s: string): string[] {
  return normalize(s).split(" ").filter(Boolean);
}

/** Very light stemmer — enough for keyword overlap in PT-BR. */
export function stem(word: string): string {
  let w = stripAccents(word.toLowerCase());
  for (const suf of ["amentos", "imentos", "amento", "imento", "acoes", "icoes", "acao", "icao", "mente", "idade", "ismo", "ista", "veis", "vel", "oes", "aes", "ais", "eis", "res", "es", "s"]) {
    if (w.length > suf.length + 3 && w.endsWith(suf)) {
      w = w.slice(0, -suf.length);
      break;
    }
  }
  return w;
}

export function contentStems(s: string): string[] {
  return tokenize(s)
    .filter((t) => !STOPWORDS_PT.has(t) && t.length > 2)
    .map(stem);
}

export function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export function isFalseStart(s: string): boolean {
  return FALSE_START.test(normalize(s));
}

export function fillerRatio(s: string): number {
  const t = tokenize(s);
  if (!t.length) return 0;
  return t.filter((w) => FILLERS_PT.has(w)).length / t.length;
}

const NUMBER_WORDS = new Set(
  "um uma dois duas tres quatro cinco seis sete oito nove dez onze doze vinte trinta quarenta cinquenta cem cento mil milhao milhoes metade dobro triplo primeiro segundo terceiro".split(" "),
);

export function hasNumber(s: string): boolean {
  return /\d/.test(s) || tokenize(s).some((t) => NUMBER_WORDS.has(t));
}

/** Words that tend to carry emotion/intensity in PT-BR speech. */
const EMOTION_WORDS = new Set(
  "incrivel nunca sempre erro erros segredo cuidado atencao perder ganha ganhar medo amor odeio adoro problema problemas rapido simples facil dificil verdade importante abandonam abandona confianca resultado".split(" "),
);

export function emotionScore(s: string): number {
  const t = tokenize(s);
  if (!t.length) return 0;
  const hits = t.filter((w) => EMOTION_WORDS.has(w)).length;
  const exclam = (s.match(/[!?]/g) ?? []).length;
  return Math.min(1, hits * 0.22 + exclam * 0.18);
}

/** Hook potential: questions, numbers, "você", contrarian/curiosity patterns. */
export function hookScore(s: string): number {
  const n = normalize(s);
  let score = 0;
  if (/\?/.test(s)) score += 0.35;
  if (hasNumber(s)) score += 0.25;
  if (/\bvoce\b/.test(n)) score += 0.15;
  if (/\b(sabia|segredo|erro|erros|ninguem|pare|nunca|por que|como)\b/.test(n)) score += 0.2;
  const words = tokenize(s).length;
  if (words >= 6 && words <= 22) score += 0.1;
  return Math.min(1, score);
}

const CTA_PATTERN = /\b(comente|comenta|siga|segue|clique|clica|acesse|link|inscreva|compartilhe|salve|manda|mande|chama|fale com|baixe|garanta sua)\b/;

export function isCtaLike(s: string): boolean {
  return CTA_PATTERN.test(normalize(s));
}

/** Words that should not end a caption line (articles, prepositions, conjunctions). */
export const NO_LINE_END = new Set(
  "a o as os um uma de do da dos das em no na nos nas por pelo pela para pra com sem e ou que se ao à".split(" ").map(stripAccents),
);

/** Builds a short headline from a sentence (for the hook title overlay). */
export function headlineFrom(sentence: string, maxWords = 9): string {
  const clean = sentence.replace(/\s+/g, " ").trim().replace(/^(entao|então|e|bom|olha)[, ]+/i, "");
  const words = clean.split(" ");
  if (words.length <= maxWords) return clean;
  // Cut at a clause boundary when possible.
  const clause = clean.split(/[,;:]/)[0]!.trim();
  if (clause.split(" ").length <= maxWords && clause.split(" ").length >= 4) return clause + (/[?!.]$/.test(clause) ? "" : "…");
  return words.slice(0, maxWords).join(" ") + "…";
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
