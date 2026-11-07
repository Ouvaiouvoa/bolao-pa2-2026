# Arquitetura

## Princípios aplicados

| Princípio (seção 3) | Como está implementado |
|---|---|
| Código antes de teatro | A timeline é o `edit_plan.json` validado (zod estrito + regras semânticas). O player do navegador e o render usam o **mesmo** componente Remotion. |
| Artefatos verificáveis | Todo agente persiste artefatos validados por schema (`artifacts`, com checksum SHA-256, versão, hash das entradas e `agent_run_id`). |
| Determinismo | Render por frame (Remotion), cortes alinhados à grade de frames, `heuristic-v1` determinístico como motor base dos agentes. |
| IA onde agrega | LLM opcional (Diretor, Roteirista, Compliance) com saída estruturada validada; nunca inventa material (só referencia selects existentes). |
| Humano no comando | Briefing, roteiro, compliance alto, preview e master exigem `Approval` explícito. O sistema não tem transição que aprove. |
| Marca como sistema | Tokens → `brand-engine` → cores por papel (`primary`, `accent`…), fontes aprovadas, áreas seguras, contraste WCAG, logo com largura mínima. |
| Observabilidade | `audit_events` (fonte do SSE), `agent_runs` (custo, tokens, latência, ferramentas, logs), `state_transitions`, `trace_id` de ponta a ponta, OpenTelemetry opcional. |
| Reprocessamento parcial | Checkpoints por hash de conteúdo: reexecutar uma etapa reaproveita todo agente cujas entradas não mudaram (`agent.run.cached`). |
| Portabilidade | Interfaces para fila (`StageQueue`), storage (`ObjectStorage`), ASR (`TranscriptionProvider`) e LLM (`LlmClient`). |
| Segurança por padrão | `organization_id` em toda consulta, chaves de storage por tenant, URLs assinadas curtas, RBAC, segredos só em variáveis de ambiente. |

## Componentes

### apps/web (Next.js 16, App Router)
- Páginas server-side carregam um *snapshot* do projeto (`lib/server/queries.ts`) já filtrado pelo perfil (cliente não recebe custos, logs nem trace).
- Rotas de API (seção 15) usam `route(permission, handler)`: autenticação por cookie de sessão (token aleatório, apenas o SHA-256 no banco), RBAC, `request_id` em toda resposta, erros padronizados sem stack trace, `Idempotency-Key` em comandos críticos (resposta reaproveitada por 24 h via Redis).
- `GET /api/projects/:id/events` é SSE: relê do banco a partir do `Last-Event-ID`; Redis pub/sub apenas sinaliza novidade (com fallback de polling).

### apps/worker (BullMQ)
- Consome a fila `cmf-stages`. Cada job é `{projectId, stage, seq, attempt}`; `seq` é monotônico por projeto e compõe a chave de idempotência (um job nunca roda duas vezes; reentrar numa etapa gera nova sequência).
- `runStage` é o **orquestrador** (manager-as-tools): executa os especialistas da etapa em ordem, aplica checkpoint, orçamento, portões humanos e transição de estado. Agentes não transicionam estado nem aprovam nada.
- Reconciliador a cada 60 s reenfileira etapas cujo job não chegou à fila (falha entre commit e enqueue).
- Erros transitórios: 1 retry automático; demais: `UnrecoverableError` e retry manual (`POST /api/agent-runs/:id/retry`) a partir do último checkpoint.

### apps/renderer
- `getBundle()` empacota `packages/remotion` uma vez por revisão de código (hash do conteúdo) e reaproveita em disco.
- Cada render sobe um servidor HTTP efêmero em loopback com token aleatório servindo apenas os arquivos daquele render (com Range), porque o Chromium busca mídia por URL.
- Preview: `scale 0.5`, CRF 28. Master: 1080×1920, CRF 18, depois `loudnorm` (−14 LUFS, TP −1 dBTP) com cópia do vídeo, probe, SHA-256 e capa.

## Máquina de estados (seção 7)

Implementada em `packages/schemas/src/job-state.ts` (tabela completa) e aplicada por `transitionProject` com `SELECT … FOR UPDATE`. Cada transição grava autor, timestamp e motivo em `state_transitions` e emite `project.state.changed`.

Desvios explícitos (documentados): `ASSEMBLING → SCRIPTING` (humano) existe para a reprovação de compliance; holds de compliance/orçamento não mudam o estado canônico — ficam em `projects.stage_json.hold` com um `approval_request` aberto.

```
DRAFT → ASSETS_UPLOADING → INGESTING → TRANSCRIBING → ANALYZING → AWAITING_BRIEF_APPROVAL
  → SCRIPTING → AWAITING_SCRIPT_APPROVAL → ASSEMBLING [hold compliance?] → PREVIEW_RENDERING
  → IN_REVIEW → (REVISION_REQUESTED → ASSEMBLING…) | APPROVED → FINAL_RENDERING → QA_CHECKING
  → READY_TO_DELIVER | BLOCKED → DELIVERED
```

## Etapas e agentes

| Etapa | Agentes (ordem) | Saída para o próximo portão |
|---|---|---|
| INGESTING | ingest | `media_manifest`, proxy, mezanino, áudio 16 kHz, waveform, thumbnails |
| TRANSCRIBING | transcript | `transcripts` (versão), `.srt/.vtt` da fonte |
| ANALYZING | director → curator | `creative_direction`, `selects` → pedido de aprovação do briefing |
| SCRIPTING | writer | `script` (A/B) → pedido de aprovação do roteiro |
| ASSEMBLING | editor → captions → motion → audio → brand → compliance | `edit_plan` (uma versão por agente), relatórios → hold se compliance alto |
| PREVIEW_RENDERING | render | `renders` (preview) → pedido de aprovação do preview |
| FINAL_RENDERING | render | `renders` (final) |
| QA_CHECKING | qa → distribution | `qa_report`, `delivery_package` → pedido de aprovação do master |

## Checkpoints e cache

`inputHash = sha256(agente, versão do agente, etapa, entradas)`. As entradas de agentes encadeados usam o **conteúdo** das trilhas consumidas (ex.: Legendas consome só tempo/origem dos clipes, não o ganho aplicado pelo Áudio), então reexecutar a montagem após uma decisão humana reaproveita todo passo inalterado e reproduz exatamente o mesmo relatório.

## Decisões de compliance reaproveitadas

Uma decisão humana sobre um relatório cobre um relatório novo **somente** se todos os achados de severidade alta forem idênticos (regra + texto). O orquestrador emite `compliance.clearance.reused` com os ids das aprovações originais; achados novos sempre exigem nova decisão. Nenhuma aprovação é criada automaticamente.

## Eventos (seção 14)

Todos os eventos ficam em `audit_events` (bigserial ordenado) antes de qualquer notificação. Tipos em `packages/schemas/src/events.ts`. O Escritório Vivo usa `deriveOfficeState(events)` — redutor puro testado: cada estado não ocioso carrega o id do evento que o justifica.

## Ferramentas dos agentes (seção 16)

`apps/worker/src/tools.ts` implementa as ferramentas comuns e restritas. Restritas (`read_original_media`, `render_media`, `register_media`, `save_transcript`, `save_edit_plan`, `register_generated_asset`, `resolve_review_comments`, `paid_external_call`…) só funcionam para agentes com concessão em `AGENTS[agent].restrictedTools`; chamadas negadas lançam `ToolPolicyError`, e toda chamada restrita gera `agent.tool.called` e fica em `agent_runs.tool_calls_json`.
