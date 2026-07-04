# Qara Clinic Phase 2 — Meta (WhatsApp/Instagram) Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Phase 1 pipeline to the real Meta Cloud API: inbound WhatsApp/Instagram messages arrive via a signed webhook and create `chatMessage` records (which auto-trigger tawany-handler + summarizer), and Tawany's replies go out through the real Graph API with delivery-status tracking.

**Architecture:** Two HTTP-route logic functions (`GET` verify handshake + `POST` event receiver) exposed under Twenty's `/s/` endpoint, sharing path `/meta/webhook`. Pure helper libs (`meta-signature`, `meta-parse`, `whatsapp-client`) keep the LF handlers thin and unit-testable with the existing fake-DataApi pattern. Secrets flow through application `serverVariables` (the established OPENROUTER pattern) — **not** `defineConnectionProvider`, which the SDK only supports for `type: 'oauth'` (spec §5.1 is unimplementable as written; validated against twenty-sdk 2.18.0).

**Tech Stack:** twenty-sdk 2.18.0 (`httpRouteTriggerSettings`, `Response`, `rawBody`, `forwardedRequestHeaders`), Node `node:crypto` (HMAC-SHA256 + `timingSafeEqual`), plain `fetch` to `graph.facebook.com`, zod (already installed), vitest.

## Global Constraints

- TypeScript strict mode; named exports only; functions < 50 lines; files < 800 lines.
- SDK imports via subpaths only: `twenty-sdk/define`, `twenty-sdk/logic-function` (no root exports).
- All data access through the `DataApi` adapter (`src/lib/data.ts`) — never raw `CoreApiClient` in handlers/tools.
- All generated UUIDs must be valid UUID v4.
- TDD: failing test → minimal implementation → green → commit. Run `yarn test:unit` (vitest, jsdom env, `src/**/*.test.ts`).
- Never log message bodies or patient identifiers (PHI). Log IDs and event names only.
- Conventional commits (`feat:`, `fix:`, `test:`, `chore:`); no attribution footer.
- Working dir: `/home/diegog/projects/qara-clinic`. Verify with `yarn typecheck && yarn test:unit && yarn lint` before every commit.

## Validated API facts (do not re-derive)

- `httpRouteTriggerSettings: { path, httpMethod, isAuthRequired, forwardedRequestHeaders? }`. Route is served at `https://<server>/s/<path>`. One HTTP method per LF → two LFs for GET + POST on the same path.
- Handler receives `LogicFunctionEvent` (`RoutePayload` export): `{ headers, queryStringParameters, body, rawBody?, ... }`. `rawBody` is the pre-parse UTF-8 body — use it for HMAC. Headers are NOT forwarded unless listed in `forwardedRequestHeaders`.
- HTTP responses: `import { Response } from 'twenty-sdk/logic-function'` — `new Response(body, { status, headers })`.
- Existing schema already has every Phase 2 field: `conversation.channel` (`WHATSAPP`/`INSTAGRAM`), `conversation.externalId`, `chatMessage.externalId`, `chatMessage.messageType` (`TEXT|BUTTON|LIST|TEMPLATE|IMAGE|DOCUMENT`), `chatMessage.deliveryStatus` (`PENDING|SENT|DELIVERED|READ|FAILED`). **No object/field changes needed.**
- Creating a `chatMessage` with `direction: 'IN'` automatically fires `tawany-handler` and `summarize-conversation` (both trigger on `chatMessage.created`). The webhook does NOT call Tawany directly.
- `DataApi` filter syntax: `{ filter: { field: { eq: value } }, limit: n, select: { id: true } }`.

---

### Task 1: Meta server variables

**Files:**
- Modify: `src/application-config.ts`
- Test: `src/__tests__/application-config.test.ts`

**Interfaces:**
- Produces: `process.env.META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID`, `META_VERIFY_TOKEN`, `META_APP_SECRET`, `META_GRAPH_BASE_URL` available to logic functions after sync. All `isRequired: false` so the app still installs/runs without Meta configured (dev mode keeps the Phase 1 stub behavior).

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/application-config.test.ts`:

```ts
import applicationConfig from 'src/application-config';

describe('meta server variables', () => {
  it('declares the 4 Meta secrets + optional base URL, all optional', () => {
    const vars = applicationConfig.config.serverVariables ?? {};
    for (const name of [
      'META_ACCESS_TOKEN',
      'META_PHONE_NUMBER_ID',
      'META_VERIFY_TOKEN',
      'META_APP_SECRET',
      'META_GRAPH_BASE_URL',
    ]) {
      expect(vars, `missing ${name}`).toHaveProperty(name);
      expect(vars[name as keyof typeof vars]?.isRequired ?? false).toBe(false);
    }
    expect(vars.META_ACCESS_TOKEN?.isSecret).toBe(true);
    expect(vars.META_APP_SECRET?.isSecret).toBe(true);
    expect(vars.META_VERIFY_TOKEN?.isSecret).toBe(true);
  });
});
```

(Keep the existing `application identifiers` describe block untouched. Add the `applicationConfig` import at the top.)

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test:unit src/__tests__/application-config.test.ts`
Expected: FAIL — `serverVariables` has no META_* keys.

- [ ] **Step 3: Add the variables**

In `src/application-config.ts`, extend `serverVariables` (after `DEFAULT_MODEL_INTERNAL`):

```ts
    META_ACCESS_TOKEN: {
      description:
        'Meta Cloud API access token (WhatsApp Business). Optional: without it sendWhatsApp keeps Fase 1 stub behavior (records outbound, no real send).',
      isSecret: true,
      isRequired: false,
    },
    META_PHONE_NUMBER_ID: {
      description: 'WhatsApp Business phone number ID (Meta Cloud API).',
      isRequired: false,
    },
    META_VERIFY_TOKEN: {
      description: 'Webhook verify token (GET handshake, hub.verify_token).',
      isSecret: true,
      isRequired: false,
    },
    META_APP_SECRET: {
      description: 'Meta app secret used to verify X-Hub-Signature-256 on inbound webhooks.',
      isSecret: true,
      isRequired: false,
    },
    META_GRAPH_BASE_URL: {
      description: 'Graph API base URL. Defaults to https://graph.facebook.com/v20.0.',
      isRequired: false,
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test:unit src/__tests__/application-config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify + commit**

```bash
yarn typecheck && yarn test:unit && yarn lint
git add src/application-config.ts src/__tests__/application-config.test.ts
git commit -m "feat(config): declare Meta Cloud API server variables"
```

---

### Task 2: Webhook signature verification (`meta-signature.ts`)

**Files:**
- Create: `src/lib/meta-signature.ts`
- Test: `src/lib/meta-signature.test.ts`

**Interfaces:**
- Produces: `verifyMetaSignature(rawBody: string, signatureHeader: string | undefined, appSecret: string): boolean` — consumed by Task 7.

- [ ] **Step 1: Write the failing test**

Create `src/lib/meta-signature.test.ts`:

```ts
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyMetaSignature } from './meta-signature';

