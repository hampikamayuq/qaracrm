import { describe, expect, it, vi } from 'vitest';
import type { DataApi } from './data';
import { recordAiRun } from './ai-run-log';

const makeData = (create = vi.fn().mockResolvedValue({ id: 'log1' })): DataApi => ({
  get: vi.fn(),
  list: vi.fn(),
  create,
  update: vi.fn(),
});

describe('recordAiRun', () => {
  it('writes a minimal aiRunLog record', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'log1' });
    await recordAiRun(makeData(create), {
      layer: 'tawany',
      model: 'z-ai/glm-5.2',
      fallbackUsed: true,
      latencyMs: 42,
      success: true,
      validationPass: true,
      reason: 'replied',
      conversationId: 'conv1',
      messageId: 'msg1',
      promptTokens: 100,
      completionTokens: 30,
      totalTokens: 130,
      estimatedCostCents: 7,
    });

    expect(create).toHaveBeenCalledWith('aiRunLog', expect.objectContaining({
      layer: 'tawany',
      model: 'z-ai/glm-5.2',
      fallbackUsed: true,
      latencyMs: 42,
      success: true,
      validationPass: true,
      reason: 'replied',
      conversationId: 'conv1',
      messageId: 'msg1',
      promptTokens: 100,
      completionTokens: 30,
      totalTokens: 130,
      estimatedCostCents: 7,
    }));
  });

  it('does not throw when audit logging fails', async () => {
    const data = makeData(vi.fn().mockRejectedValue(new Error('schema not synced')));
    await expect(recordAiRun(data, {
      layer: 'tawany',
      success: false,
      reason: 'boom',
    })).resolves.toBeUndefined();
  });
});
