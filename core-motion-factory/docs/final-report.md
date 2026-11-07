# Relatório final — primeira iteração (seção 30.14)

Data: 7 de novembro de 2026 · Branch: `claude/eager-galileo-u1ri6b`

## Contexto

O repositório auditado (`bolao-pa2-2026`) continha apenas um dashboard estático de bolão publicado via GitHub Pages, sem código reaproveitável para este produto. O CORE Motion Factory foi construído isolado em `core-motion-factory/`, sem alterar os arquivos existentes. **Atenção:** o workflow de Pages publica a raiz do repositório quando há push em `main`; recomenda-se mover este diretório para um repositório próprio (ex.: `git subtree split -P core-motion-factory`) antes de qualquer merge.

## Arquivos criados (resumo)

- `apps/web` — Next.js 16: 15 páginas (login, cadastro, Command Center, projetos, assistente de 7 etapas, Sala de Produção, Review, Escritório Vivo, Auditoria, marcas (lista, nova, edição), templates, analytics, configurações) e 39 rotas de API (todas as da seção 15 + auth, uploads assinados/retomáveis, arquivos, marcas, usuários, configurações, métricas, health).
- `apps/worker` — orquestrador de etapas, ferramentas com política, reconciliador.
- `apps/renderer` — Remotion (bundle com cache por conteúdo, servidor de mídia efêmero, render/still, CLI de fixture).
- `packages/*` — schemas, agents (14), orchestration, media, remotion, brand-engine, templates, db, storage, observability.
- `infra/` — migrations Drizzle (2), Dockerfile, scripts (`install-models.sh`, `seed.ts`, `dev.mjs`, `make-fixture.ts`, `run-fixture-pipeline.ts`); `docker-compose.yml` na raiz.
- `tests/` — unitários, integração, E2E, visuais, fixture real em português.
- `docs/` — arquitetura, agentes, contrato do edit plan, segurança, deploy, plano por fases, este relatório.

## Decisões principais

1. **npm workspaces + TypeScript na fonte** (sem build por pacote): Next transpila os pacotes; o worker roda com `tsx`. Menos peças móveis no MVP.
2. **Transcrição on-premise por padrão** (Parakeet TDT 0.6B v3 via sherpa-onnx): sem custo por minuto, sem dados saindo da infraestrutura, com timestamps e confiança por palavra; OpenAI como provedor configurável.
3. **Motor determinístico como base de todos os agentes** (`heuristic-v1`), LLM (Claude) como reforço opcional e validado — o produto funciona e é testável sem chave e sem enviar dados a terceiros.
4. **Uma composição Remotion para player e render**: o que o revisor vê no navegador é o mesmo componente que gera o master.
5. **Checkpoints por hash de conteúdo** e **sequência monotônica de etapas**: reexecuções são idempotentes e reaproveitam trabalho (descoberto e corrigido durante os testes reais: um loop de compliance e uma colisão de IDs de job ao reentrar numa etapa).
6. **Holds sem novos estados**: compliance alto e orçamento excedido pausam a etapa com um pedido de aprovação, mantendo a máquina de estados da seção 7.
7. **Decisões de compliance reaproveitadas apenas para achados idênticos**, com evento de auditoria próprio — nunca aprovação inferida.
8. **Trilha padrão sintetizada** (sem direitos de terceiros) com origem registrada na composição.
9. **Fixture real gerado por TTS**, não gravado: reprodutível e livre de dados pessoais, mas exercita falso início, retake, alegação sensível, CTA falado, troca de câmera e sujeito fora do centro.

## Testes executados

Todos executados neste ambiente (Linux, 4 vCPU, sem GPU, Node 22, PostgreSQL 16, Redis 7, FFmpeg 6.1, Chromium headless 1243) sobre o código final.

