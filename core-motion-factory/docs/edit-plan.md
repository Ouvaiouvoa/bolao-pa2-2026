# Contrato do `edit_plan.json` (schemaVersion 1.0)

Fonte: `packages/schemas/src/edit-plan.ts` (schema zod **estrito**) + `validate-edit-plan.ts` (regras semânticas). Toda versão é imutável; editar cria uma nova versão (`edit_plans.version`), preservando o histórico. A única porta de entrada no banco é `createEditPlanVersion`, que valida antes de gravar.

## Estrutura

```jsonc
{
  "schemaVersion": "1.0",
  "projectId": "prj_…",
  "composition": { "width": 1080, "height": 1920, "fps": 30, "durationInFrames": 903, "backgroundColor": "#111111" },
  "tracks": [
    { "id": "video-main", "type": "video", "locked": false, "muted": false, "items": [
      { "id": "clip-001", "assetId": "ast_…", "fromFrame": 0, "durationInFrames": 150,
        "sourceStartMs": 2966.667, "sourceEndMs": 7966.667, "fit": "cover",
        "focus": { "x": 0.35, "y": 0.5 },            // reframing do sujeito (0..1 da fonte)
        "transform": { "x": 0, "y": 0, "scale": 1.12, "rotation": 0 },
        "volume": 1.4, "label": "Você sabia que…", "beatId": "beat_01" } ] },
    { "id": "captions-main", "type": "captions", "items": [
      { "id": "cap-0001", "fromFrame": 3, "durationInFrames": 48, "lines": ["Você sabia que 3", "em cada quatro"],
        "words": [{ "text": "Você", "startFrame": 3, "endFrame": 9, "highlight": false }],
        "preset": "bold-pop", "bottomPercent": 22, "color": "#FFFFFF", "highlightColor": "accent", "fontFamily": "Inter" } ] },
    { "id": "motion-main", "type": "motion", "items": [
      { "id": "mo-hook", "kind": "hook_title", "fromFrame": 0, "durationInFrames": 84,
        "box": { "x": 8, "y": 16, "w": 84, "h": 20 }, "text": "…", "emphasis": ["3"], "color": "#FFFFFF", "accentColor": "accent" } ] },
    { "id": "audio-main", "type": "audio", "items": [
      { "id": "music-bed", "kind": "music", "assetId": "ast_…", "fromFrame": 0, "durationInFrames": 903, "volume": 0.18,
        "ducking": { "enabled": true, "duckedVolume": 0.06, "attackFrames": 6, "releaseFrames": 12, "ranges": [[0, 880]] },
        "origin": "gerada: cmf-ambient-pad v1 (síntese procedural, sem licença de terceiros)" } ] }
  ],
  "brandId": "brand_…",
  "templateId": "tpl_authority_001",
  "metadata": { "createdBy": "agent-editor", "createdAt": "2026-11-07T00:00:00Z", "basedOnVersion": null, "notes": "" }
}
```

Elementos de motion: `hook_title`, `lower_third`, `callout`, `cta`, `progress_bar`, `logo`, `footer`. Cores são **papéis da marca** (`primary`, `secondary`, `accent`, `success`, `danger`) ou hex explicitamente permitido no kit.

## Validações (seção 12)

| Código | Regra |
|---|---|
| `SCHEMA` | propriedade desconhecida, tipo inválido, duração ≤ 0, volume fora de 0–2 (vídeo) / 0–1 (áudio) |
| `SOURCE_RANGE_INVALID` | `sourceEndMs` ≤ `sourceStartMs` |
| `SOURCE_DURATION_MISMATCH` | trecho de origem ≠ duração do item (± 1 frame) |
| `SOURCE_EXCEEDS_ASSET` | trecho além do fim do asset |
| `ASSET_NOT_FOUND` / `ASSET_FOREIGN_ORG` / `ASSET_KIND_MISMATCH` | asset inexistente, de outra organização ou de tipo errado |
| `COLOR_NOT_IN_BRAND` / `FONT_NOT_APPROVED` | cor/fonte fora do kit aprovado |
| `ITEM_EXCEEDS_COMPOSITION` | item termina após o fim da composição |
| `TEXT_OUTSIDE_SAFE_AREA` | legenda abaixo da área segura inferior ou caixa de texto fora da zona segura da plataforma |
| `CAPTION_TOO_MANY_LINES` / `CAPTION_LINE_TOO_LONG` (aviso) / `CAPTION_WORD_OUTSIDE_ITEM` | regras de legenda |
| `VIDEO_OVERLAP` / `VIDEO_GAP` (aviso) | clipes sobrepostos / lacuna |
| `DUPLICATE_ID`, `PROJECT_MISMATCH`, `BRAND_MISMATCH` | integridade |

Zonas seguras por proporção (`SAFE_ZONES`): 9:16 topo 8 %, base 12 %, laterais 6 %; 1:1 5/6/5; 16:9 5/8/5.