const SECRET = 'test-app-secret';
const sign = (body: string): string =>
  `sha256=${createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')}`;

describe('verifyMetaSignature', () => {
  it('accepts a valid signature', () => {
    const body = '{"object":"whatsapp_business_account"}';
    expect(verifyMetaSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifyMetaSignature('{"tampered":true}', sign('{"original":true}'), SECRET)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const body = '{"a":1}';
    const wrong = `sha256=${createHmac('sha256', 'other').update(body).digest('hex')}`;
    expect(verifyMetaSignature(body, wrong, SECRET)).toBe(false);
  });

  it('rejects missing or malformed headers', () => {
    expect(verifyMetaSignature('{}', undefined, SECRET)).toBe(false);
    expect(verifyMetaSignature('{}', 'md5=abc', SECRET)).toBe(false);
    expect(verifyMetaSignature('{}', 'sha256=short', SECRET)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test:unit src/lib/meta-signature.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/meta-signature.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'sha256=';

// Verifica X-Hub-Signature-256 (Meta) sobre o rawBody, em tempo constante.
export const verifyMetaSignature = (
  rawBody: string,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean => {
  if (!signatureHeader?.startsWith(PREFIX)) return false;
  const received = signatureHeader.slice(PREFIX.length);
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  if (received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received, 'utf8'), Buffer.from(expected, 'utf8'));
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test:unit src/lib/meta-signature.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify + commit**

```bash
yarn typecheck && yarn test:unit && yarn lint
git add src/lib/meta-signature.ts src/lib/meta-signature.test.ts
git commit -m "feat(lib): Meta webhook HMAC signature verification"
```

---

### Task 3: Meta event parser (`meta-parse.ts`)

**Files:**
- Create: `src/lib/meta-parse.ts`
- Test: `src/lib/meta-parse.test.ts`

**Interfaces:**
- Produces (consumed by Task 7):

```ts
export type MetaChannel = 'WHATSAPP' | 'INSTAGRAM';
export type MetaMessageType = 'TEXT' | 'BUTTON' | 'LIST' | 'IMAGE' | 'DOCUMENT';
export type MetaInboundMessage = {
  channel: MetaChannel;
  externalId: string;   // wamid (WA) / mid (IG)
  from: string;         // phone (WA) / IG-scoped user id
  text: string;
  sentAt: string;       // ISO datetime
  messageType: MetaMessageType;
};
export type MetaDeliveryStatus = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
export type MetaStatusUpdate = { externalId: string; status: MetaDeliveryStatus };
export type ParsedMetaEvent = { messages: MetaInboundMessage[]; statuses: MetaStatusUpdate[] };
export const parseMetaEvent = (body: unknown): ParsedMetaEvent;
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/meta-parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseMetaEvent } from './meta-parse';

const waText = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '123',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            contacts: [{ wa_id: '5511999998888', profile: { name: 'Maria' } }],
            messages: [
              {
                id: 'wamid.ABC123',
                from: '5511999998888',
                timestamp: '1751650000',
                type: 'text',
                text: { body: 'Quero agendar uma consulta' },
              },
            ],
          },
        },
      ],
    },
  ],
};

const waStatuses = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '123',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            statuses: [
              { id: 'wamid.OUT1', status: 'delivered', timestamp: '1751650100' },
              { id: 'wamid.OUT2', status: 'read', timestamp: '1751650200' },
            ],
          },
        },
      ],
    },
  ],
};

const igMessage = {
  object: 'instagram',
  entry: [
    {
      id: 'ig-page-1',
      time: 1751650000000,
      messaging: [
        {
          sender: { id: 'IGSID-42' },
          recipient: { id: 'ig-page-1' },
          timestamp: 1751650000000,
          message: { mid: 'mid.IG1', text: 'Oi, vi o post de vocês' },
        },
      ],
    },
  ],
};

describe('parseMetaEvent — WhatsApp', () => {
  it('parses a text message', () => {
    const { messages, statuses } = parseMetaEvent(waText);
    expect(statuses).toEqual([]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      channel: 'WHATSAPP',
      externalId: 'wamid.ABC123',
      from: '5511999998888',
      text: 'Quero agendar uma consulta',
      sentAt: new Date(1751650000 * 1000).toISOString(),
      messageType: 'TEXT',
    });
  });

  it('parses interactive button and list replies', () => {
    const make = (interactive: object) => ({
      ...waText,
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.I1',
                    from: '551188887777',
                    timestamp: '1751650000',
                    type: 'interactive',
                    interactive,
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const btn = parseMetaEvent(
      make({ type: 'button_reply', button_reply: { id: 'b1', title: 'Sim' } }),
    );
    expect(btn.messages[0].messageType).toBe('BUTTON');
    expect(btn.messages[0].text).toBe('Sim');

    const list = parseMetaEvent(
      make({ type: 'list_reply', list_reply: { id: 'r1', title: 'Botox' } }),
    );
    expect(list.messages[0].messageType).toBe('LIST');
    expect(list.messages[0].text).toBe('Botox');
  });

  it('parses media with placeholder text', () => {
    const body = {
      ...waText,
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.M1',
                    from: '551177776666',
                    timestamp: '1751650000',
                    type: 'image',
                    image: { caption: 'minha pele' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const { messages } = parseMetaEvent(body);
    expect(messages[0].messageType).toBe('IMAGE');
    expect(messages[0].text).toBe('minha pele');
  });

  it('parses delivery statuses', () => {
    const { messages, statuses } = parseMetaEvent(waStatuses);
    expect(messages).toEqual([]);
    expect(statuses).toEqual([
      { externalId: 'wamid.OUT1', status: 'DELIVERED' },
      { externalId: 'wamid.OUT2', status: 'READ' },
    ]);
  });
});

describe('parseMetaEvent — Instagram', () => {
  it('parses an IG DM', () => {
    const { messages } = parseMetaEvent(igMessage);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      channel: 'INSTAGRAM',
      externalId: 'mid.IG1',
      from: 'IGSID-42',
      text: 'Oi, vi o post de vocês',
      sentAt: new Date(1751650000000).toISOString(),
      messageType: 'TEXT',
    });
  });
});

describe('parseMetaEvent — garbage in', () => {
  it('returns empty for null / non-object / unknown object', () => {
    expect(parseMetaEvent(null)).toEqual({ messages: [], statuses: [] });
    expect(parseMetaEvent('x')).toEqual({ messages: [], statuses: [] });
    expect(parseMetaEvent({ object: 'page' })).toEqual({ messages: [], statuses: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test:unit src/lib/meta-parse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/meta-parse.ts`:

```ts
export type MetaChannel = 'WHATSAPP' | 'INSTAGRAM';
export type MetaMessageType = 'TEXT' | 'BUTTON' | 'LIST' | 'IMAGE' | 'DOCUMENT';

export type MetaInboundMessage = {
  channel: MetaChannel;
  externalId: string;
  from: string;
  text: string;
  sentAt: string;
  messageType: MetaMessageType;
};

export type MetaDeliveryStatus = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
export type MetaStatusUpdate = { externalId: string; status: MetaDeliveryStatus };
export type ParsedMetaEvent = { messages: MetaInboundMessage[]; statuses: MetaStatusUpdate[] };

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');

const STATUS_MAP: Record<string, MetaDeliveryStatus> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};

// Extrai texto + tipo de uma mensagem WhatsApp Cloud API.
const waContent = (msg: Rec): { text: string; messageType: MetaMessageType } => {
  const type = asStr(msg.type);
  if (type === 'text') return { text: asStr(asRec(msg.text).body), messageType: 'TEXT' };
  if (type === 'button') return { text: asStr(asRec(msg.button).text), messageType: 'BUTTON' };
  if (type === 'interactive') {
    const i = asRec(msg.interactive);
    const btn = asRec(i.button_reply);
    const list = asRec(i.list_reply);
    if (asStr(i.type) === 'list_reply') return { text: asStr(list.title), messageType: 'LIST' };
    return { text: asStr(btn.title), messageType: 'BUTTON' };
  }
  if (type === 'image') return { text: asStr(asRec(msg.image).caption) || '[imagem]', messageType: 'IMAGE' };
  if (type === 'document')
    return { text: asStr(asRec(msg.document).caption) || '[documento]', messageType: 'DOCUMENT' };
  return { text: `[${type || 'desconhecido'}]`, messageType: 'TEXT' };
};

const parseWhatsApp = (body: Rec): ParsedMetaEvent => {
  const messages: MetaInboundMessage[] = [];
  const statuses: MetaStatusUpdate[] = [];
  for (const entry of asArr(body.entry)) {
    for (const change of asArr(asRec(entry).changes)) {
      const value = asRec(asRec(change).value);
      for (const s of asArr(value.statuses)) {
        const status = STATUS_MAP[asStr(asRec(s).status)];
        const id = asStr(asRec(s).id);
        if (status && id) statuses.push({ externalId: id, status });
      }
      for (const m of asArr(value.messages)) {
        const msg = asRec(m);
        const id = asStr(msg.id);
        const from = asStr(msg.from);
        if (!id || !from) continue;
        const { text, messageType } = waContent(msg);
        messages.push({
          channel: 'WHATSAPP',
          externalId: id,
          from,
          text,
          sentAt: new Date(Number(asStr(msg.timestamp)) * 1000).toISOString(),
          messageType,
        });
      }
    }
  }
  return { messages, statuses };
};

const parseInstagram = (body: Rec): ParsedMetaEvent => {
  const messages: MetaInboundMessage[] = [];
  for (const entry of asArr(body.entry)) {
    for (const ev of asArr(asRec(entry).messaging)) {
      const e = asRec(ev);
      const msg = asRec(e.message);
      const mid = asStr(msg.mid);
      const from = asStr(asRec(e.sender).id);
      if (!mid || !from) continue;
      messages.push({
        channel: 'INSTAGRAM',
        externalId: mid,
        from,
        text: asStr(msg.text) || '[anexo]',
        sentAt: new Date(Number(e.timestamp) || Date.now()).toISOString(),
        messageType: 'TEXT',
      });
    }
  }
  return { messages, statuses: [] };
};

export const parseMetaEvent = (body: unknown): ParsedMetaEvent => {
  const rec = asRec(body);
  if (rec.object === 'whatsapp_business_account') return parseWhatsApp(rec);
  if (rec.object === 'instagram') return parseInstagram(rec);
  return { messages: [], statuses: [] };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test:unit src/lib/meta-parse.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Verify + commit**

```bash
yarn typecheck && yarn test:unit && yarn lint
git add src/lib/meta-parse.ts src/lib/meta-parse.test.ts
git commit -m "feat(lib): parse Meta webhook events (WhatsApp + Instagram, messages + statuses)"
```

---

### Task 4: Graph API send client (`whatsapp-client.ts`)

**Files:**
- Create: `src/lib/whatsapp-client.ts`
- Test: `src/lib/whatsapp-client.test.ts`

**Interfaces:**
- Produces (consumed by Task 5):

```ts
export type SendWhatsAppOptions = {
  messageType?: 'text' | 'buttons' | 'list' | 'template';
  buttons?: Array<{ id: string; title: string }>;
  listButtonText?: string;
  listSections?: Array<{ title: string; rows: Array<{ id: string; title: string }> }>;
  templateName?: string;
  languageCode?: string;
  parameters?: string[];
};
export const isMetaSendConfigured = (): boolean;
export const buildMetaPayload = (to: string, text: string, options?: SendWhatsAppOptions): Record<string, unknown>;
export const sendViaMeta = (to: string, text: string, options?: SendWhatsAppOptions): Promise<string>; // resolves wamid, throws on API error
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/whatsapp-client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMetaPayload, isMetaSendConfigured, sendViaMeta } from './whatsapp-client';

const ENV_KEYS = ['META_ACCESS_TOKEN', 'META_PHONE_NUMBER_ID', 'META_GRAPH_BASE_URL'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe('isMetaSendConfigured', () => {
  it('is false without env, true with token + phone id', () => {
    expect(isMetaSendConfigured()).toBe(false);
    process.env.META_ACCESS_TOKEN = 't';
    process.env.META_PHONE_NUMBER_ID = 'p';
    expect(isMetaSendConfigured()).toBe(true);
  });
});

describe('buildMetaPayload', () => {
  it('builds a text payload by default', () => {
    expect(buildMetaPayload('5511999998888', 'Olá')).toEqual({
      messaging_product: 'whatsapp',
      to: '5511999998888',
      type: 'text',
      text: { body: 'Olá' },
    });
  });

  it('builds a buttons payload (max 3 reply buttons)', () => {
    const p = buildMetaPayload('551', 'Confirma?', {
      messageType: 'buttons',
      buttons: [
        { id: 'y', title: 'Sim' },
        { id: 'n', title: 'Não' },
      ],
    });
    expect(p.type).toBe('interactive');
    expect(p.interactive).toEqual({
      type: 'button',
      body: { text: 'Confirma?' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'y', title: 'Sim' } },
          { type: 'reply', reply: { id: 'n', title: 'Não' } },
        ],
      },
    });
  });

  it('builds a list payload', () => {
    const p = buildMetaPayload('551', 'Escolha um serviço', {
      messageType: 'list',
      listButtonText: 'Serviços',
      listSections: [{ title: 'Estética', rows: [{ id: 's1', title: 'Botox' }] }],
    });
    expect(p.type).toBe('interactive');
    expect(p.interactive).toEqual({
      type: 'list',
      body: { text: 'Escolha um serviço' },
      action: {
        button: 'Serviços',
        sections: [{ title: 'Estética', rows: [{ id: 's1', title: 'Botox' }] }],
      },
    });
  });

  it('builds a template payload with body parameters', () => {
    const p = buildMetaPayload('551', '', {
      messageType: 'template',
      templateName: 'lembrete_consulta',
      parameters: ['Maria', 'sexta 14h'],
    });
    expect(p.type).toBe('template');
    expect(p.template).toEqual({
      name: 'lembrete_consulta',
      language: { code: 'pt_BR' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Maria' },
            { type: 'text', text: 'sexta 14h' },
          ],
        },
      ],
    });
  });
});

describe('sendViaMeta', () => {
  beforeEach(() => {
    process.env.META_ACCESS_TOKEN = 'tok-1';
    process.env.META_PHONE_NUMBER_ID = 'phone-1';
  });

  it('POSTs to the Graph API and returns the wamid', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.NEW1' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const wamid = await sendViaMeta('5511999998888', 'Olá');
    expect(wamid).toBe('wamid.NEW1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v20.0/phone-1/messages');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok-1');
    expect(JSON.parse(init.body).text.body).toBe('Olá');
  });

  it('respects META_GRAPH_BASE_URL override', async () => {
    process.env.META_GRAPH_BASE_URL = 'http://localhost:9999/v20.0';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.X' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await sendViaMeta('551', 'oi');
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:9999/v20.0/phone-1/messages');
  });

  it('throws on non-ok response without leaking the body text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
    );
    await expect(sendViaMeta('551', 'oi')).rejects.toThrow('Meta API error: 401');
  });

  it('throws when unconfigured', async () => {
    delete process.env.META_ACCESS_TOKEN;
    await expect(sendViaMeta('551', 'oi')).rejects.toThrow(/configurado/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test:unit src/lib/whatsapp-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/whatsapp-client.ts`:

```ts
export type SendWhatsAppOptions = {
  messageType?: 'text' | 'buttons' | 'list' | 'template';
  buttons?: Array<{ id: string; title: string }>;
  listButtonText?: string;
  listSections?: Array<{ title: string; rows: Array<{ id: string; title: string }> }>;
  templateName?: string;
  languageCode?: string;
  parameters?: string[];
};

const DEFAULT_GRAPH_BASE_URL = 'https://graph.facebook.com/v20.0';

export const isMetaSendConfigured = (): boolean =>
  Boolean(process.env.META_ACCESS_TOKEN && process.env.META_PHONE_NUMBER_ID);

export const buildMetaPayload = (
  to: string,
  text: string,
  options?: SendWhatsAppOptions,
): Record<string, unknown> => {
  const base = { messaging_product: 'whatsapp', to };
  const type = options?.messageType ?? 'text';

  if (type === 'buttons') {
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text },
        action: {
          buttons: (options?.buttons ?? []).slice(0, 3).map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: b.title },
          })),
        },
      },
    };
  }
  if (type === 'list') {
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text },
        action: {
          button: options?.listButtonText ?? 'Opções',
          sections: options?.listSections ?? [],
        },
      },
    };
  }
  if (type === 'template') {
    return {
      ...base,
      type: 'template',
      template: {
        name: options?.templateName ?? '',
        language: { code: options?.languageCode ?? 'pt_BR' },
        components: options?.parameters?.length
          ? [
              {
                type: 'body',
                parameters: options.parameters.map((p) => ({ type: 'text', text: p })),
              },
            ]
          : [],
      },
    };
  }
  return { ...base, type: 'text', text: { body: text } };
};

