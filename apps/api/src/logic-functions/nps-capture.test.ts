import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataApi } from '../lib/data';
import { runNpsCaptureForInbound } from './nps-capture';

const mocks = vi.hoisted(() => ({
  sendWhatsApp: {
    execute: vi.fn().mockResolvedValue(JSON.stringify({ ok: true, sent: false })),
  },
}));

vi.mock('../lib/tools/sendWhatsApp', () => ({
  sendWhatsApp: mocks.sendWhatsApp,
}));

const APPOINTMENT_ID = 'a1b2c3d4-0000-4000-8000-000000000099';
const NOW = new Date('2026-07-08T12:00:00.000Z');
const SENT_RECENTLY = '2026-07-08T00:00:00.000Z'; // 12h atrás

const api = (over: Partial<DataApi> = {}): DataApi => ({
  get: vi.fn().mockResolvedValue({ id: 'conv-1', leadId: 'lead-1' }),
  list: vi.fn().mockResolvedValue([{ id: APPOINTMENT_ID, npsSentAt: SENT_RECENTLY }]),
  create: vi.fn().mockResolvedValue({ id: 'created' }),
  update: vi.fn().mockResolvedValue({ id: 'updated' }),
  ...over,
});

const NPS_ENV_KEYS = ['NPS_CAPTURE_WINDOW_HOURS'] as const;
const saved: Record<string, string | undefined> = {};

