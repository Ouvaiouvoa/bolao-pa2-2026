# Agentes

Cada agente é um `AgentModule` (`packages/agents/src/<agente>`) com `inputs()` (entradas que determinam o resultado, base do checkpoint), `run()` e, quando há custo, `estimateCostCents()`. O motor base é determinístico (`heuristic-v1`); quando o projeto está em modo assistido e a organização permite IA externa, Diretor, Roteirista e Compliance usam Claude com saída estruturada validada.

| Agente | Entradas | Saídas | Lógica principal | Ferramentas restritas |
|---|---|---|---|---|
| Diretor | briefing, transcrições, marca, template | `creative_direction` | template/formato/duração ideal, ritmo do template, intensidade de motion pela marca, critérios de aceitação, plano de tarefas com custo estimado, riscos (baixa confiança, material curto, reframing, setor regulado). LLM opcional com o prompt da seção 17. | `paid_external_call` |
| Ingest | uploads | `media_manifest`, derivados | MIME real, checksum, ffprobe, proxy, mezanino, thumbnails, silêncios, cenas, loudness, enquadramento por energia de movimento **por cena** | `read_original_media`, `register_media` |
| Transcrição | áudio 16 kHz | transcrição versionada, `.srt/.vtt` | Parakeet (local) com divisão em silêncios ≤ 25 s; tokens → palavras com confiança `exp(média log-prob)` | `save_transcript` |
| Curador | transcrições, direção, energia RMS | `selects` | 6 notas (clareza, energia, emoção, completude, novidade, aderência), retakes (Jaccard ≥ 0,7 mantém a tomada mais clara/posterior), falsos inícios, gancho e CTA, encaixe na duração, justificativa por trecho | — |
| Roteirista | selects, briefing | `script` (A/B) | gancho de maior potencial, corpo em ordem cronológica, CTA falado ou cartela, callouts de ordinais/números, legenda de publicação e hashtags; rejeição de roteiro gira o gancho | `paid_external_call` |
| Editor | roteiro aprovado (variante), transcrições, manifestos | `edit_plan` | jump cuts em pausas > limiar do template, padding, cortes na grade de frames, punch-in a cada N cortes, divisão de clipes em troca de cena; **revisão**: aplica comentários `cut` (ripple), `text_fix` (nova versão da transcrição) e `remove_motion` (supressão cumulativa) | `save_edit_plan`, `save_transcript`, `resolve_review_comments` |
| Legendas | trilha de vídeo, transcrições | trilha de legendas, `.srt/.vtt` | projeção palavra→timeline pelos clipes, páginas por sentido/pausa/tamanho, sem artigo/preposição no fim de linha, destaque semântico ≤ 40 % das páginas | `save_edit_plan` |
| Motion | trilha de vídeo, roteiro, briefing, marca | trilha de motion | gancho tipográfico, lower third, callouts ancorados ao beat, cartela de CTA, barra de progresso, logo, rodapé; respeita supressões da revisão | `save_edit_plan` |
| Áudio | trilha de vídeo, loudness medido | trilha de áudio, `audio_plan` | ganho de voz para −16 LUFS, trilha da marca ou trilha ambiente sintetizada (origem registrada), ducking pelos trechos de fala | `save_edit_plan`, `register_generated_asset` |
| Marca | edit plan completo, kit | `brand_report` | cores, fontes, logo/largura mínima, área segura, rodapé, template da marca, contraste, palavras proibidas, grafia | — |
| Compliance | fala usada, textos de tela, legenda de publicação, regras do setor | `compliance_report` | promessas absolutas, alegações sensíveis por setor, dados pessoais (CPF, telefone, e-mail, CEP), termos proibidos, aviso obrigatório, origem de mídia; LLM (modelo pequeno) só acrescenta achados citando texto existente | `paid_external_call` |
| Render | edit plan | `renders`, `render_report` | Remotion preview/master, loudnorm, hash, capa, custo de computação | `render_media`, `read_original_media` |
| QA | master real, relatórios, aprovações | `qa_report` | técnico (35 %), editorial (25 %), marca (20 %), compliance (20 %); faixas: ≥ 90 pronto, 75–89 alertas, 60–74 revisão, < 60 bloqueado; bloqueios técnicos e compliance não decidido forçam BLOCKED | — |
| Distribuição | master, QA, legendas, roteiro, métricas | `delivery_package` | ZIP com hashes, legenda de publicação, custos e tempos; `publishing: "not_published"` | — |

## Prompt-base do orquestrador

Em `packages/agents/src/director/index.ts` (`DIRECTOR_SYSTEM_PROMPT`), idêntico à seção 17. O orquestrador de etapas em si é código determinístico (`apps/worker/src/stage-runner.ts`).

## Modelos

- Padrão: `claude-opus-5-5` (`CMF_LLM_MODEL`); classificação simples (revisão de compliance): `claude-haiku-5-5` (`CMF_LLM_MODEL_SMALL`) — seção 22, "preferir modelos menores em classificação simples".
- Chamadas usam `messages.parse` com `output_config.format` (zod), `effort` explícito e *server-side fallback* (`fallbacks: "default"`) para recusas por política.
- Custo por chamada calculado pela tabela de preços em `packages/schemas/src/cost.ts` e somado ao `agent_run`.
- Limitação: o caminho com LLM foi implementado contra o SDK oficial e tipado, mas **não foi exercitado contra a API real** neste ambiente (sem chave). Ver relatório final.
