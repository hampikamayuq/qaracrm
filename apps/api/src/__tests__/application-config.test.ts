import applicationConfig from 'src/application-config';
import {
  APP_DESCRIPTION,
  APP_DISPLAY_NAME,
  APPLICATION_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';
import { describe, expect, it } from 'vitest';

describe('application identifiers', () => {
  it('should expose the application metadata constants', () => {
    expect(APP_DISPLAY_NAME).toBeTruthy();
    expect(typeof APP_DESCRIPTION).toBe('string');
    expect(APPLICATION_UNIVERSAL_IDENTIFIER).toBeTruthy();
  });
});

describe('meta server variables', () => {
  it('declares the 4 Meta secrets + optional base URL, all optional', () => {
    const vars = applicationConfig.config.serverVariables ?? {};
    for (const name of [
      'META_ACCESS_TOKEN',
      'META_PHONE_NUMBER_ID',
      'META_VERIFY_TOKEN',
      'META_APP_SECRET',
      'META_GRAPH_BASE_URL',
    ] as const) {
      expect(vars, `missing ${name}`).toHaveProperty(name);
      expect(vars[name]?.isRequired ?? false).toBe(false);
    }
    expect(vars.META_ACCESS_TOKEN?.isSecret).toBe(true);
    expect(vars.META_APP_SECRET?.isSecret).toBe(true);
    expect(vars.META_VERIFY_TOKEN?.isSecret).toBe(true);
  });
});

describe('ai server variables', () => {
  it('declares OpenRouter headers, fallback, and timeout knobs', () => {
    const vars = applicationConfig.config.serverVariables ?? {};
    for (const name of [
      'OPENROUTER_HTTP_REFERER',
      'OPENROUTER_APP_NAME',
      'DEFAULT_MODEL_PATIENT_FALLBACK',
      'DEFAULT_MODEL_INTERNAL_FALLBACK',
      'AI_TIMEOUT_MS',
      'AI_LOG_FULL_PROMPTS',
    ] as const) {
      expect(vars, `missing ${name}`).toHaveProperty(name);
      expect(vars[name]?.isRequired ?? false).toBe(false);
    }
  });
});
