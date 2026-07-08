# P0 Agent Robustness TDD

Data: 2026-07-08

## Escopo

- Definir timeout default para chamadas de IA quando `AI_TIMEOUT_MS` estiver ausente ou inválido.
- Manter sugestão aprovada recuperável quando o envio via WhatsApp falhar.
- Reprocessar `WebhookEvent` pendente no tick do scheduler.
- Trocar o debounce real do webhook para trailing-edge, processando apenas a última mensagem após a janela quieta.

## RED

Comando:

```bash
pnpm --filter @qara/api exec vitest run src/lib/ai-client.test.ts src/routes/tawany-routes.test.ts src/lib/debounce.test.ts src/routes/meta-webhook-routes.test.ts
```

Falhas esperadas antes da implementação:

- `ai-client`: sem `AI_TIMEOUT_MS` válido, a chamada não recebia `AbortSignal`.
- `tawany-routes`: falha no envio após `APPROVED` não restaurava a sugestão para retry.
- `debounce`: o modo trailing ainda retornava `process/skip`, não `defer`, e não flushava a última mensagem.
- `meta-webhook-routes`: não existia sweep para eventos pendentes.

## GREEN

Comandos executados após a implementação:

```bash
pnpm --filter @qara/api exec vitest run src/lib/ai-client.test.ts src/routes/tawany-routes.test.ts src/lib/debounce.test.ts src/routes/meta-webhook-routes.test.ts src/logic-functions/meta-webhook.test.ts
pnpm --filter @qara/api exec vitest run src/lib/scheduler.test.ts src/app.test.ts src/lib/ai-client.test.ts src/routes/tawany-routes.test.ts src/lib/debounce.test.ts src/routes/meta-webhook-routes.test.ts src/logic-functions/meta-webhook.test.ts
pnpm --filter @qara/api exec tsc -p tsconfig.spec.json --noEmit
pnpm --filter @qara/api exec tsc -p tsconfig.json --noEmit
pnpm --filter @qara/api exec tsc -p tsconfig.build.json --noEmit
pnpm --filter @qara/api test
```

Resultado:

- Testes focados finais: 7 arquivos, 55 testes passando.
- Typecheck spec, app e build: passando.
- Suíte API completa: 57 arquivos, 433 testes passando.

## Garantias

| # | Garantia | Teste |
|---|----------|-------|
| 1 | `createAiClient` sempre usa `AbortSignal` com timeout default de 30s quando env está ausente/inválida. | `src/lib/ai-client.test.ts` |
| 2 | Aprovação humana que falha no envio volta para `PENDING`, preserva edição humana e retorna `502`. | `src/routes/tawany-routes.test.ts` |
| 3 | Eventos `WebhookEvent` pendentes são varridos, processados e marcados como `processed=true`; erros são registrados. | `src/routes/meta-webhook-routes.test.ts` |
| 4 | O scheduler chama o sweep de webhooks pendentes no tick. | `src/lib/scheduler.test.ts` |
| 5 | Debounce trailing posterga o processamento e flusha só a última mensagem da conversa. | `src/lib/debounce.test.ts` |
| 6 | O webhook real com trailing não devolve mensagem imediata e aciona o callback apenas para a última mensagem após a janela. | `src/logic-functions/meta-webhook.test.ts` |

## Observações

- O caminho sem callback do debounce foi mantido compatível para testes e usos unitários existentes (`process/skip`).
- O sweep usa processamento imediato para backlog, evitando atrasar eventos antigos por nova janela de debounce.
