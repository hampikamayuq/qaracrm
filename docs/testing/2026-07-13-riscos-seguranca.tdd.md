# Evidência TDD — riscos de segurança e compatibilidade

## Escopo

Jornadas derivadas da revisão de 13/07/2026:

- A equipe autentica sem expor JWT ao JavaScript ou à URL do SSE.
- Mutações autenticadas por cookie rejeitam origens não confiáveis.
- Erros internos não vazam detalhes de banco aos clientes.
- O runtime standalone não encaminha dados ao Twenty.
- A web usa dependências Radix compatíveis com React 19.

## RED → GREEN

| Garantia | RED observado | GREEN |
|---|---|---|
| Login grava cookie HttpOnly e não retorna token | `auth-routes.test.ts`: cookie ausente e token presente no JSON | 4/4 testes da rota de auth |
| Middleware aceita cookie e bloqueia CSRF | `auth-middleware.test.ts`: cookie retornava 401 e origem hostil não retornava 403 | 6/6 testes do middleware |
| SSE usa cookie e rejeita query token | `events-routes.test.ts`: cookie ignorado e query aceita | 2/2 testes da rota SSE |
| Respostas 5xx são sanitizadas | `production.test.ts`: middleware inexistente | 5/5 testes de hardening |
| Cookie malformado não derruba auth | `session-cookie.test.ts`: `URIError` | 4/4 testes do cookie |
| CSV não expõe erro por linha | erro de banco aparecia no envelope | 7/7 testes de webhook/CSV |

Comandos finais executados:

```bash
pnpm --filter @qara/api test
cd apps/api && npx tsc -p tsconfig.build.json --noEmit
pnpm --filter @qara/api lint
pnpm --filter @qara/web build
pnpm --filter @qara/web test:routes
pnpm audit --prod --audit-level moderate
```

Resultados: 833 testes unitários passaram; typecheck, lint, build, 11 rotas web e audit passaram. A suíte de integração não rodou porque não havia Postgres local ativo. O repositório não possui script de coverage configurado, portanto não foi produzido percentual de cobertura.
