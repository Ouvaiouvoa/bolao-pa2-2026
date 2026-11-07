import { describe, expect, it } from "vitest";
import { applyCut, assembleVideoItems, breakLines, buildCaptionPages, calloutFor, curate, evaluateQa, pagesToItems, scanCompliance, speechRanges, wordAtTimeline } from "@cmf/agents";
import { buildSegments, planChunks, tokensToWords } from "@cmf/media";
import { CaptionItemSchema, ComplianceRulesSchema, DEFAULT_BRAND_TOKENS, frameToMs, validateEditPlan, type TranscriptPayload, type TranscriptWord } from "@cmf/schemas";
import { ctx, validPlan } from "./helpers";

function transcript(sentences: [string, number][], assetId = "ast_v1"): TranscriptPayload {
  const words: TranscriptWord[] = [];
  let t = 500;
  for (const [s, pauseAfter] of sentences) {
    for (const w of s.split(" ")) {
      words.push({ text: w, startMs: t, endMs: t + 280, confidence: 0.97 });
      t += 320;
    }
    t += pauseAfter;
  }
  return { assetId, language: "pt-BR", provider: "test", model: "test", durationMs: t + 500, text: words.map((w) => w.text).join(" "), confidence: 0.97, segments: buildSegments(words), words };
}

describe("ASR word assembly", () => {
  it("merges sub-word tokens, splits digits and attaches punctuation", () => {
    const words = tokensToWords({ tokens: [" Vo", "cê", " sabia", " que", "3", " em", " 100", "%", "."], timestamps: [0, 0.1, 0.3, 0.6, 0.8, 1.0, 1.2, 1.4, 1.5], durations: [0.1, 0.1, 0.2, 0.1, 0.1, 0.1, 0.2, 0.1, 0.05] }, 1000, 3000);
    expect(words.map((w) => w.text)).toEqual(["Você", "sabia", "que", "3", "em", "100%."]);
    expect(words[0]!.startMs).toBe(1000);
  });
  it("plans chunks at silences and never exceeds the max", () => {
    const chunks = planChunks(70_000, [{ startMs: 20_000, endMs: 21_000 }, { startMs: 44_000, endMs: 45_000 }], 25_000);
    expect(chunks[0]!.endMs).toBe(20_500);
    for (const c of chunks) expect(c.endMs - c.startMs).toBeLessThanOrEqual(25_000);
    expect(chunks[chunks.length - 1]!.endMs).toBe(70_000);
  });
});

describe("Curador", () => {
  const t = transcript([
    ["Hum, deixa eu começar de novo.", 900],
    ["Você sabia que três em cada quatro pessoas abandonam um vídeo?", 1000],
    ["Você sabia que três em cada quatro pessoas abandonam um vídeo?", 800],
    ["O primeiro erro é começar sem um gancho claro.", 700],
    ["Então comente a palavra roteiro aqui embaixo.", 500],
  ]);
  const sel = curate({ transcripts: [t], direction: { keywords: ["gancho", "video", "roteiro"], targetDurationSec: { min: 5, max: 60, ideal: 20 } } });
  it("rejects false starts and keeps the later retake", () => {
    expect(sel.candidates[0]!.rejectedReason).toMatch(/falso início/);
    expect(sel.candidates[1]!.duplicateOf).toBe(sel.candidates[2]!.id);
    expect(sel.candidates[2]!.selected).toBe(true);
  });
  it("assigns hook and CTA roles with justification", () => {
    expect(sel.candidates.find((c) => c.role === "hook")?.text).toMatch(/sabia/);
    expect(sel.candidates.find((c) => c.role === "cta")?.text).toMatch(/comente/);
    for (const c of sel.candidates.filter((x) => x.selected)) expect(c.reasons.length).toBeGreaterThan(0);
  });
});

