import { describe, expect, it, vi } from 'vitest';
import type { DataApi } from './data';

const api = (over: Partial<DataApi> = {}): DataApi => ({
  get: vi.fn().mockResolvedValue(null),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
  ...over,
});

describe('LGPD exportLeadData', () => {
  it('returns lead conversations, messages, and suggestions', async () => {
    const get = vi.fn().mockResolvedValue({ id: 'L1', name: 'Maria', phone: '+5511' });
    const list = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'C1', leadId: 'L1' }])
      .mockResolvedValueOnce([{ id: 'M1', body: 'oi' }])
      .mockResolvedValueOnce([{ id: 'AS1', body: 'sugestao' }]);
    const { exportLeadData } = await import('./lgpd');

    const result = await exportLeadData('L1', api({ get, list }));

    expect(result.lead.id).toBe('L1');
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0].messages[0].id).toBe('M1');
    expect(result.conversations[0].aiSuggestions[0].id).toBe('AS1');
  });

  it('throws when lead does not exist', async () => {
    const { exportLeadData } = await import('./lgpd');

    await expect(exportLeadData('missing', api())).rejects.toThrow('Lead not found');
  });
});

describe('LGPD anonymizeLead', () => {
  it('replaces PII with synthetic values and clears conversation content', async () => {
    const get = vi.fn().mockResolvedValue({ id: 'L1' });
    const list = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'C1' }])
      .mockResolvedValueOnce([{ id: 'M1' }])
      .mockResolvedValueOnce([{ id: 'AS1' }])
      .mockResolvedValueOnce([{ id: 'A1' }])
      .mockResolvedValueOnce([{ id: 'P1' }]);
    const update = vi.fn().mockResolvedValue({});
    const { anonymizeLead } = await import('./lgpd');

    const result = await anonymizeLead('L1', api({ get, list, update }));

    expect(update).toHaveBeenCalledWith('lead', 'L1', expect.objectContaining({
      name: expect.stringMatching(/^ANON-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      phone: null,
      email: null,
    }));
    expect(update).toHaveBeenCalledWith('chatMessage', 'M1', { body: '[anonimizado]', mediaUrl: null });
    expect(update).toHaveBeenCalledWith('aiSuggestion', 'AS1', { body: '[anonimizado]', originalBody: null });
    expect(update).toHaveBeenCalledWith('appointment', 'A1', { notes: null });
    expect(update).toHaveBeenCalledWith('patient', 'P1', expect.objectContaining({ phone: null, email: null }));
    expect(result).toEqual({
      leadUpdated: true,
      conversationsAnonymized: 1,
      messagesAnonymized: 1,
      suggestionsAnonymized: 1,
      appointmentsAnonymized: 1,
      patientsAnonymized: 1,
    });
  });
});
