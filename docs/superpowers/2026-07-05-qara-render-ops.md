# Qara Clinic Render Ops

Status on 2026-07-05: Render is an accepted target for the Twenty server URL.

## Canonical URLs

Use one Render web service URL consistently:

- Twenty deploy target: `TWENTY_DEPLOY_URL=https://<render-twenty-service>.onrender.com`
- Meta webhook: `https://<render-twenty-service>.onrender.com/s/meta/webhook`
- OpenRouter referer: `OPENROUTER_HTTP_REFERER=https://<render-twenty-service>.onrender.com`

Replace `<render-twenty-service>` with the real Render service hostname before
sync/deploy or Meta configuration.

## Where Values Live

Render web service environment:

- Twenty server infrastructure: `APP_SECRET`, `DATABASE_URL`, `REDIS_URL`, and
  any other variables required by the hosted Twenty server.

Twenty workspace app server variables:

- OpenRouter: `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`,
  `OPENROUTER_HTTP_REFERER`, `OPENROUTER_APP_NAME`,
  `DEFAULT_MODEL_PATIENT`, `DEFAULT_MODEL_PATIENT_FALLBACK`,
  `DEFAULT_MODEL_INTERNAL`, `DEFAULT_MODEL_INTERNAL_FALLBACK`,
  `AI_TIMEOUT_MS`, `AI_LOG_FULL_PROMPTS`
- Meta: `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID`, `META_VERIFY_TOKEN`,
  `META_APP_SECRET`, `META_GRAPH_BASE_URL`

Local or CI deploy environment:

- `TWENTY_DEPLOY_URL`
- `TWENTY_DEPLOY_API_KEY`
- `TWENTY_API_URL` and `TWENTY_API_KEY` only for integration/smoke tests

`.env.example` mirrors these names without secrets.

## Activation Checklist

- [ ] Provision or confirm the Render web service that hosts Twenty.
- [ ] Provision or confirm Postgres, Redis, backups, and restore access for that
      Render environment.
- [ ] Set `TWENTY_DEPLOY_URL` to the Render service URL.
- [ ] Set `TWENTY_DEPLOY_API_KEY` in the local/CI deploy environment.
- [ ] Sync the app manifest with `yarn twenty dev --once` or the equivalent
      deploy flow.
- [ ] Fill the app server variables in the Twenty workspace.
- [ ] Configure the Meta App webhook to
      `https://<render-twenty-service>.onrender.com/s/meta/webhook`.
- [ ] Run a signed Meta webhook smoke test against the Render URL.
- [ ] Send one real inbound WhatsApp message and verify inbound `chatMessage`,
      Tawany reply or handoff, and outbound delivery status.

## Follow-Up Scheduler

`followup-engine` already declares:

```ts
cronTriggerSettings: { pattern: '0 8 * * *' }
```

After syncing to the Render-backed Twenty server, verify that the Twenty runtime
executes this logic function daily at 08:00. If it does not execute in that
environment, use a Render Cron Job only after confirming the callable logic
function endpoint and auth token for that deployment.
