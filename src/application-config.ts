import { defineApplication } from 'twenty-sdk/define';

import {
  APP_DESCRIPTION,
  APP_DISPLAY_NAME,
  APPLICATION_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: APP_DISPLAY_NAME,
  description: APP_DESCRIPTION,
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
    DEFAULT_MODEL_PATIENT: {
      description:
        'Default model for tawany-handler (patient-facing). Defaults to minimax/minimax-m3.',
      isRequired: false,
    },
    DEFAULT_MODEL_INTERNAL: {
      description:
        'Default model for summarize-conversation (internal). Defaults to deepseek/deepseek-chat.',
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
  },
});