| Comando | Resultado | Cobertura |
|---|---|---|
| `npm run lint` | ✅ 0 erros, 0 avisos | todo o monorepo |
| `npm run typecheck` | ✅ | pacotes, worker, renderer, testes, app web |
| `npm run test` | ✅ 51/51 (9 arquivos) | schemas e contrato do edit plan, frames/timecode/SRT/VTT, máquina de estados, permissões, políticas de custo, áreas seguras/contraste/fontes, montagem de palavras do ASR, Curador, Editor (jump cuts, divisão por cena, ripple), Legendas, ducking, Compliance, política de QA, Escritório Vivo (evidência por evento), storage (assinatura, multipart, imutabilidade, traversal) |
| `npm run test:integration` | ✅ 8/8 (~7 min) | upload→ingest→proxy (cena e enquadramento esquerda→direita detectados), transcrição (WER < 15 % contra o texto de referência, confiança > 0,85), edit plan válido, preview 540×960, comentário→nova versão (corte de exatamente 36 frames, histórico preservado), master 1080×1920 a −14 LUFS ±1,5, QA ≥ 75, pacote de entrega, aprovações registradas, isolamento entre organizações, ferramentas restritas negadas, job repetido idempotente |
| `npm run test:visual` | ✅ 10/10 | 9 frames de referência (gancho, corpo, CTA × 9:16, 1:1, 16:9) com tolerância de 1 % + render com fonte ausente falha com `FONT_MISSING` |
| `npm run test:e2e` | ✅ 1/1 (~7 min) | pela interface: cadastro → marca → assistente → upload real → aprovação de briefing → roteiro → decisão de compliance → timeline → comentário de corte por timecode → revisão → aprovação do preview → master → aprovação → download de MP4/SRT/VTT/QA (URL assinada recusada sem sessão) → custos e agentes → Escritório Vivo com evidência de evento para os 14 agentes; zero erros de console |
| `npm run build` | ✅ | Next.js 16 (Turbopack), 15 páginas e 39 rotas |
| `npm run remotion:render:fixture` | ✅ | 1080×1920 30 fps H.264/AAC, 300 frames em ~64 s |
| `npm run pipeline:fixture` | ✅ | fluxo completo headless até DELIVERED; QA 93/100 |

Problemas reais encontrados pelos testes e corrigidos nesta iteração: (1) checkpoints de agentes encadeados invalidados por versão em vez de conteúdo (loop de compliance); (2) colisão de IDs de job ao reentrar numa etapa (projeto parado após revisão) — resolvido com `stage_seq`; (3) clipe atravessando troca de câmera com enquadramento único; (4) quebra visual de legenda em caixa-alta; (5) falso alerta de coerência numérica ("segundo" falado × "2." na tela); (6) worker derrubado por rejeição não tratada do Remotion sem Chromium local; (7) aviso de hidratação por horários renderizados no servidor.

## Limitações conhecidas

- **Caminho com LLM não exercitado contra a API real** (sem chave neste ambiente). Está implementado com o SDK oficial, tipado e protegido por validação/fallback determinístico; precisa de calibração com chave real.
- **Driver S3 não testado contra um bucket** (MinIO não disponível aqui); o driver local foi testado de ponta a ponta. O compose inclui MinIO para essa validação.
- **Reenquadramento por energia de movimento**, não por detecção de rosto: funciona para fala para câmera; cenas com muito movimento de fundo podem exigir ajuste manual (há controle na UI).
- **Templates**: apenas "Autoridade Premium" tem frames de referência; "Oferta" e "Tutorial" são beta; 5 planejados (status exibido honestamente).
- **Um formato por projeto** (o primeiro do briefing, 9:16 no MVP); a composição já suporta 1:1 e 16:9.
- **Retenção/purge e exclusão pela UI**: configuração existe, job de purge não.
- **Sem publicação externa** (fora do MVP por especificação).
- **Licença do Remotion**: exige *Company License* para empresas com mais de 3 funcionários.
- Desempenho medido neste ambiente (4 vCPU, sem GPU): ingestão ~15 s, transcrição ~6 s, preview ~90 s e master ~3 min para ~30 s de vídeo final.

## Riscos

| Risco | Mitigação |
|---|---|
| Custo/tempo de render em escala | Escalar workers horizontalmente; Remotion Lambda/Cloud Run como próximo passo; preview em 0,5× já reduz custo |
| Qualidade de ASR em áudio real ruidoso | Alertas de loudness/clipping na ingestão, palavras de baixa confiança destacadas e editáveis, provedor alternativo configurável |
| Alegações sensíveis não cobertas por regras | Regras por setor + termos proibidos por marca + revisão semântica opcional; decisão humana obrigatória em alerta alto |
| Dependência de licenças (Remotion, modelos) | Documentado; interfaces permitem trocar ASR/LLM; FFmpeg independente de fornecedor |
| Publicação acidental do código pelo Pages deste repositório | Mover para repositório dedicado antes do merge |

## Próximos passos

Ver [implementation-plan.md](implementation-plan.md): calibrar o caminho com LLM, purge por retenção, bateria visual multi-marca, diarização para podcast, variantes multi-formato, e a Fase 5 (30 conteúdos internos com linha de base medida antes de qualquer afirmação de economia).
