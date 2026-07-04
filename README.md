This is a [Twenty](https://twenty.com) application bootstrapped with [`create-twenty-app`](https://www.npmjs.com/package/create-twenty-app).

## Getting Started

This app was scaffolded with a local Twenty server running at [http://localhost:2020](http://localhost:2020).

Login with the default development credentials: `tim@apple.dev` / `tim@apple.dev`.

Run `yarn twenty help` to list all available commands.

## Useful Commands

- `yarn twenty dev` - Start the development server and sync your app
- `yarn twenty docker:status` - Check the local Twenty server status
- `yarn twenty docker:start` - Start the local Twenty server
- `yarn lint` - Lint the project with oxlint
- `yarn typecheck` - Type-check the project
- `yarn test:unit` - Run unit tests
- `yarn test` - Run integration tests

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
