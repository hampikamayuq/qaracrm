# Standalone API RBAC + LGPD TDD

Data: 2026-07-08

## Escopo

- Bloquear mutações administrativas de configurações e bots para papéis não-admin.
- Restringir exportação CSV de relatórios a papéis com necessidade operacional: `admin`, `financeiro`, `finance` e `marketing`.
- Preservar o cadastro operacional do paciente ao anonimizar lead/conversa, já que nome, CPF e dados cadastrais podem ser necessários para documentos, agenda e continuidade assistencial.
- Exigir confirmação explícita (`confirmAnonymize: true`) antes de executar anonimização de lead/conversa.

## RED

Comando:

```bash
pnpm --filter @qara/api exec vitest run src/routes/settings-routes.test.ts src/routes/bot-routes.test.ts src/routes/report-routes.test.ts src/lib/lgpd.test.ts
```

Falhas esperadas antes da implementação:

- `PUT /api/settings/knowledge/:slug` com papel `recepcao` não retornava `403`.
- Mutações de `/api/bots` com papel `recepcao` chegavam às rotas internas em vez de parar em autorização.
- `GET /api/reports/:tipo/export.csv` com papel sem permissão retornava `200`.
- `anonymizeLead` foi validado para não apagar `patient`: a anonimização do lead/conversa não deve destruir cadastro assistencial/administrativo.
- `POST /api/lgpd/anonymize` não executa anonimização sem confirmação explícita.

## GREEN

Comandos executados após a implementação:

```bash
pnpm --filter @qara/api exec vitest run src/routes/settings-routes.test.ts src/routes/bot-routes.test.ts src/routes/report-routes.test.ts src/lib/lgpd.test.ts
pnpm --filter @qara/api exec tsc -p tsconfig.spec.json --noEmit
pnpm --filter @qara/api exec tsc -p tsconfig.json --noEmit
pnpm --filter @qara/api exec tsc -p tsconfig.build.json --noEmit
pnpm --filter @qara/api test
```

Resultado:

- Testes focados: 4 arquivos, 43 testes passando.
- Typecheck spec, app e build: passando.
- Suíte API completa: 57 arquivos, 425 testes passando.

## Mudanças

- Novo middleware `requireAnyRole`, `requireRole`, `requireAdmin` e `requireReportExportRole`.
- `settings-routes`: edição da base de conhecimento exige admin.
- `bot-routes`: criação/importação/duplicação/reversão/edição/toggle/remoção exigem admin.
- `report-routes`: exportação CSV exige papel autorizado.
- `lgpd`: anonimização preserva `patient` e limpa apenas lead, conteúdo de conversa, sugestões e notas de appointment vinculadas ao lead.
- `lgpd-routes`: `anonymizeLeadRoute` exige `confirmAnonymize: true`; sem essa opção, responde `400` sem alterar dados.
