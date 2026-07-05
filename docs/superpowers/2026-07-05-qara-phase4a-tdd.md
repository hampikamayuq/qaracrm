# Qara Clinic — Fase 4A TDD evidence

**Plano fonte:** `docs/superpowers/plans/2026-07-05-qara-next-phases-plan.md`
**Escopo:** AI fallback + auditoria mínima.

## Jornadas

- Como operador da clínica, quero que a Tawany tente um modelo fallback quando o principal falhar, para reduzir handoff por instabilidade do provider.
- Como operador da clínica, quero logs persistentes mínimos das chamadas de IA, para auditar resposta, guardrails e falhas sem depender só de `console.log`.

## RED

| Garantia | Comando | RED observado |
|---|---|---|
| Server variables de fallback existem | `yarn test:unit src/__tests__/application-config.test.ts` | falhou em `missing DEFAULT_MODEL_PATIENT_FALLBACK` |
| AI client tenta fallback e expõe modelo usado | `yarn test:unit src/lib/ai-client.test.ts` | falhou com `OpenRouter 503: model unavailable` no primeiro modelo |
| Tawany passa lista de fallback ao AI client | `yarn test:unit src/logic-functions/tawany-handler.test.ts` | recebeu string única em vez de `['minimax/minimax-m3', 'z-ai/glm-5.2']` |
| Classificador passa lista de fallback interno | `yarn test:unit src/lib/classification/orchestrator.test.ts` | recebeu string única em vez de `['deepseek/deepseek-chat', 'z-ai/glm-5.2']` |
| Helper e objeto `aiRunLog` existem | `yarn test:unit src/lib/ai-run-log.test.ts` + `yarn test:unit src/objects/ai-run-log.object.test.ts` | módulos ainda não existiam |
| Tawany/classifier/scorer gravam audit log | `yarn test:unit src/logic-functions/tawany-handler.test.ts` | `recordAiRun` tinha 0 chamadas |

## GREEN

| Garantia | Teste | Resultado |
|---|---|---|
| Fallback de modelo no `ai-client` | `src/lib/ai-client.test.ts` | PASS, 8 testes |
| Config de fallback/timeout/log | `src/__tests__/application-config.test.ts` | PASS, 3 testes |
| Tawany usa fallback e grava log de sucesso/guard | `src/logic-functions/tawany-handler.test.ts` | PASS, 16 testes |
| Classificador usa fallback interno | `src/lib/classification/orchestrator.test.ts` | PASS, 7 testes |
| Scorer LLM segue compatível | `src/lib/lead-score/llm.test.ts` | PASS, 8 testes |
| Helper best-effort de audit log | `src/lib/ai-run-log.test.ts` | PASS, 2 testes |
| Objeto técnico de audit log | `src/objects/ai-run-log.object.test.ts` | PASS, 1 teste |

## Verificação final

- `yarn typecheck` — PASS
- `yarn test:unit` — PASS, 27 files / 185 tests
- `yarn lint` — PASS, 0 warnings / 0 errors

## Gaps

- Coverage não foi rodado porque o projeto não tem script de coverage configurado.
- `aiRunLog` é objeto técnico sem view/sidebar por enquanto.
- Logs não salvam prompt completo por padrão para evitar PHI.
