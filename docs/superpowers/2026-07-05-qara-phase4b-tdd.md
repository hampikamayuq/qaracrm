# Qara Clinic — Fase 4B TDD evidence

**Plano fonte:** `docs/superpowers/plans/2026-07-05-qara-next-phases-plan.md`
**Escopo:** fallback determinístico `leads-novos-flow`.

## Jornadas

- Como paciente, quero receber uma resposta simples quando a IA falhar em dúvidas administrativas, para não ficar sem retorno.
- Como recepção, quero que riscos clínicos, foto, pós-operatório e reclamação vão para humano, para evitar resposta automática insegura.

## RED

| Garantia | Comando | RED observado |
|---|---|---|
| Matcher determinístico existe | `yarn test:unit src/lib/leads-novos/matcher.test.ts` | falhou porque `./matcher` não existia |
| Logic function determinística existe | `yarn test:unit src/logic-functions/leads-novos-flow.test.ts` | falhou porque `./leads-novos-flow` não existia |
| Tawany chama fallback antes de handoff | `yarn test:unit src/logic-functions/tawany-handler.test.ts` | falhou porque erro do AI client ainda retornava `handoff` direto |

## GREEN

| Garantia | Teste | Resultado |
|---|---|---|
| Regras seguras fazem match; risco não faz | `src/lib/leads-novos/matcher.test.ts` | PASS, 3 testes |
| Flow envia resposta segura e registra atividade | `src/logic-functions/leads-novos-flow.test.ts` | PASS, 4 testes |
| Flow handoff em no-match, risco e erro de envio | `src/logic-functions/leads-novos-flow.test.ts` | PASS |
| Tawany tenta `leads-novos-flow` em erro externo | `src/logic-functions/tawany-handler.test.ts` | PASS, 16 testes |

## Verificação final

- `yarn typecheck` — PASS
- `yarn test:unit` — PASS, 29 files / 192 tests
- `yarn lint` — PASS, 0 warnings / 0 errors

## Gaps

- Regras são deliberadamente pequenas e fixas no código.
- Sem construtor visual de fluxo.
- Sem resposta automática para qualquer texto clínico ou sensível.