// Envia via Meta Cloud API e retorna o wamid. Nunca loga o corpo (PHI).
export const sendViaMeta = async (
  to: string,
  text: string,
  options?: SendWhatsAppOptions,
): Promise<string> => {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  if (!accessToken || !phoneNumberId) {
    throw new Error('Meta send não configurado (META_ACCESS_TOKEN / META_PHONE_NUMBER_ID)');
  }
  const baseUrl = process.env.META_GRAPH_BASE_URL ?? DEFAULT_GRAPH_BASE_URL;

  const res = await fetch(`${baseUrl}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildMetaPayload(to, text, options)),
  });
  if (!res.ok) throw new Error(`Meta API error: ${res.status}`);

  const json = (await res.json()) as { messages?: Array<{ id: string }> };
  const wamid = json.messages?.[0]?.id;
  if (!wamid) throw new Error('Meta API: resposta sem message id');
  return wamid;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test:unit src/lib/whatsapp-client.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Verify + commit**

```bash
yarn typecheck && yarn test:unit && yarn lint
git add src/lib/whatsapp-client.ts src/lib/whatsapp-client.test.ts
git commit -m "feat(lib): Meta Cloud API send client (text/buttons/list/template)"
```

---

### Task 5: Real send in the `sendWhatsApp` tool

**Files:**
- Modify: `src/lib/tools/sendWhatsApp.ts`
- Modify: `src/lib/tools/tools.test.ts` (the existing `sendWhatsApp records an outbound chatMessage (stub)` test)

**Interfaces:**
- Consumes: `isMetaSendConfigured()`, `sendViaMeta(to, text)` from Task 4.
- Produces: tool result JSON changes from `{ ok, stub, messageId }` to `{ ok, sent, messageId }`. `sent: true` only when the Graph API call happened. Behavior contract: unconfigured env OR non-WhatsApp channel OR missing `conversation.externalId` → record-only (deliveryStatus `PENDING`, no `externalId`), same as Fase 1. Configured + WhatsApp → real send, record gets `externalId: wamid`, `deliveryStatus: 'SENT'`. A thrown `sendViaMeta` error propagates (tawany-handler already converts tool errors into handoff).

- [ ] **Step 1: Update the existing test + add the real-send cases**

In `src/lib/tools/tools.test.ts`, replace the `sendWhatsApp records an outbound chatMessage (stub)` test with:

```ts
  it('sendWhatsApp records outbound without sending when Meta is not configured', async () => {
    const get = vi.fn().mockResolvedValue({ id: UUID, channel: 'WHATSAPP', externalId: '5511999998888' });
    const create = vi.fn().mockResolvedValue({ id: 'm1' });
    const update = vi.fn().mockResolvedValue({ id: 'c1' });
    const r = await sendWhatsApp.execute({ conversationId: UUID, text: 'Olá' }, api({ get, create, update }));
    expect(create).toHaveBeenCalledWith(
      'chatMessage',
      expect.objectContaining({ direction: 'OUT', body: 'Olá', deliveryStatus: 'PENDING' }),
    );
    expect(JSON.parse(r)).toMatchObject({ ok: true, sent: false, messageId: 'm1' });
  });

  it('sendWhatsApp sends via Meta and stores the wamid when configured', async () => {
    process.env.META_ACCESS_TOKEN = 'tok';
    process.env.META_PHONE_NUMBER_ID = 'phone';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.SENT1' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const get = vi.fn().mockResolvedValue({ id: UUID, channel: 'WHATSAPP', externalId: '5511999998888' });
      const create = vi.fn().mockResolvedValue({ id: 'm2' });
      const r = await sendWhatsApp.execute({ conversationId: UUID, text: 'Olá' }, api({ get, create }));
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(create).toHaveBeenCalledWith(
        'chatMessage',
        expect.objectContaining({ externalId: 'wamid.SENT1', deliveryStatus: 'SENT' }),
      );
      expect(JSON.parse(r)).toMatchObject({ ok: true, sent: true });
    } finally {
      delete process.env.META_ACCESS_TOKEN;
      delete process.env.META_PHONE_NUMBER_ID;
      vi.unstubAllGlobals();
    }
  });

  it('sendWhatsApp fails cleanly for a missing conversation', async () => {
    const r = await sendWhatsApp.execute({ conversationId: UUID, text: 'Olá' }, api());
    expect(JSON.parse(r)).toMatchObject({ ok: false, error: 'conversation_not_found' });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test:unit src/lib/tools/tools.test.ts`
Expected: FAIL — tool still returns `stub: true` and never calls `get`.

- [ ] **Step 3: Rewrite the tool**

Replace the body of `src/lib/tools/sendWhatsApp.ts`:

```ts
import { z } from 'zod';
import type { DataApi } from 'src/lib/data';
import { isMetaSendConfigured, sendViaMeta } from 'src/lib/whatsapp-client';

// Fase 2: envio real via Meta Cloud API quando configurado; sem config
// (dev/test) mantém o comportamento Fase 1 de apenas registrar no CRM.
export const sendWhatsApp = {
  name: 'sendWhatsApp',
  description: 'Envia mensagem WhatsApp para uma conversa via Meta Cloud API.',
  parameters: z.object({
    conversationId: z.string().uuid(),
    text: z.string().min(1).max(1024),
  }),
  execute: async (args: { conversationId: string; text: string }, ctx: DataApi): Promise<string> => {
    const conv = await ctx.get('conversation', args.conversationId, {
      id: true,
      channel: true,
      externalId: true,
    });
    if (!conv) return JSON.stringify({ ok: false, error: 'conversation_not_found' });

    const to = typeof conv.externalId === 'string' ? conv.externalId : '';
    const canSend = isMetaSendConfigured() && conv.channel === 'WHATSAPP' && to.length > 0;
    // Erro do sendViaMeta propaga: o tawany-handler converte em handoff.
    const wamid = canSend ? await sendViaMeta(to, args.text) : null;

    const message = await ctx.create('chatMessage', {
      body: args.text,
      direction: 'OUT',
      sentAt: new Date().toISOString(),
      conversationId: args.conversationId,
      messageType: 'TEXT',
      deliveryStatus: wamid ? 'SENT' : 'PENDING',
      agentHandled: true,
      ...(wamid ? { externalId: wamid } : {}),
    });
    await ctx.update('conversation', args.conversationId, { lastMessageAt: new Date().toISOString() });
    // No console.log of message body — outbound text is patient PHI.
    return JSON.stringify({ ok: true, sent: Boolean(wamid), messageId: message.id });
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test:unit src/lib/tools/tools.test.ts`
Expected: PASS (all tool tests, including the 3 new/replaced sendWhatsApp cases).

- [ ] **Step 5: Verify + commit**

```bash
yarn typecheck && yarn test:unit && yarn lint
git add src/lib/tools/sendWhatsApp.ts src/lib/tools/tools.test.ts
git commit -m "feat(tools): sendWhatsApp real Meta Cloud API send with stub fallback"
```

---

### Task 6: Webhook verify handshake LF (GET)

**Files:**
- Create: `src/logic-functions/meta-webhook-verify.ts`
- Test: `src/logic-functions/meta-webhook-verify.test.ts`

**Interfaces:**
- Produces: `handleMetaVerify(event: Pick<RoutePayload, 'queryStringParameters'>): Response` (named export, pure) + default `defineLogicFunction` wrapper. Route: `GET /s/meta/webhook`, `isAuthRequired: false`. UUID: `e35bb4c5-8735-4ad1-ae1b-3fd77a30f993`.

- [ ] **Step 1: Write the failing test**

Create `src/logic-functions/meta-webhook-verify.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleMetaVerify } from './meta-webhook-verify';

describe('handleMetaVerify', () => {
  beforeEach(() => {
    process.env.META_VERIFY_TOKEN = 'verify-me';
  });
  afterEach(() => {
    delete process.env.META_VERIFY_TOKEN;
  });

  const q = (over: Record<string, string | undefined>) => ({
    queryStringParameters: {
      'hub.mode': 'subscribe',
      'hub.verify_token': 'verify-me',
      'hub.challenge': '12345',
      ...over,
    },
  });

  it('echoes hub.challenge on a valid handshake', () => {
    const res = handleMetaVerify(q({}));
    expect(res.status).toBe(200);
    expect(res.body).toBe('12345');
  });

  it('403s on wrong token, wrong mode, or unconfigured server', () => {
    expect(handleMetaVerify(q({ 'hub.verify_token': 'nope' })).status).toBe(403);
    expect(handleMetaVerify(q({ 'hub.mode': 'unsubscribe' })).status).toBe(403);
    delete process.env.META_VERIFY_TOKEN;
    expect(handleMetaVerify(q({})).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test:unit src/logic-functions/meta-webhook-verify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/logic-functions/meta-webhook-verify.ts`:

```ts
import { defineLogicFunction } from 'twenty-sdk/define';
import { Response, type RoutePayload } from 'twenty-sdk/logic-function';

// GET handshake do Meta: ecoa hub.challenge se o verify token confere.
export const handleMetaVerify = (
  event: Pick<RoutePayload, 'queryStringParameters'>,
): Response => {
  const q = event.queryStringParameters ?? {};
  const verifyToken = process.env.META_VERIFY_TOKEN;
  const valid =
    Boolean(verifyToken) && q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === verifyToken;
  if (!valid) return new Response('Forbidden', { status: 403 });
  return new Response(q['hub.challenge'] ?? '', { status: 200 });
};

export default defineLogicFunction({
  universalIdentifier: 'e35bb4c5-8735-4ad1-ae1b-3fd77a30f993',
  name: 'meta-webhook-verify',
  description: 'Handshake GET do webhook Meta (hub.challenge).',
  timeoutSeconds: 10,
  httpRouteTriggerSettings: {
    path: '/meta/webhook',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
  handler: handleMetaVerify,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test:unit src/logic-functions/meta-webhook-verify.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify + commit**

```bash
yarn typecheck && yarn test:unit && yarn lint
git add src/logic-functions/meta-webhook-verify.ts src/logic-functions/meta-webhook-verify.test.ts
git commit -m "feat(lf): Meta webhook GET verify handshake"
```

---

### Task 7: Webhook event receiver LF (POST)

**Files:**
- Create: `src/logic-functions/meta-webhook.ts`
- Test: `src/logic-functions/meta-webhook.test.ts`

**Interfaces:**
- Consumes: `verifyMetaSignature` (Task 2), `parseMetaEvent` + types (Task 3), `DataApi`/`createDataApi`.
- Produces: `handleMetaWebhook(event: RoutePayload, data: DataApi): Promise<Response>` (named export, testable with fake DataApi) + default `defineLogicFunction`. Route: `POST /s/meta/webhook`, `isAuthRequired: false`, `forwardedRequestHeaders: ['x-hub-signature-256']`. UUID: `27d865bc-66f7-407d-a49f-d3763e313c87`.
- Behavior contract: 503 when `META_APP_SECRET` unset (fail closed); 401 on bad/missing signature or missing rawBody; statuses update `chatMessage.deliveryStatus` by `externalId`; inbound messages are deduped by `externalId`, get a found-or-created `conversation` (matched on `channel` + `externalId`=sender), and become `direction: 'IN'`, `agentHandled: false` records — the Phase 1 `chatMessage.created` triggers take it from there. Always 200 'OK' after processing (Meta retries on non-2xx; dedup makes retries safe).

- [ ] **Step 1: Write the failing test**

Create `src/logic-functions/meta-webhook.test.ts`:

```ts
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataApi } from 'src/lib/data';
import { handleMetaWebhook } from './meta-webhook';

const SECRET = 'app-secret';
const sign = (raw: string): string =>
  `sha256=${createHmac('sha256', SECRET).update(raw, 'utf8').digest('hex')}`;

const api = (over: Partial<DataApi> = {}): DataApi => ({
  get: vi.fn().mockResolvedValue(null),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
  ...over,
});

const waBody = {
  object: 'whatsapp_business_account',
  entry: [
    {
      changes: [
        {
          value: {
            messages: [
              {
                id: 'wamid.IN1',
                from: '5511999998888',
                timestamp: '1751650000',
                type: 'text',
                text: { body: 'Oi, quero agendar' },
              },
            ],
          },
        },
      ],
    },
  ],
};

const event = (body: object, rawOverride?: string, sigOverride?: string) => {
  const raw = rawOverride ?? JSON.stringify(body);
  return {
    headers: { 'x-hub-signature-256': sigOverride ?? sign(raw) },
    queryStringParameters: {},
    pathParameters: {},
    body,
    rawBody: raw,
    isBase64Encoded: false,
    requestContext: { http: { method: 'POST', path: '/meta/webhook' } },
    userWorkspaceId: null,
  };
};

beforeEach(() => {
  process.env.META_APP_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.META_APP_SECRET;
});

describe('handleMetaWebhook — auth', () => {
  it('503s when META_APP_SECRET is not configured', async () => {
    delete process.env.META_APP_SECRET;
    const res = await handleMetaWebhook(event(waBody), api());
    expect(res.status).toBe(503);
  });

  it('401s on invalid signature and on missing rawBody', async () => {
    const bad = await handleMetaWebhook(event(waBody, undefined, 'sha256=deadbeef'), api());
    expect(bad.status).toBe(401);
    const noRaw = { ...event(waBody), rawBody: undefined };
    expect((await handleMetaWebhook(noRaw, api())).status).toBe(401);
  });
});

describe('handleMetaWebhook — inbound messages', () => {
  it('creates conversation + IN message for a new sender', async () => {
    const list = vi.fn().mockResolvedValue([]); // no dup, no existing conversation
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: 'conv-1' }) // conversation
      .mockResolvedValueOnce({ id: 'msg-1' }); // chatMessage
    const update = vi.fn().mockResolvedValue({ id: 'conv-1' });
    const res = await handleMetaWebhook(event(waBody), api({ list, create, update }));

    expect(res.status).toBe(200);
    expect(create).toHaveBeenNthCalledWith(
      1,
      'conversation',
      expect.objectContaining({
        channel: 'WHATSAPP',
        externalId: '5511999998888',
        status: 'OPEN',
      }),
    );
    expect(create).toHaveBeenNthCalledWith(
      2,
      'chatMessage',
      expect.objectContaining({
        conversationId: 'conv-1',
        direction: 'IN',
        body: 'Oi, quero agendar',
        externalId: 'wamid.IN1',
        messageType: 'TEXT',
        agentHandled: false,
      }),
    );
    expect(update).toHaveBeenCalledWith('conversation', 'conv-1', {
      lastMessageAt: expect.any(String),
    });
  });

  it('reuses an existing conversation', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([]) // dedup: no message with this externalId
      .mockResolvedValueOnce([{ id: 'conv-9' }]); // conversation found
    const create = vi.fn().mockResolvedValue({ id: 'msg-2' });
    await handleMetaWebhook(event(waBody), api({ list, create }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      'chatMessage',
      expect.objectContaining({ conversationId: 'conv-9' }),
    );
  });

  it('skips duplicate messages (Meta retry)', async () => {
    const list = vi.fn().mockResolvedValueOnce([{ id: 'already' }]);
    const create = vi.fn();
    const res = await handleMetaWebhook(event(waBody), api({ list, create }));
    expect(res.status).toBe(200);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('handleMetaWebhook — statuses', () => {
  const statusBody = {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [{ id: 'wamid.OUT1', status: 'read', timestamp: '1751650100' }],
            },
          },
        ],
      },
    ],
  };

  it('updates deliveryStatus of the matching outbound message', async () => {
    const list = vi.fn().mockResolvedValue([{ id: 'msg-out-1' }]);
    const update = vi.fn().mockResolvedValue({ id: 'msg-out-1' });
    const res = await handleMetaWebhook(event(statusBody), api({ list, update }));
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith('chatMessage', 'msg-out-1', { deliveryStatus: 'READ' });
  });

  it('ignores statuses for unknown messages', async () => {
    const update = vi.fn();
    const res = await handleMetaWebhook(event(statusBody), api({ update }));
    expect(res.status).toBe(200);
    expect(update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test:unit src/logic-functions/meta-webhook.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/logic-functions/meta-webhook.ts`:

```ts
import { defineLogicFunction } from 'twenty-sdk/define';
import { Response, type RoutePayload } from 'twenty-sdk/logic-function';
import { createDataApi, type DataApi } from 'src/lib/data';
import { verifyMetaSignature } from 'src/lib/meta-signature';
import { parseMetaEvent, type MetaInboundMessage, type MetaStatusUpdate } from 'src/lib/meta-parse';

const applyStatus = async (status: MetaStatusUpdate, data: DataApi): Promise<void> => {
  const found = await data.list('chatMessage', {
    filter: { externalId: { eq: status.externalId } },
    limit: 1,
    select: { id: true },
  });
  if (found[0]) {
    await data.update('chatMessage', found[0].id as string, { deliveryStatus: status.status });
  }
};

const findOrCreateConversation = async (
  msg: MetaInboundMessage,
  data: DataApi,
): Promise<string> => {
  const existing = await data.list('conversation', {
    filter: { channel: { eq: msg.channel }, externalId: { eq: msg.from } },
    limit: 1,
    select: { id: true },
  });
  if (existing[0]) return existing[0].id as string;
  const created = await data.create('conversation', {
    channel: msg.channel,
    externalId: msg.from,
    status: 'OPEN',
    lastMessageAt: msg.sentAt,
  });
  return created.id as string;
};

const ingestMessage = async (msg: MetaInboundMessage, data: DataApi): Promise<void> => {
  const dup = await data.list('chatMessage', {
    filter: { externalId: { eq: msg.externalId } },
    limit: 1,
    select: { id: true },
  });
  if (dup.length > 0) return; // Meta retry — já processada

  const conversationId = await findOrCreateConversation(msg, data);
  // chatMessage.created dispara tawany-handler + summarize-conversation (Fase 1).
  await data.create('chatMessage', {
    conversationId,
    direction: 'IN',
    body: msg.text,
    sentAt: msg.sentAt,
    externalId: msg.externalId,
    messageType: msg.messageType,
    agentHandled: false,
  });
  await data.update('conversation', conversationId, { lastMessageAt: msg.sentAt });
};

export const handleMetaWebhook = async (
  event: RoutePayload,
  data: DataApi,
): Promise<Response> => {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return new Response('Meta not configured', { status: 503 });

  const signature = event.headers?.['x-hub-signature-256'];
  if (!event.rawBody || !verifyMetaSignature(event.rawBody, signature, appSecret)) {
    return new Response('Invalid signature', { status: 401 });
  }

  const { messages, statuses } = parseMetaEvent(event.body);
  for (const status of statuses) await applyStatus(status, data);
  for (const msg of messages) await ingestMessage(msg, data);

  console.log(
    JSON.stringify({ event: 'meta_webhook', messages: messages.length, statuses: statuses.length }),
  );
  return new Response('OK', { status: 200 });
};

export default defineLogicFunction({
  universalIdentifier: '27d865bc-66f7-407d-a49f-d3763e313c87',
  name: 'meta-webhook',
  description:
    'Recebe eventos do Meta (WhatsApp/Instagram): mensagens inbound + delivery statuses. Assinatura HMAC obrigatória.',
  timeoutSeconds: 30,
  httpRouteTriggerSettings: {
    path: '/meta/webhook',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['x-hub-signature-256'],
  },
  handler: (event: RoutePayload) => handleMetaWebhook(event, createDataApi()),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test:unit src/logic-functions/meta-webhook.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Verify + commit**

```bash
yarn typecheck && yarn test:unit && yarn lint
git add src/logic-functions/meta-webhook.ts src/logic-functions/meta-webhook.test.ts
git commit -m "feat(lf): Meta webhook POST receiver (inbound messages + delivery statuses)"
```

---

### Task 8: Channel badge in the inbox (§5.6 "UI mostra ícone por canal")

**Files:**
- Modify: `src/front-components/whatsapp-inbox.front-component.tsx`

**Interfaces:**
- Consumes: `conversation.channel` (existing SELECT field, `WHATSAPP` | `INSTAGRAM`).
- Produces: nothing downstream. No component test — Phase 1 front-components ship without unit tests (verified visually in Task 9); keep that pattern.

- [ ] **Step 1: Add `channel` to the row type and query**

In `src/front-components/whatsapp-inbox.front-component.tsx`:

Extend `ConversationRow` (line ~6):

```ts
type ConversationRow = {
  id: string;
  externalId: string;
  status: string;
  channel: 'WHATSAPP' | 'INSTAGRAM';
  needsHuman: boolean;
  lastMessageAt: string;
};
```

In the `load()` conversation query (line ~110), add `channel: true` to the select:

```ts
      select: { id: true, externalId: true, status: true, channel: true, needsHuman: true, lastMessageAt: true },
```

- [ ] **Step 2: Render the channel icon**

In `ConversationList`, replace the `<strong>` line (line ~87):

```tsx
            <strong>
              {c.needsHuman ? '🔴 ' : ''}
              {c.channel === 'INSTAGRAM' ? '📷 ' : '💬 '}
              {c.externalId}
            </strong>
```

- [ ] **Step 3: Verify + commit**

```bash
yarn typecheck && yarn test:unit && yarn lint
git add src/front-components/whatsapp-inbox.front-component.tsx
git commit -m "feat(ui): per-channel icon in inbox conversation list"
```

---

### Task 9: Sync, smoke, end-to-end webhook check

**Files:**
- No new source files. Runs sync + smoke; fixes anything the sync rejects.

**Interfaces:**
- Consumes: everything above. Requires the local Twenty dev server running (same setup used for Phase 1 sync).

- [ ] **Step 1: Full local verification**

```bash
cd /home/diegog/projects/qara-clinic
bash scripts/smoke.sh
```
Expected: all checks pass, exit 0.

- [ ] **Step 2: Sync the app to the local Twenty server**

```bash
yarn twenty dev --once
```
Expected: sync completes; output lists the two new logic functions (`meta-webhook-verify`, `meta-webhook`) and the new server variables; no errors. If the CLI rejects `httpRouteTriggerSettings` fields, re-check spelling against `node_modules/twenty-sdk/dist/logic-function/index.d.ts` (source of truth) and fix.

- [ ] **Step 3: Exercise the GET handshake against the running server**

Set `META_VERIFY_TOKEN` in the workspace's server variables (Settings → Applications → Qara Clinic, or `.env` used by the dev server), then:

```bash
curl -s "http://localhost:3000/s/meta/webhook?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=42"
```
Expected: `42`. Wrong token → HTTP 403.

- [ ] **Step 4: Exercise the POST receiver with a signed payload**

```bash
BODY='{"object":"whatsapp_business_account","entry":[{"changes":[{"value":{"messages":[{"id":"wamid.SMOKE1","from":"5511900000000","timestamp":"1751650000","type":"text","text":{"body":"teste webhook fase 2"}}]}}]}]}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "<META_APP_SECRET value>" -r | cut -d' ' -f1)"
curl -s -X POST "http://localhost:3000/s/meta/webhook" \
  -H "Content-Type: application/json" -H "X-Hub-Signature-256: $SIG" -d "$BODY"
```
Expected: `OK`; a new conversation (channel WHATSAPP, externalId 5511900000000) with one IN message appears in the workspace, and `yarn twenty dev:function:logs` shows `meta_webhook` followed by a `tawany_run` entry. Re-running the same curl creates nothing (dedup).

- [ ] **Step 5: Update the SDD ledger + commit**

Append the Phase 2 outcome to `.superpowers/sdd/progress.md` (tasks, commits, verification results), then:

```bash
git add .superpowers/sdd/progress.md
git commit -m "chore(sdd): record Phase 2 Meta integration completion"
```

---

## Deliberate deviations from spec §5 (with reasons)

1. **No `defineConnectionProvider`** (§5.1): SDK 2.18.0 only supports `type: 'oauth'` connection providers — the spec's field-based secret form does not exist. Server variables (existing OPENROUTER pattern) carry the 4 Meta secrets instead.
2. **Two LFs instead of one webhook handler** (§5.2): `httpRouteTriggerSettings` binds one HTTP method per function; Meta requires GET (handshake) + POST (events) on the same URL.
3. **Outbound is WhatsApp-only** (§5.3): matches the spec's own send client; Instagram send is not in Phase 2 scope. Inbound handles both channels (§5.6).
4. **Send failure creates no message record**: spec's client throws on `!result.ok`; the tool lets it propagate so tawany-handler's existing tool-error → handoff path owns the failure. No FAILED-record bookkeeping until there's a consumer for it (YAGNI).
5. **Meta media messages become placeholder text** (`[imagem]`/caption): full media download/storage is out of scope; the text keeps the conversation readable for Tawany and humans.
