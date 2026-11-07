# Deploy

## Topologia

- **web** (Next.js, stateless) — escalável horizontalmente atrás de TLS. Precisa de Postgres e Redis.
- **worker** (BullMQ) — CPU-intensivo (FFmpeg, ASR, Chromium). Escale por número de réplicas; `CMF_WORKER_CONCURRENCY` (padrão 2) e `CMF_RENDER_CONCURRENCY` (abas do Chromium por render, padrão 2) controlam o paralelismo por réplica. Não requer GPU.
- **PostgreSQL 16** (estado, versões, auditoria) — backups diários + PITR.
- **Redis 7** (fila e pub/sub) — perda de Redis não perde estado: o reconciliador do worker reenfileira etapas pendentes a partir do banco.
- **Storage S3-compatible** (AWS S3, MinIO, R2) com SSE e *lifecycle* para derivados.

## Passos (docker compose)

```bash
cp .env.example .env               # preencha segredos fortes
npm run models:install             # baixa o modelo de ASR em ./.models (montado no worker)
docker compose up -d postgres redis minio
docker compose run --rm migrate    # aplica infra/migrations
docker compose up -d web worker
```

Crie o bucket `cmf-media` no MinIO/S3 com política privada. Em S3, use credenciais via IAM role do worker/web (sem chaves estáticas).

## Variáveis obrigatórias em produção

`DATABASE_URL`, `REDIS_URL`, `CMF_PUBLIC_URL`, `CMF_SESSION_SECRET`, `CMF_STORAGE_DRIVER=s3`, `CMF_S3_BUCKET`, `CMF_S3_REGION` (e `CMF_S3_ENDPOINT` para MinIO/R2), `CMF_MODELS_DIR`. Opcionais: `ANTHROPIC_API_KEY` (agentes assistidos), `OPENAI_API_KEY` (ASR externo), `OTEL_EXPORTER_OTLP_ENDPOINT`, `REMOTION_LICENSE_KEY`, `CMF_CHROME_EXECUTABLE`.

## Chromium para o Remotion

O worker procura um *headless shell* local (`CMF_CHROME_EXECUTABLE` ou `/opt/pw-browsers`). Na imagem, `npx remotion browser ensure` baixa o Chrome do Remotion no build — o worker em execução não precisa de acesso à internet. Bibliotecas de sistema necessárias estão no `infra/docker/Dockerfile`.

## Observabilidade

- Logs JSON em stderr (web e worker) com `requestId`, `projectId`, `runId`, `otelTraceId`.
- `OTEL_EXPORTER_OTLP_ENDPOINT` + `@opentelemetry/sdk-node` instalado ativam spans (`stage.*`, `agent.*`) com o atributo `cmf.trace_id`.
- `GET /api/health` verifica banco e Redis.
- Métricas de negócio (tempo por etapa, custo, falhas por agente, aprovação na primeira versão) estão em `/analytics`.

## Operação

- **Migrations**: `npm run db:migrate` (idempotente, Drizzle migrator).
- **Retry de etapa**: `POST /api/agent-runs/:id/retry` (perfil com `agent.retry`) — retoma do último checkpoint.
- **Jobs travados**: o reconciliador (60 s) reenfileira etapas sem job; jobs com falha definitiva aguardam decisão humana.
- **Licenças**: confirme a licença do Remotion para a sua organização antes de uso comercial.
