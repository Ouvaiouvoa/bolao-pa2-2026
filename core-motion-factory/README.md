# CORE Motion Factory

**Linha de produção audiovisual multiagente governada — by HAXIS Core**

Transforma vídeo bruto, briefing e identidade de marca em conteúdo vertical revisado, renderizado e pronto para aprovação — com rastreabilidade de cada decisão, custo e versão. Nada é publicado automaticamente.

> Primeiro: produzir melhor, mais rápido e com evidência. Depois: mostrar os agentes trabalhando.

## O que funciona hoje (verificado)

| Etapa | Implementação real |
|---|---|
| Upload | Multipart retomável com URLs assinadas (local HMAC ou S3 presigned), checksum SHA-256, original imutável |
| Ingest | MIME real por magic bytes, ffprobe, proxy 720p, mezanino para o master, waveform, thumbnails, silêncios, cortes de cena, loudness EBU R128, enquadramento do sujeito por cena |
| Transcrição | Local (on-premise) com NVIDIA Parakeet TDT 0.6B v3 via sherpa-onnx: timestamps e confiança por palavra; provedor OpenAI opcional |
| Análise | Diretor (direção criativa + critérios de aceitação) e Curador (6 critérios, detecção de retakes e falsos inícios, justificativas) |
| Roteiro | Gancho, progressão, CTA, variantes A/B, legenda de publicação |
| Montagem | `edit_plan.json` versionado e validado: jump cuts em pausas, punch-in, reframing 16:9→9:16 por cena, legendas semânticas, motion editável, trilha gerada sem direitos de terceiros com ducking |
| Governança | Agente Marca, Agente Compliance (bloqueia em alerta alto até decisão humana), orçamento por projeto, política de ferramentas restritas |
| Render | Remotion (mesma composição no player do navegador e no render): preview 540×960, master 1080×1920 H.264/AAC normalizado a −14 LUFS, thumbnail, hash |
| QA | Técnico (ffprobe, frames pretos, silêncio, loudness, true peak), editorial, marca e compliance com nota e faixas da política |
| Review | Player com frame stepping, comentários por timecode (nota, corte, correção de texto, remover elemento), comparação lado a lado, versões |
| Entrega | Pacote com MP4, SRT, VTT, relatório de QA, legenda de publicação, custos e tempo, ZIP com hashes |
| Painéis | Command Center, Sala de Produção (player + timeline editável + propriedades), Escritório Vivo (estado derivado só de eventos persistidos), Analytics, Auditoria exportável |

Fluxo completo validado pelo teste E2E (`tests/e2e/acceptance.spec.ts`) e pelo pipeline headless (`npm run pipeline:fixture`), sobre um vídeo-fixture real em português (`tests/fixtures/raw-talk-pt.mp4`).

## Arquitetura em uma tela

```
apps/web (Next.js 16)  ──REST/SSE──►  navegador (Player Remotion + timeline)
   │  comandos (aprovações, revisões, uploads)       ▲ eventos persistidos (audit_events)
   ▼                                                  │
packages/orchestration ── PostgreSQL (estado, versões, artefatos, auditoria)
   │  máquina de estados + fila (BullMQ/Redis, idempotente)
   ▼
apps/worker ── orquestrador (manager-as-tools) ── 14 agentes (packages/agents)
   │                 │ ferramentas com política (restritas auditadas)
   ▼                 ▼
packages/media (FFmpeg/ffprobe, ASR)     apps/renderer (Remotion + Chromium)
                    └── storage S3-compatible (local assinado | S3/MinIO)
```

Detalhes: [docs/architecture.md](docs/architecture.md) · agentes: [docs/agents.md](docs/agents.md) · contrato do edit plan: [docs/edit-plan.md](docs/edit-plan.md) · segurança: [docs/security.md](docs/security.md) · deploy: [docs/deploy.md](docs/deploy.md) · plano por fases: [docs/implementation-plan.md](docs/implementation-plan.md) · relatório final: [docs/final-report.md](docs/final-report.md).

## Requisitos

- Node.js 22+, npm 10+
- PostgreSQL 16, Redis 7
- FFmpeg/ffprobe 6+ no PATH (ou `CMF_FFMPEG_PATH` / `CMF_FFPROBE_PATH`)
- Chromium headless para o Remotion (detectado automaticamente em `/opt/pw-browsers`; ou `CMF_CHROME_EXECUTABLE`; sem nenhum, o Remotion baixa o seu)
- Modelos locais (~500 MB): `npm run models:install`

## Execução local

