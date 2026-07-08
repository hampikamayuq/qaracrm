# P1-P3 Agent Improvements TDD

Data: 2026-07-08

## Escopo

- P1: modo híbrido backend com setting persistido, allowlist de intenções e decisão por risco.
- P1: `riskLevel` real básico por sugestão (`low`, `medium`, `high`) em vez de hardcoded.
- P2: persistência e exposição de tokens/custo estimado nos logs/dashboard da Tawany.
- P3: guards adicionais para preço sem KB e CPF em respostas.
- P3: rate limit de envio WhatsApp por conversa.

## RED

Comando:

```bash
pnpm --filter @qara/api exec vitest run src/lib/guards/reply-validator.test.ts src/lib/ai-run-log.test.ts src/logic-functions/tawany-handler.test.ts src/lib/tools/tools.test.ts src/routes/settings-routes.test.ts
```

Falhas esperadas antes da implementação:

- `validateReply` aceitava "500 reais" sem preço cadastrado na KB.
- `validateReply` aceitava CPF em resposta.
- `recordAiRun` ignorava tokens/custo.
- `sendWhatsApp` não tinha rate limit por conversa.
- `/api/settings/ai` não salvava modo híbrido/intents.
- `runTawany` não enviava por decisão híbrida nem elevava risco de preço para `medium`.

## GREEN

Comandos executados após a implementação:

```bash
pnpm --filter @qara/api exec vitest run src/routes/dashboard-routes.test.ts src/lib/guards/reply-validator.test.ts src/lib/ai-run-log.test.ts src/logic-functions/tawany-handler.test.ts src/lib/tools/tools.test.ts src/routes/settings-routes.test.ts
pnpm --filter @qara/api exec prisma generate
pnpm --filter @qara/api exec tsc -p tsconfig.spec.json --noEmit
pnpm --filter @qara/api exec tsc -p tsconfig.json --noEmit
pnpm --filter @qara/api exec tsc -p tsconfig.build.json --noEmit
pnpm --filter @qara/api test
```

Resultado:

- Testes focados finais: 6 arquivos, 98 testes passando.
- Typecheck spec, app e build: passando.
- Suíte API completa: 57 arquivos, 439 testes passando.

## Garantias

| # | Garantia | Teste |
|---|----------|-------|
| 1 | `/api/settings/ai` retorna e persiste `mode` + `autopilotIntents`, admin-only. | `src/routes/settings-routes.test.ts` |
| 2 | Modo `hibrido` envia automaticamente apenas resposta `low` com intenção em allowlist. | `src/logic-functions/tawany-handler.test.ts` |
| 3 | Resposta com preço fica `medium` e permanece `PENDING` em modo híbrido. | `src/logic-functions/tawany-handler.test.ts` |
| 4 | `AiRunLog` recebe tokens e custo estimado. | `src/lib/ai-run-log.test.ts` |
| 5 | Dashboard Tawany expõe soma de tokens e custo estimado. | `src/routes/dashboard-routes.test.ts` |
| 6 | Guard bloqueia preço quando não há preço conhecido na KB. | `src/lib/guards/reply-validator.test.ts` |
| 7 | Guard bloqueia CPF em resposta. | `src/lib/guards/reply-validator.test.ts` |
| 8 | `sendWhatsApp` limita envios repetidos por conversa. | `src/lib/tools/tools.test.ts` |

## Observações

- O setting da IA usa o slug reservado `__ai_settings` em `KnowledgeSection` para evitar uma migração de tabela dedicada neste estágio.
- O custo estimado é persistido com campo próprio; a fórmula atual registra `0` até haver tabela/configuração de preço por modelo.
- A UI dedicada para editar o modo híbrido ainda pode ser refinada depois; o contrato backend/API já está pronto.
