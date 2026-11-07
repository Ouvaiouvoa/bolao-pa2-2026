# Plano de implementação por PR/commit (seção 30)

Status: ✅ entregue nesta iteração · 🟡 parcial · ⬜ próximo

## Fase 0 — Fundação ✅
1. ✅ Monorepo npm workspaces, TypeScript estrito, ESLint, Vitest, Playwright.
2. ✅ `packages/schemas`: edit plan (zod estrito + validação semântica), tokens de marca, briefing, artefatos, máquina de estados, eventos, permissões, custo, escritório vivo.
3. ✅ `packages/db`: schema Drizzle das 19 tabelas (entidades da seção 10 + sessões, uploads, artefatos, transições, pedidos de aprovação) e migrations.
4. ✅ `packages/storage`: local assinado (HMAC) e S3-compatible, multipart retomável, chaves por tenant, imutabilidade.
5. ✅ `packages/orchestration`: transições com lock, eventos persistidos + pub/sub, fila BullMQ idempotente, aprovações, uploads, auth.
6. ✅ `packages/observability`: logs JSON com redação, spans OpenTelemetry com `cmf.trace_id`.

Gate atingido: projeto criado, asset enviado e job real acompanhado (SSE).

## Fase 1 — Pipeline mínimo ✅
7. ✅ `packages/media`: ffprobe, MIME real, proxy, mezanino, áudio, waveform, thumbnails, silêncio, cenas, loudness, enquadramento por cena, ASR local (Parakeet) e OpenAI.
8. ✅ Fixture real (TTS Piper + FFmpeg) com falso início, retake, alegação sensível e CTA falado.
9. ✅ Agentes Ingest, Transcrição, Diretor, Curador, Roteirista, Editor, Legendas, Motion, Áudio.
10. ✅ `packages/remotion` + `apps/renderer`: composição do edit plan, template Autoridade Premium, render preview/master.

Gate atingido: vídeo bruto → Reel reproduzível (`npm run pipeline:fixture`).

## Fase 2 — Editor e Review ✅
11. ✅ Sala de Produção: Player Remotion sincronizado com timeline multi-trilha, propriedades (reframing, zoom, volume, textos, destaques, remoção com ripple), versões.
12. ✅ Review: frame stepping, ir para timecode, comentários por timecode (nota/corte/correção/remoção), comparação lado a lado, versões, aprovações.
13. ✅ Revisão automática de comentários estruturados pelo Editor; transcrição editável com versões.

Gate atingido: correção sem editar JSON.

## Fase 3 — Marca e QA 🟡
14. ✅ Kits de marca (cores, fontes, logo, legendas, motion, rodapé, áudio, tom, compliance) com upload de logo/trilha/fonte.
15. ✅ Agentes Marca, Compliance (com trava humana), QA, Distribuição; master final normalizado.
16. 🟡 Templates: 1 disponível com frames de referência (Autoridade Premium), 2 beta funcionais (Oferta, Tutorial), 5 planejados.
17. ⬜ Gate "três marcas diferentes sem contaminação visual": validação automatizada por marca (o isolamento de dados já é testado; falta a bateria visual por marca).

## Fase 4 — Escritório Vivo ✅
18. ✅ Avatares 2D SVG/CSS, estados derivados de eventos persistidos com evidência (`deriveOfficeState`), cards com tarefa, entradas, progresso, artefatos, custo, ferramentas, logs, dependências e retry.

Gate atingido: toda animação corresponde a evento persistido (teste unitário + E2E).

## Fase 5 — Validação comercial ⬜
19. ⬜ 30 conteúdos internos (HAXIS Core, Vai ou Voa, EDUC/EDUC Dojo, Tapajós Já, Grupo Vértice) com medição de linha de base manual.
20. ⬜ Três clientes piloto, planos, onboarding, suporte.

## Próximos PRs sugeridos (ordem)
1. Exercitar o caminho com LLM contra a API real (chave no cofre) e calibrar prompts/efforts por agente.
2. Purge controlado por retenção + exclusão lógica pela UI.
3. Bateria visual multi-marca e frames de referência dos templates beta.
4. Diarização (podcast/entrevista) e B-roll aprovado.
5. Formatos adicionais por projeto (1:1 e 16:9 já suportados pela composição) — variantes renderizadas a partir do mesmo edit plan.
6. Integrações de publicação (somente após política e aprovação explícita).