```bash
cp .env.example .env            # ajuste segredos (nunca versione .env)
npm install
npm run models:install          # ASR Parakeet (+ voz Piper só para regenerar fixture)
npm run db:migrate
npm run db:seed                 # opcional: org, usuários por perfil e marca de exemplo
npm run dev                     # web em :3000 + worker
```

Abra http://localhost:3000, crie a organização (ou use o seed), cadastre a marca e siga o assistente **Novo projeto**.

Sem interface: `npm run pipeline:fixture` executa o fluxo inteiro sobre o fixture (inclui decisões humanas explícitas registradas por um usuário de teste) e imprime estado, roteiro, compliance, QA e custos.

## Comandos (seção 31)

| Comando | O que faz |
|---|---|
| `npm install` | instala o monorepo (npm workspaces) |
| `npm run lint` | ESLint (`--max-warnings=0`) |
| `npm run typecheck` | `tsc` de todos os pacotes + app web |
| `npm run test` | testes unitários (Vitest) |
| `npm run test:integration` | pipeline real em banco/fila isolados (Postgres, Redis, FFmpeg, ASR, Remotion) |
| `npm run test:visual` | frames de referência 9:16, 1:1, 16:9 + falha explícita de fonte ausente |
| `npm run test:e2e` | Playwright: os 10 passos de aceitação pela interface |
| `npm run build` | build de produção do Next.js |
| `npm run remotion:preview` | Remotion Studio com o template de exemplo |
| `npm run remotion:render:fixture` | render real 1080×1920 do template sobre o fixture |
| `npm run pipeline:fixture` | pipeline completo headless |
| `npm run fixture:generate` | regenera o vídeo-fixture (TTS Piper + FFmpeg) |

Os testes de integração e E2E usam bancos `cmf_it`/`cmf_e2e` e Redis DB 3/2 (variáveis `CMF_IT_*`/`CMF_E2E_*`), nunca os dados de desenvolvimento.

## Configuração

Todas as variáveis estão em [.env.example](.env.example). Pontos principais:

- **Segredos** (`CMF_STORAGE_SIGNING_SECRET`, `CMF_SESSION_SECRET`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, credenciais S3) vêm do cofre de variáveis do ambiente. Nunca do banco, nunca do repositório.
- **IA**: por padrão os agentes usam o motor determinístico `heuristic-v1` e transcrição local — nenhum dado sai da infraestrutura. Projetos em modo "assistido por LLM" usam Claude (`claude-opus-5-5`; classificação simples em `claude-haiku-5-5`) **somente** se a organização permitir provedores externos e houver chave configurada. Saídas do LLM são validadas por schema e restritas ao material existente.
- **Storage**: `CMF_STORAGE_DRIVER=local` (arquivos sob `CMF_DATA_DIR`, URLs HMAC de curta duração + verificação de organização) ou `s3` (AWS S3, MinIO, R2; SSE-AES256, presigned URLs).

## Licenças de terceiros

- **Remotion** tem licença própria: gratuita para indivíduos e empresas com até 3 funcionários; acima disso exige *Company License* (https://www.remotion.dev/docs/license/pricing). Configure `REMOTION_LICENSE_KEY` quando aplicável.
- **Inter** (fontes em `packages/remotion/public/fonts`) — SIL Open Font License.
- **Parakeet TDT 0.6B v3** (NVIDIA, CC-BY-4.0) e **Piper pt_BR faber** — baixados por `models:install`, não versionados.
- A trilha padrão é sintetizada pelo próprio sistema (sem direitos de terceiros) e registrada como tal na composição.

## Estrutura

```
apps/web        Next.js: UI, API (seção 15), SSE, auth/RBAC
apps/worker     BullMQ worker: orquestrador de etapas, ferramentas com política, reconciliação
apps/renderer   bundling/render Remotion, servidor de mídia efêmero, CLI de fixture
packages/schemas        contratos zod: edit plan, marca, briefing, artefatos, estados, eventos, permissões, escritório vivo
packages/agents         14 agentes (diretor … distribuição) + cliente LLM opcional
packages/orchestration  repositórios, máquina de estados, fila, aprovações, uploads, auth
packages/media          FFmpeg/ffprobe, análise, ASR (sherpa local / OpenAI)
packages/remotion       composição do edit plan e template Autoridade Premium
packages/brand-engine   tokens → valores, áreas seguras, contraste, fontes
packages/templates      biblioteca de templates (status honesto: disponível/beta/planejado)
packages/db             schema Drizzle + migrations (infra/migrations)
packages/storage        storage S3-compatible + chaves por tenant
packages/observability  logs JSON com redação de segredos + OpenTelemetry
tests/                  unit, integration, e2e, visual, fixtures
```

---

CORE Motion Factory · by HAXIS Core