describe('runNpsCaptureForInbound', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of NPS_ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of NPS_ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('captures a plain digit score, records it and thanks the patient (promoter band)', async () => {
    const update = vi.fn().mockResolvedValue({ id: APPOINTMENT_ID });
    const create = vi.fn().mockResolvedValue({ id: 'act-1' });
    const data = api({ update, create });

    const result = await runNpsCaptureForInbound(
      { conversationId: 'conv-1', messageType: 'TEXT', text: '10' },
      data,
      NOW,
    );

    expect(result).toEqual({ handled: true });
    expect(update).toHaveBeenCalledWith('appointment', APPOINTMENT_ID, {
      npsScore: 10,
      npsRespondedAt: NOW.toISOString(),
    });
    expect(create).toHaveBeenCalledWith('activity', expect.objectContaining({
      targetType: 'conversation',
      targetId: 'conv-1',
      conversationId: 'conv-1',
      type: 'NPS_RECEIVED',
      body: expect.stringContaining('10'),
    }));
    expect(mocks.sendWhatsApp.execute).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1' }),
      data,
    );
    // nota alta não deve virar detrator
    expect(update).not.toHaveBeenCalledWith('conversation', expect.anything(), expect.anything());
    expect(create).not.toHaveBeenCalledWith('task', expect.anything());
  });

  it('extracts the score from "nota 8" (passive band) with a simple thank-you', async () => {
    const list = vi.fn().mockResolvedValue([{ id: APPOINTMENT_ID, npsSentAt: SENT_RECENTLY }]);
    const update = vi.fn().mockResolvedValue({ id: APPOINTMENT_ID });
    const data = api({ list, update });

    const result = await runNpsCaptureForInbound(
      { conversationId: 'conv-1', messageType: 'TEXT', text: 'nota 8' },
      data,
      NOW,
    );

    expect(result).toEqual({ handled: true });
    expect(update).toHaveBeenCalledWith('appointment', APPOINTMENT_ID, expect.objectContaining({ npsScore: 8 }));
    expect(update).not.toHaveBeenCalledWith('conversation', expect.anything(), expect.anything());
  });

  it('registers a detractor (score <= 6): needsHuman + PENDING_HUMAN + high-priority task', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'x' });
    const create = vi.fn().mockResolvedValue({ id: 'created' });
    const data = api({ update, create });

    const result = await runNpsCaptureForInbound(
      { conversationId: 'conv-1', messageType: 'TEXT', text: '3' },
      data,
      NOW,
    );

    expect(result).toEqual({ handled: true });
    expect(update).toHaveBeenCalledWith('appointment', APPOINTMENT_ID, expect.objectContaining({ npsScore: 3 }));
    expect(update).toHaveBeenCalledWith('conversation', 'conv-1', {
      needsHuman: true,
      status: 'PENDING_HUMAN',
      handoffReason: 'nps_detractor',
    });
    expect(create).toHaveBeenCalledWith('task', expect.objectContaining({
      title: 'Detrator NPS: nota 3',
      priority: 'HIGH',
      status: 'OPEN',
      conversationId: 'conv-1',
    }));
    expect(mocks.sendWhatsApp.execute).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1' }),
      data,
    );
  });

  it('does not capture when there is no pending NPS for the lead', async () => {
    const list = vi.fn().mockResolvedValue([]);
    const update = vi.fn();
    const data = api({ list, update });

    const result = await runNpsCaptureForInbound(
      { conversationId: 'conv-1', messageType: 'TEXT', text: '9' },
      data,
      NOW,
    );

    expect(result).toEqual({ handled: false });
    expect(update).not.toHaveBeenCalled();
    expect(mocks.sendWhatsApp.execute).not.toHaveBeenCalled();
  });

  it('does not capture non-numeric text (message continues to the normal flow)', async () => {
    const update = vi.fn();
    const data = api({ update });

    const result = await runNpsCaptureForInbound(
      { conversationId: 'conv-1', messageType: 'TEXT', text: 'Oi, tudo bem?' },
      data,
      NOW,
    );

    expect(result).toEqual({ handled: false });
    expect(update).not.toHaveBeenCalled();
    expect(mocks.sendWhatsApp.execute).not.toHaveBeenCalled();
  });

  it('rejects out-of-range numbers like "20" or "100"', async () => {
    const data = api();

    expect(await runNpsCaptureForInbound({ conversationId: 'conv-1', messageType: 'TEXT', text: '20' }, data, NOW))
      .toEqual({ handled: false });
    expect(await runNpsCaptureForInbound({ conversationId: 'conv-1', messageType: 'TEXT', text: '100' }, data, NOW))
      .toEqual({ handled: false });
  });

  it('does not capture outside the capture window (default 48h)', async () => {
    const oldSentAt = '2026-07-05T00:00:00.000Z'; // > 48h antes de NOW
    const list = vi.fn().mockResolvedValue([{ id: APPOINTMENT_ID, npsSentAt: oldSentAt }]);
    const update = vi.fn();
    const data = api({ list, update });

    const result = await runNpsCaptureForInbound(
      { conversationId: 'conv-1', messageType: 'TEXT', text: '9' },
      data,
      NOW,
    );

    expect(result).toEqual({ handled: false });
    expect(update).not.toHaveBeenCalled();
    expect(mocks.sendWhatsApp.execute).not.toHaveBeenCalled();
  });

  it('honors a custom NPS_CAPTURE_WINDOW_HOURS', async () => {
    process.env.NPS_CAPTURE_WINDOW_HOURS = '6';
    // SENT_RECENTLY é 12h antes de NOW — fora de uma janela de 6h.
    const update = vi.fn();
    const data = api({ update });

    const result = await runNpsCaptureForInbound(
      { conversationId: 'conv-1', messageType: 'TEXT', text: '9' },
      data,
      NOW,
    );

    expect(result).toEqual({ handled: false });
    expect(update).not.toHaveBeenCalled();
  });

  it('does not handle non-TEXT messages (e.g. BUTTON)', async () => {
    const data = api();

    const result = await runNpsCaptureForInbound(
      { conversationId: 'conv-1', messageType: 'BUTTON', text: '' },
      data,
      NOW,
    );

    expect(result).toEqual({ handled: false });
    expect(data.get).not.toHaveBeenCalled();
  });

  it('does not handle when the conversation has no leadId', async () => {
    const get = vi.fn().mockResolvedValue({ id: 'conv-1', leadId: null });
    const data = api({ get });

    const result = await runNpsCaptureForInbound(
      { conversationId: 'conv-1', messageType: 'TEXT', text: '9' },
      data,
      NOW,
    );

    expect(result).toEqual({ handled: false });
    expect(data.list).not.toHaveBeenCalled();
  });
});
