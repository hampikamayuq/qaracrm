import { describe, expect, it } from 'vitest';
import aiRunLogObject from './ai-run-log.object';

describe('aiRunLog object', () => {
  it('declares the minimal AI audit fields', () => {
    const config = aiRunLogObject.config;
    const fieldNames = config.fields?.map((field) => field.name) ?? [];

    expect(config.nameSingular).toBe('aiRunLog');
    expect(config.namePlural).toBe('aiRunLogs');
    expect(fieldNames).toEqual(expect.arrayContaining([
      'layer',
      'model',
      'fallbackUsed',
      'latencyMs',
      'success',
      'validationPass',
      'reason',
      'conversationId',
      'messageId',
      'createdAt',
    ]));
  });
});