describe("Editor", () => {
  const t = transcript([["um dois três", 1200], ["quatro cinco", 300]]);
  const variant = { id: "A" as const, hookTitle: "x", hookEmphasis: [], ctaText: "c", estimatedDurationSec: 3, rationale: "", beats: [{ id: "beat_01", kind: "hook" as const, selectId: "s", assetId: "ast_v1", startMs: t.words[0]!.startMs, endMs: t.words[4]!.endMs, text: "", onScreenText: null }] };
  const pacing = { removePausesOverMs: 500, cutPaddingMs: 80, punchInEveryNthCut: 2, punchInScale: 1.12 };
  it("creates intentional jump cuts on long pauses with frame-exact sources", () => {
    const items = assembleVideoItems(variant, new Map([["ast_v1", t]]), new Map([["ast_v1", { durationMs: 10_000, framing: null }]]), 30, pacing);
    expect(items).toHaveLength(2);
    expect(items[1]!.fromFrame).toBe(items[0]!.durationInFrames);
    expect(items[1]!.transform.scale).toBe(1.12);
    for (const i of items) {
      expect(Math.abs((i.sourceEndMs - i.sourceStartMs) - frameToMs(i.durationInFrames, 30))).toBeLessThan(0.01);
      expect(Math.abs(((i.sourceStartMs * 30) / 1000) - Math.round((i.sourceStartMs * 30) / 1000))).toBeLessThan(1e-3);
    }
  });
  it("splits a clip that crosses a scene change so each part keeps its reframing", () => {
    const framing = { focusX: 0.5, focusY: 0.5, method: "t", confidence: 1, segments: [{ startMs: 0, endMs: 900, focusX: 0.3, focusY: 0.5, confidence: 1 }, { startMs: 900, endMs: 10_000, focusX: 0.7, focusY: 0.5, confidence: 1 }] };
    const items = assembleVideoItems({ ...variant, beats: [{ ...variant.beats[0]!, endMs: t.words[2]!.endMs }] }, new Map([["ast_v1", t]]), new Map([["ast_v1", { durationMs: 10_000, framing }]]), 30, pacing);
    expect(items.map((i) => i.focus.x)).toEqual([0.3, 0.7]);
  });
  it("ripple-cuts a range out of the video track", () => {
    const plan = validPlan();
    const video = plan.tracks[0]!;
    const out = applyCut(video.items as never, 100, 200, 30);
    expect(out.reduce((n, i) => n + i.durationInFrames, 0)).toBe(200);
    expect(out[1]!.fromFrame).toBe(100);
    expect(out[1]!.sourceStartMs).toBeCloseTo(9666.67, 1);
  });
  it("maps a timeline position to the word under it", () => {
    const plan = validPlan();
    const tr = transcript([["alpha beta gamma delta epsilon", 100]]);
    const hit = wordAtTimeline(plan, new Map([["ast_v1", { ...tr, words: tr.words.map((w, k) => ({ ...w, startMs: 1000 + k * 400, endMs: 1300 + k * 400 })) }]]), 500);
    expect(hit?.wordIndex).toBe(1);
  });
});

describe("Legendas", () => {
  it("breaks lines by units of meaning (no dangling article)", () => {
    const lines = breakLines("O segredo é falar com o público certo".split(" "), 20, 2)!;
    expect(lines.length).toBeLessThanOrEqual(2);
    for (const l of lines) expect(["o", "a", "de", "com"]).not.toContain(l.split(" ").at(-1)!.toLowerCase());
    expect(breakLines("uma frase longa demais para caber em duas linhas curtas".split(" "), 10, 2)).toBeNull();
  });
  it("builds valid pages with sparse semantic highlights", () => {
    const words = "Três em cada quatro pessoas abandonam o vídeo nos primeiros segundos. O gancho resolve isso rapidamente e gera clientes.".split(" ").map((w, i) => ({ text: w, startFrame: i * 8, endFrame: i * 8 + 7, confidence: 0.9 }));
    const opts = { maxChars: 28, maxLines: 2, fps: 30, durationInFrames: 400, keywordStems: new Set(["ganch", "client"]) };
    const pages = buildCaptionPages(words, opts);
    const items = pagesToItems(pages, { ...opts, bottomPercent: 22, preset: "bold-pop", tokens: DEFAULT_BRAND_TOKENS });
    expect(items.length).toBeGreaterThan(1);
    for (const it of items) {
      expect(CaptionItemSchema.safeParse(it).success).toBe(true);
      expect(it.lines.length).toBeLessThanOrEqual(2);
    }
    const highlighted = items.filter((i) => i.words.some((w) => w.highlight)).length;
    expect(highlighted).toBeGreaterThan(0);
    expect(highlighted).toBeLessThan(items.length);
  });
  it("merges speech into ducking ranges", () => {
    expect(speechRanges([{ startFrame: 0, endFrame: 10 }, { startFrame: 12, endFrame: 20 }, { startFrame: 60, endFrame: 70 }], 5)).toEqual([[0, 20], [60, 70]]);
  });
  it("turns ordinals into on-screen callouts", () => {
    expect(calloutFor("O primeiro erro é começar sem um gancho claro.")).toMatch(/^1\. Começar sem um gancho/);
  });
});

