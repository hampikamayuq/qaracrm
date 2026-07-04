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
  },
});
