/**
 * MVP acceptance (sections 24 E2E + 29): an authorized user, through the real UI, takes one raw
 * video to a delivered master. Nothing is mocked: real uploads, FFmpeg, local ASR, Remotion
 * renders, Postgres, Redis/BullMQ and SSE.
 */
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { ROOT } from "./env";

const FIXTURE = path.join(ROOT, "tests/fixtures/raw-talk-pt.mp4");
const STATE = (p: Page) => p.getByTestId("project-state");

async function waitState(page: Page, text: RegExp, timeout = 8 * 60_000) {
  await expect(STATE(page)).toHaveText(text, { timeout });
}

test("vídeo bruto → master entregue, com aprovações humanas e evidências", async ({ page, request }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  const suffix = Date.now().toString(36);

  // 1. Organização e marca
  await page.goto("/signup");
  await page.fill("input[name=organizationName]", `Estúdio E2E ${suffix}`);
  await page.fill("input[name=name]", "Diretora E2E");
  await page.fill("input[name=email]", `e2e+${suffix}@example.com`);
  await page.fill("input[name=password]", "senha-super-segura-e2e");
  await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
  await page.goto("/brands/new");
  await page.getByLabel("Nome da marca").fill("HAXIS Core E2E");
  await page.getByTestId("save-brand").click();
  await expect(page.getByRole("heading", { name: "HAXIS Core E2E" })).toBeVisible();

  // 2. Projeto vertical (assistente em 7 etapas)
  await page.goto("/projects/new");
  await page.getByLabel("Título do projeto").fill("Reel E2E — 3 erros");
  await page.getByRole("button", { name: "Continuar →" }).click();
  await page.getByRole("button", { name: "Continuar →" }).click();
  await page.getByLabel(/Objetivo da peça/).fill("Mostrar os três erros que fazem a marca perder atenção e clientes em vídeos curtos.");
  await page.getByLabel(/Palavras-chave/).fill("gancho, roteiro, público, clientes, vídeo");
  await page.getByLabel("CTA", { exact: true }).fill("Comente ROTEIRO");
  await page.getByLabel(/Apresentador/).fill("Ana Souza");
  await page.getByLabel(/Cargo do apresentador/).fill("Estrategista de conteúdo");
  await page.getByLabel(/Duração mínima/).fill("20");
  await page.getByLabel(/Duração máxima/).fill("45");
  await page.getByRole("button", { name: "Continuar →" }).click();

  // 3. Upload real (multipart assinado) do vídeo bruto
  await page.getByTestId("media-input").setInputFiles(FIXTURE);
  await expect(page.getByText("enviado")).toBeVisible({ timeout: 60_000 });
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Continuar →" }).click();
  await page.getByTestId("start-production").click();
  await page.waitForURL(/\/projects\/prj_/);
  const projectId = page.url().split("/projects/")[1]!.split(/[/?#]/)[0]!;

  // 4. Transcrição + análise → aprovação do briefing
  await waitState(page, /Aguardando aprovação do briefing/);
  await page.getByRole("tab", { name: "Transcrição" }).click();
  await expect(page.getByTestId("transcript-words")).toContainText("gancho");
  await page.getByTestId("approve-brief").click();

  // 5. Roteiro → aprovação
  await waitState(page, /Aguardando aprovação do roteiro/);
  await expect(page.getByText(/Variante A/)).toBeVisible();
  await page.getByTestId("approve-script").click();

  // Compliance: alegações absolutas no material exigem decisão humana
  await expect(page.getByText("Decisão de compliance necessária")).toBeVisible({ timeout: 5 * 60_000 });
  await page.getByPlaceholder(/Motivo/).first().fill("Alegação revisada pelo jurídico; mantida com ressalva.");
  await page.getByTestId("approve-compliance_report").click();

  // 6. Edit plan válido + timeline sincronizada + preview
  await waitState(page, /Em revisão/);
  await expect(page.getByTestId("timeline-ruler")).toBeVisible();
  await page.getByTestId("timeline-ruler").click({ position: { x: 300, y: 10 } });
  await expect(page.getByTestId("timecode")).not.toHaveText("00:00:00:00");

  // 7. Comentário por timecode (corte) no Review
  await page.getByTestId("go-review").click();
  const video = page.getByTestId("review-video");
  await expect(video).toBeVisible();
  await video.evaluate((v: HTMLVideoElement) => new Promise<void>((r) => (v.readyState >= 1 ? r() : v.addEventListener("loadedmetadata", () => r(), { once: true }))));
  const goTo = async (tc: string) => {
    await page.getByTestId("goto-timecode").fill(tc);
    await page.getByTestId("goto-timecode").press("Enter");
    await expect(page.getByTestId("review-timecode")).toHaveText(tc);
  };
  await page.getByTestId("comment-kind").selectOption("cut");
  await goTo("00:00:04:06");
  await page.getByTestId("mark-cut-end").click();
  await expect(page.getByText(/até 4\.2\ds/)).toBeVisible();
  await goTo("00:00:03:00");
  await page.getByTestId("comment-body").fill("Remover este trecho (respiro longo).");
  await page.getByTestId("add-comment").click();
  await expect(page.getByTestId("comment-list")).toContainText("Remover este trecho");

  // 8. Revisão → nova versão sem perder histórico
  await page.getByPlaceholder("Motivo / observação").fill("Cortar o trecho comentado e reapresentar.");
  await page.getByTestId("request-changes").click();
  await waitState(page, /Montagem|Render de preview|Em revisão/);
  await expect(page.getByRole("button", { name: /Preview v\d+/ })).toHaveCount(2, { timeout: 8 * 60_000 });
  await waitState(page, /Em revisão/);
  await expect(page.getByTestId("comment-list")).toHaveCount(1);

  // 9. Aprovar preview → master
  await page.reload();
  await page.getByTestId("approve-preview").click();
  await waitState(page, /Preview aprovado/);
  await page.goto(`/projects/${projectId}`);
  await page.getByTestId("render-final").click();
  await waitState(page, /Pronto para entrega|Bloqueado/, 10 * 60_000);
  await expect(STATE(page)).toHaveText(/Pronto para entrega/);

  // 10. Aprovar master → entregue; baixar MP4, SRT, VTT e QA
  await page.goto(`/projects/${projectId}/review`);
  await page.getByTestId("approve-master").click();
  await waitState(page, /Entregue/);
  const links = page.getByTestId("review-downloads").locator("a");
  const names = await links.allTextContents();
  expect(names).toEqual(expect.arrayContaining(["master-1080x1920.mp4", "legendas.srt", "legendas.vtt", "relatorio-qa.json", "pacote-entrega.zip"]));
  const hrefOf = async (name: string) => (await page.getByTestId("review-downloads").getByRole("link", { name }).getAttribute("href"))!;
  const mp4 = await page.request.get(await hrefOf("master-1080x1920.mp4"));
  expect(mp4.status()).toBe(200);
  expect(mp4.headers()["content-type"]).toBe("video/mp4");
  expect((await mp4.body()).length).toBeGreaterThan(500_000);
  const srt = await (await page.request.get(await hrefOf("legendas.srt"))).text();
  expect(srt).toMatch(/^1\n00:00:0\d,\d{3} --> /);
  const vtt = await (await page.request.get(await hrefOf("legendas.vtt"))).text();
  expect(vtt.startsWith("WEBVTT")).toBe(true);
  const qa = JSON.parse(await (await page.request.get(await hrefOf("relatorio-qa.json"))).text());
  expect(qa.score).toBeGreaterThanOrEqual(75);
  // Signed URLs are tied to the tenant session: anonymous access is refused.
  const anon = await request.get(await hrefOf("master-1080x1920.mp4"));
  expect(anon.status()).toBe(403);

  // 11. Custo, tempo e agentes envolvidos
  await page.goto(`/projects/${projectId}`);
  await page.getByRole("tab", { name: "Entregáveis e custos" }).click();
  await expect(page.getByTestId("downloads")).toContainText("master-1080x1920.mp4");
  for (const label of ["Ingest", "Transcrição", "Curador", "Roteirista", "Editor", "Legendas", "Motion", "Áudio", "Marca", "Compliance", "Render", "QA", "Distribuição"])
    await expect(page.getByRole("cell", { name: label, exact: true })).toBeVisible();

  // 12. Escritório vivo reflete eventos reais
  await page.goto(`/projects/${projectId}/office`);
  await expect(page.getByTestId("office-agent-distribution")).toHaveAttribute("data-state", "done", { timeout: 30_000 });
  const audit = await (await page.request.get(`/api/projects/${projectId}/audit`)).json();
  const eventIds = new Set<number>(audit.data.events.map((e: { id: number }) => e.id));
  const runs = (await (await page.request.get(`/api/projects/${projectId}/agent-runs`)).json()).data as { agentType: string; status: string }[];
  for (const agent of ["director", "ingest", "transcript", "curator", "writer", "editor", "motion", "captions", "audio", "brand", "compliance", "qa", "render", "distribution"]) {
    const tile = page.getByTestId(`office-agent-${agent}`);
    const state = await tile.getAttribute("data-state");
    const evidence = Number(await tile.getAttribute("data-evidence"));
    expect(state, agent).not.toBe("idle");
    expect(eventIds.has(evidence), `${agent} evidência #${evidence}`).toBe(true);
    if (state === "done") expect(runs.some((r) => r.agentType === agent && (r.status === "succeeded" || r.status === "cached")), agent).toBe(true);
  }
  await page.getByTestId("office-agent-render").click();
  await expect(page.getByTestId("office-drawer")).toContainText("Entradas utilizadas");
  await page.screenshot({ path: path.join(ROOT, "test-results/office.png"), fullPage: true });
  expect(consoleErrors).toEqual([]);
});