describe("Compliance", () => {
  const rules = ComplianceRulesSchema.parse({ sector: "finance", prohibitedTerms: ["concorrente x"] });
  it("flags absolute promises, prohibited terms and personal data as high", () => {
    const r = scanCompliance(
      [
        { source: "transcript", text: "Resultado garantido, cem por cento, sem nenhum risco.", atMs: 1000 },
        { source: "on_screen", text: "Melhor que a Concorrente X", atMs: 2000 },
        { source: "transcript", text: "meu CPF é 123.456.789-09", atMs: 3000 },
        { source: "transcript", text: "rentabilidade alta", atMs: 4000 },
      ],
      rules,
      { musicOrigins: ["gerada"], disclaimerOnScreen: true },
    );
    const rulesHit = r.findings.map((f) => f.rule);
    expect(rulesHit).toEqual(expect.arrayContaining(["ABS-GARANTIA", "ABS-100", "ABS-RISCO", "TERMO:concorrente x", "PD-CPF", "SENS-FIN"]));
    expect(r.findings.find((f) => f.rule === "SENS-FIN")?.severity).toBe("high");
    expect(r.requiresHumanDecision).toBe(true);
  });
  it("requires disclaimers and media origins", () => {
    const r = scanCompliance([], ComplianceRulesSchema.parse({ requiredDisclaimer: "Rentabilidade passada não garante futura" }), { musicOrigins: [""], disclaimerOnScreen: false });
    expect(r.findings.map((f) => f.category).sort()).toEqual(["media_origin", "missing_disclaimer"]);
    expect(r.requiresHumanDecision).toBe(false);
  });
});

describe("QA policy (section 20)", () => {
  const plan = validPlan();
  const base = {
    renderId: "rnd_1",
    plan,
    brief: { objective: "authority", goalStatement: "Mostrar o gancho do vídeo", channel: "instagram_reels", formats: ["9:16"], audience: "", keyMessages: [], keywords: ["gancho"], cta: { text: "Comente", url: null }, tone: "", durationTargetSec: { min: 5, max: 20 }, speaker: null, restrictions: [], approvedExamples: [], rejectedExamples: [], variantsAB: false, headline: null, language: "pt-BR" } as never,
    m: { probe: { durationMs: 10_000, width: 1080, height: 1920, fps: 30, videoCodec: "h264", audioCodec: "aac", hasVideo: true, hasAudio: true }, black: [], silences: [], loudness: { integratedLufs: -14.2, truePeakDb: -1.5 } },
    validationIssues: validateEditPlan(plan, ctx()).issues,
    transcripts: new Map(),
    brandReport: { ok: true, score: 100, checks: [], blockers: [], warnings: [] },
    compliance: { id: "art_c", payload: { ok: true, highestSeverity: "none" as const, findings: [], requiresHumanDecision: false, checkedSources: [] } },
    complianceCleared: true,
    approvals: [{ artifactType: "render_preview", artifactId: "rnd_0", decision: "granted" as const, reason: "", createdAt: "" }],
    targetLufs: -14,
    truePeakDb: -1,
    assetsReady: true,
  };
  it("never passes a file with the wrong resolution", () => {
    const r = evaluateQa({ ...base, m: { ...base.m, probe: { ...base.m.probe, width: 720 } } });
    expect(r.band).toBe("blocked");
    expect(r.blockers.join()).toMatch(/Resolução/);
  });
  it("blocks uncleared high compliance findings even with a high score", () => {
    const r = evaluateQa({ ...base, complianceCleared: false, compliance: { id: "art_c", payload: { ...base.compliance.payload, highestSeverity: "high", requiresHumanDecision: true, findings: [{ id: "f", severity: "high", category: "absolute_promise", text: "garantido", source: "transcript", atMs: 0, rule: "ABS", suggestion: "" }] } } });
    expect(r.band).toBe("blocked");
  });
  it("bands scores per policy", () => {
    const r = evaluateQa(base);
    expect(r.blockers).toEqual([]);
    expect(["ready", "ready_with_alerts"]).toContain(r.band);
    expect(r.note).toMatch(/não substitui aprovação humana/);
  });
});
