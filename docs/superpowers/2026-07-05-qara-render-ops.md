# Qara Clinic Production Ops

Supersedes the earlier Twenty-based version of this doc. The project migrated
off Twenty to a standalone monorepo (`apps/api` Express + `apps/web` Next.js +
Prisma/Postgres) — see
`docs/superpowers/plans/2026-07-05-qara-crm-standalone.md`. Nothing here
depends on the Twenty runtime, `twenty-sdk/cli`, or `cronTriggerSettings`.

## Services to deploy

Two independently deployable services, one shared Postgres database:

| Service | What | Build | Start |
|---|---|---|---|
| `apps/api` | Express REST API, Prisma, scheduler | `pnpm --filter @qara/api build` | `pnpm --filter @qara/api start` |
| `apps/web` | Next.js Inbox/Pipeline UI | `pnpm --filter @qara/web build` | `pnpm --filter @qara/web start` |

Any host that runs a long-lived Node process works (Render, Fly, Railway, a
VM). `apps/web` can alternatively go on Vercel since it's a standard Next.js
app — pick one, don't run two hosting stacks for no reason.

The API must run as an **always-on web service**, not a one-shot job: the
D-1 reminder / follow-up scheduler (`src/lib/scheduler.ts`) is an in-process
`setInterval`, gated by `ENABLE_SCHEDULER=true`. No external cron job is
needed — the process just has to stay alive. If the host suspends idle
services (e.g. a free tier that sleeps), the scheduler will not fire while
asleep; use a plan/tier that keeps the API resident.

## Canonical URLs (live desde 05/07/2026)

- API (Render): `https://cliniqara-crm.onrender.com`
- Web (Vercel): `https://web-indol-ten-37.vercel.app`
- Meta webhook (point the Meta App here): `https://cliniqara-crm.onrender.com/api/webhooks/meta`
- `OPENROUTER_HTTP_REFERER=https://cliniqara-crm.onrender.com`
- `CORS_ORIGIN` / `CORS_DOMAIN` on the API = the web service's URL
- `NEXT_PUBLIC_API_URL` on the web app = `https://cliniqara-crm.onrender.com/api`

## Where values live

- `apps/api/.env.example` mirrors every var the API reads — no secrets committed.
- `apps/web/.env.example` mirrors `NEXT_PUBLIC_API_URL` — Next.js bakes
  `NEXT_PUBLIC_*` vars in at build time, so set it in the host's env *before*
  the build step, not just at runtime.
- Real secrets (`JWT_SECRET`, `META_APP_SECRET`, `META_ACCESS_TOKEN`,
  `OPENROUTER_API_KEY`, `ADMIN_PASSWORD`, `DATABASE_URL`) go directly into the
  hosting platform's environment variable settings for each service — there
  is no separate "workspace variables" layer anymore.

## Activation checklist

- [ ] Provision the API host (Postgres included or pointed at a managed instance).
- [ ] Provision the web host (or Vercel project).
- [ ] Set API env vars from `apps/api/.env.example`, filled with real values.
- [ ] Set `NEXT_PUBLIC_API_URL` on the web host, then trigger a build (not just a restart).
- [ ] Run `pnpm --filter @qara/api db:migrate:deploy` against the production database (non-interactive; do **not** use `db:migrate`/`prisma migrate dev` in production).
- [ ] Run `pnpm --filter @qara/api db:seed` once, then rotate `ADMIN_PASSWORD`.
- [ ] Set `ENABLE_SCHEDULER=true` on the API once follow-up sending is ready to go live.
- [ ] Configure the Meta App webhook to `https://<api-service>.example.com/api/webhooks/meta`, verify token = `META_VERIFY_TOKEN`.
- [ ] Send one real inbound WhatsApp message; confirm inbound `chatMessage`, a Tawany reply or handoff, and outbound delivery status.
- [ ] Confirm `SHADOW_MODE` is set deliberately (`shadow` while validating, unset/`live` only after Task 11's acceptance criteria are met — see the standalone migration plan's Task 11 section).
- [ ] Set up Postgres backups/restore (see `apps/api/scripts/` backup script from Task 15) on whatever host owns the database.

## Notes

- Backups (Task 15): `scripts/backup-db.sh` (repo root) already runs `pg_dump` and prunes to the last 30 backups; wire it to the host's cron/scheduled-job feature, not the in-process app scheduler.
- `TWENTY_FORWARD_URL` / `SHADOW_MODE` (Task 11) only matter if you are still
  running the old Twenty instance in parallel for shadow-mode comparison.
  Once Twenty is fully decommissioned, drop both.
