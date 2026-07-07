import { defineApplication } from 'twenty-sdk/define';

import {
  APP_DESCRIPTION,
  APP_DISPLAY_NAME,
  APPLICATION_UNIVERSAL_IDENTIFIER,
  DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

import { adminRole } from 'src/roles/admin.role';
import { receptionRole } from 'src/roles/reception.role';
import { doctorRole } from 'src/roles/doctor.role';
import { financeRole } from 'src/roles/finance.role';

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: APP_DISPLAY_NAME,
  description: APP_DESCRIPTION,
  defaultRoleUniversalIdentifier: DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
  roles: [adminRole, receptionRole, doctorRole, financeRole],
  serverVariables: {
    OPENROUTER_API_KEY: {
      description:
        'API key for OpenRouter (https://openrouter.ai). Required for tawany-handler and ai-client.',
      isSecret: true,
      isRequired: true,
    },
    OPENROUTER_BASE_URL: {
      description: 'OpenRouter base URL. Defaults to https://openrouter.ai/api/v1.',
      isRequired: false,
    },
    OPENROUTER_HTTP_REFERER: {
      description:
        'Optional OpenRouter HTTP-Referer header. In production, set to the Render Twenty server URL.',
      isRequired: false,
    },
    OPENROUTER_APP_NAME: {
      description: 'Optional OpenRouter X-Title header. Set to qara-clinic in production.',
      isRequired: false,
    },
    DEFAULT_MODEL_PATIENT: {
      description:
        'Default model for tawany-handler (patient-facing). Defaults to minimax/minimax-m3.',
      isRequired: false,
    },
    DEFAULT_MODEL_PATIENT_FALLBACK: {
      description:
        'Fallback model for patient-facing Tawany responses when DEFAULT_MODEL_PATIENT fails.',
      isRequired: false,
    },
    DEFAULT_MODEL_INTERNAL: {
      description:
        'Default model for summarize-conversation (internal). Defaults to deepseek/deepseek-chat.',
      isRequired: false,
    },
    DEFAULT_MODEL_INTERNAL_FALLBACK: {
      description:
        'Fallback model for internal AI work (classification, scoring, summaries) when DEFAULT_MODEL_INTERNAL fails.',
      isRequired: false,
    },
    AI_TIMEOUT_MS: {
      description: 'Optional timeout in milliseconds for each AI model attempt.',
      isRequired: false,
    },
    AI_LOG_FULL_PROMPTS: {
      description:
        'Optional boolean-like flag. Keep false in production; full prompt logging can include PHI.',
      isRequired: false,
    },
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
    LEAD_WEBHOOK_SECRET: {
      description: 'Secret para validar o webhook universal /s/webhook/lead (header X-Webhook-Secret).',
      isSecret: true,
      isRequired: false,
    },
  },
});