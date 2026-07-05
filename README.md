# Qara Clinic

Twenty CRM application for a Brazilian aesthetic clinic. Adds a Tawany AI
concierge (WhatsApp/Instagram), a lead kanban, and a WhatsApp inbox on top
of Twenty's standard CRM.

Built with the [Twenty SDK](https://www.npmjs.com/package/create-twenty-app)
(`twenty-sdk/define`).

## What's in the box

| Module | Path | What it does |
| --- | --- | --- |
| Objects | `src/objects/` | `lead`, `patient`, `conversation`, `chatMessage`, `professional`, `service`, `clinicUnit` |
| Tawany agent | `src/agents/tawany.agent.ts` | Patient-facing AI concierge (OpenRouter) |
| Tawany handler | `src/logic-functions/tawany-handler.ts` | DB-event LF: classifies inbound messages, replies via agent, escalates to human |
| Summarize | `src/logic-functions/summarize-conversation.ts` | On-demand conversation summarization |
| Skills | `src/skills/` | `tawany-persona`, `qara-classifier`, `qara-knowledge` |
| Front-components | `src/front-components/` | `whatsapp-inbox`, `lead-kanban`, `tawany-panel` |
| Layouts | `src/page-layouts/` + `src/navigation-menu-items/` | Inbox + Kanban pages reachable from the sidebar |
| Commands | `src/command-menu-items/` | Cmd+K entries to open Inbox / Kanban |
| Default role | `src/default-role.ts` | Function role used by Tawany LFs (read/update records, no hard delete) |
| Server variables | `src/application-config.ts` | OpenRouter, Meta, AI fallback/timeout, and audit-log knobs |

## Getting Started

Local Twenty dev server runs at [http://localhost:2020](http://localhost:2020).
Login with `tim@apple.dev` / `tim@apple.dev`.

```bash
yarn twenty docker:start        # start the local Twenty stack (one-time)
yarn twenty docker:status       # check status
yarn twenty dev                 # build + sync + watch
yarn twenty dev --once          # one-shot sync (CI / smoke)
```

Open the workspace, install the app, and the Tawany items appear in the
left sidebar.

## Render Target

The Twenty server URL can be the Render web service URL. Use the same base URL
consistently:

- `TWENTY_DEPLOY_URL=https://<render-twenty-service>.onrender.com`
- Meta webhook: `https://<render-twenty-service>.onrender.com/s/meta/webhook`
- `OPENROUTER_HTTP_REFERER=https://<render-twenty-service>.onrender.com`

Keep real secrets out of the repo. `.env.example` documents local/deploy names,
and `docs/superpowers/2026-07-05-qara-render-ops.md` has the activation
checklist.

## Useful Commands

- `yarn twenty dev` — build + sync + watch
- `yarn twenty dev --once` — one-shot sync
- `yarn twenty dev:build` — build manifest only
- `yarn twenty dev:add <entity>` — scaffold a new object / field / LF / view / etc.
- `yarn typecheck` — TS check via tsgo
- `yarn lint` — oxlint
- `yarn test:unit` — Vitest unit suite
- `yarn test` — integration tests
- `bash scripts/smoke.sh` — typecheck + tests + lint + build (use before opening a PR)

## Learn More

- [Twenty Apps documentation](https://docs.twenty.com/developers/extend/apps/getting-started/quick-start)
- [twenty-sdk CLI reference](https://www.npmjs.com/package/twenty-sdk)
- [Discord](https://discord.gg/cx5n4Jzs57)

## SDK notes (spike 2026-07-04)

Validated against the local `twenty-app-dev` Docker image:

- **DB-event trigger payload**: `event.properties.after` carries the FULL created record (typed via `DatabaseEventPayload<ObjectRecordCreateEvent<T>>`). There is no trigger-level filter — gate inside the handler.
- **CoreApiClient single-record query**: `client.query({ spike: { __args: { filter: { id: { eq } } }, id: true, name: true } })` → `result.spike` is the record object itself (NOT an array).
- **REST create**: `POST /rest/<namePlural>` with Bearer key → `data.create<Singular>`.
- **Objects**: require `nameSingular/namePlural/labelSingular/labelPlural`, per-field `universalIdentifier`, and `labelIdentifierFieldMetadataUniversalIdentifier`. SELECT options need `{ id, value, label, position, color }` and quoted defaultValue (`"'DRAFT'"`).
- **App config file**: `src/application-config.ts` (hyphen). Entities auto-discovered from `src/`.
- **LF logs**: `yarn twenty dev:function:logs --functionName <name>` streams only NEW entries — attach before firing.
- **Sync**: `yarn twenty dev --once` (one-shot) / `--dry-run` to preview.
- **Default role**: `defineApplicationRole()` in `src/default-role.ts`. The `defaultRoleUniversalIdentifier` field on `defineApplication()` is deprecated — omit it and let the sync auto-link the role file by UUID.

### Object-layer notes (2026-07-04)

- SELECT/MULTI_SELECT option `value` MUST be UPPER_SNAKE_CASE (`'NOVO'`, `'LEAD_QUENTE'`); `label` stays human. `defaultValue` quotes the UPPER value: `"'NOVO'"`.
- `message` nameSingular collides with the built-in email `message` object → ours is `chatMessage`/`chatMessages`.
- `address` is a reserved field name → `unitAddress`.
- Custom objects automatically receive `searchVector`, `timelineActivities`, `attachments`, `noteTargets`, `taskTargets` — do NOT declare them. Built-in Task/Note attach to custom objects out of the box (we dropped the custom `task` object for this reason).
- Tags are MULTI_SELECT fields on lead/patient/conversation (8 fixed colored options) — replaced the custom tag object + 3 N:M join objects.
- Relations = a pair of `defineField` files (M2O with `joinColumnName` + O2M inverse), cross-referencing UIDs; built-in targets via `STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS` from `twenty-sdk/define`.
- **Container DNS**: if LF execution fails with `EAI_AGAIN registry.yarnpkg.com`, the twenty-app-dev container lost DNS (systemd-resolved + Docker). Ephemeral fix: `docker exec -u root <container> sh -c 'printf "nameserver 8.8.8.8\n" > /etc/resolv.conf'`. Durable fix: add `{"dns": ["8.8.8.8"]}` to /etc/docker/daemon.json (needs root).
- FULL_NAME create input is composite: `{ name: { firstName, lastName } }`.
