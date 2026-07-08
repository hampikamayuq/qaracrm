import { describe, expect, it, vi } from 'vitest';
import type { DataApi } from './data';
import { captureExplicitPatientProfile, extractExplicitPatientProfile } from './patient-profile';

const api = (over: Partial<DataApi> = {}): DataApi => ({
  get: vi.fn().mockResolvedValue(null),
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
  ...over,
});

describe('patient profile capture', () => {
  it('extracts only explicitly provided patient data', () => {
    expect(extractExplicitPatientProfile('Meu nome é Maria Silva, meu CPF é 123.456.789-09 e nasci em 05/06/1990.')).toEqual({
      name: 'Maria Silva',
      cpf: '12345678909',
      birthDate: '1990-06-05T00:00:00.000Z',
    });
    expect(extractExplicitPatientProfile('Acho que é a Maria e deve ter uns 40 anos')).toEqual({});
  });

  it('updates existing patient linked to the conversation without logging PHI', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'p1' });
    const create = vi.fn();
    const get = vi.fn().mockResolvedValue({ id: 'c1', leadId: 'l1', patientId: 'p1' });

    const result = await captureExplicitPatientProfile(
      { conversationId: 'c1', text: 'Meu CPF é 123.456.789-09' },
      api({ get, update, create }),
    );

    expect(result).toEqual({ captured: true, patientId: 'p1', fields: ['cpf'] });
    expect(update).toHaveBeenCalledWith('patient', 'p1', { cpf: '12345678909' });
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a patient only when at least one explicit field is present', async () => {
    const get = vi.fn().mockResolvedValue({ id: 'c1', leadId: 'l1', patientId: null });
    const create = vi.fn().mockResolvedValue({ id: 'p1' });
    const update = vi.fn().mockResolvedValue({});

    const none = await captureExplicitPatientProfile(
      { conversationId: 'c1', text: 'Ela parece se chamar Maria' },
      api({ get, create, update }),
    );
    expect(none).toEqual({ captured: false, fields: [] });

    const result = await captureExplicitPatientProfile(
      { conversationId: 'c1', text: 'Meu nome é Maria Silva' },
      api({ get, create, update }),
    );
    expect(result).toEqual({ captured: true, patientId: 'p1', fields: ['name'] });
    expect(create).toHaveBeenCalledWith('patient', { leadId: 'l1', name: 'Maria Silva' });
    expect(update).toHaveBeenCalledWith('conversation', 'c1', { patientId: 'p1' });
  });
});
