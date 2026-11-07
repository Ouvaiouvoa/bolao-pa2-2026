# Segurança, privacidade e governança (seção 21)

| Requisito | Implementação | Onde |
|---|---|---|
| Isolamento por `organization_id` | Toda consulta de projeto/marca/asset filtra pela organização da sessão; `getProject`/`getBrand` lançam *não encontrado* para outros tenants; chaves de storage começam por `org/<id>/` e o acesso a arquivos verifica a organização da sessão além da assinatura; validação do edit plan rejeita assets de outra organização (`ASSET_FOREIGN_ORG`) | `packages/orchestration/src/repos.ts`, `apps/web/app/api/files/[...key]/route.ts`, teste de integração "isolamento" |
| Autenticação | E-mail + senha com scrypt (N=16384), sessão por token aleatório de 256 bits (cookie `httpOnly`, `sameSite=lax`, `secure` em produção), apenas o SHA-256 do token no banco, expiração de 7 dias | `packages/orchestration/src/auth.ts` |
| RBAC | Matriz perfil → permissão; cliente aprovador não vê custos, logs, trace, configurações | `packages/schemas/src/roles.ts`, `apps/web/lib/server/api.ts` |
| URLs assinadas curtas | HMAC-SHA256 com expiração (padrão 15 min; snapshot 60 min) para arquivos e partes de upload; S3 presigned em produção | `packages/storage` |
| Originais imutáveis | Upload multipart finaliza o original com permissão somente leitura; `putFile(…, {immutable})` recusa sobrescrita; S3 com `IfNoneMatch: *` | `packages/storage/src/index.ts` |
| Criptografia | Trânsito: TLS no proxy/ingress; repouso: S3 com SSE-AES256 (local: disco criptografado do host) | `docs/deploy.md` |
| Segredos | Apenas variáveis de ambiente/cofre; `.env.example` sem valores reais; nada de segredo no banco | `.env.example` |
| Logs sem conteúdo sensível | Logger JSON com redação de chaves (`password`, `token`, `secret`, `authorization`, `api_key`, `cookie`); logs carregam ids e métricas, não mídia nem transcrições | `packages/observability` |
| Erros ao cliente | Código + mensagem; nunca stack trace; `request_id` para correlação | `apps/web/lib/server/api.ts`, `app/error.tsx` |
| Política de IA | Por organização: provedores externos desabilitados por padrão; treinamento com dados do cliente sempre `false`; provedor e modelo registrados em cada `agent_run` | `organizations.settings_json`, `agent_runs.model` |
| Uploads | MIME real por *magic bytes* (SVG recusado por poder conter scripts), limites de tipo por finalidade, verificação de tamanho e checksum | `packages/media/src/probe.ts`, `packages/orchestration/src/uploads.ts` |
| Arquivos servidos | `Content-Security-Policy: default-src 'none'; sandbox`, `nosniff`, `X-Frame-Options: DENY` | rota de arquivos, `next.config.ts` |
| Ferramentas dos agentes | Mínimo privilégio: ferramentas restritas só com concessão explícita, negação registrada | `apps/worker/src/tools.ts` |
| Aprovação antes de publicar | Não existe integração de publicação; o pacote declara `publishing: "not_published"`; master só é entregue após `Approval` humano | `packages/agents/src/distribution` |
| Auditoria exportável | `GET /api/projects/:id/audit` (JSON) e `?format=csv`; transições, aprovações e eventos com `trace_id` | rota de auditoria |
| Retenção | `retentionDays` por organização (configurável). **Pendente**: job de purge controlado (ver relatório final) | `organizations.settings_json` |
| Exclusão lógica | `projects.deleted_at` respeitado em todas as listagens. **Pendente**: endpoint de exclusão + purge | schema |
| Consentimento voz/rosto/dados pessoais | Compliance sinaliza dados pessoais (CPF, telefone, e-mail, CEP) como alto, a menos que a marca registre consentimento (`allowPersonalData`) | Agente Compliance |
