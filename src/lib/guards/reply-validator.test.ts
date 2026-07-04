import { describe, it, expect } from 'vitest';
import { validateReply } from './reply-validator';

describe('validateReply', () => {
  const knownPrices = [45000, 55000, 65000, 80000]; // R$ 450, 550, 650, 800

  it('passes a safe short reply without prices', () => {
    const r = validateReply('Olá! Sou Tawany, posso ajudar?', { knownPrices });
    expect(r.ok).toBe(true);
  });

  it('passes a reply with a known price', () => {
    const r = validateReply('A consulta custa R$ 550,00.', { knownPrices });
    expect(r.ok).toBe(true);
  });

  it('fails on a price not in knownPrices', () => {
    const r = validateReply('A consulta custa R$ 999,00.', { knownPrices });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/price/);
  });

  it('passes a reply with multiple known prices', () => {
    const r = validateReply('RJ R$ 650, SP R$ 800, ou tele R$ 650.', { knownPrices });
    expect(r.ok).toBe(true);
  });

  it('fails on length > 1024 chars', () => {
    const long = 'a'.repeat(1025);
    const r = validateReply(long, { knownPrices });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/length/);
  });

  it('fails on sensitive topic (diagnóstico)', () => {
    const r = validateReply('Você tem dermatite atópica.', { knownPrices });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/sensitive/);
  });

  it('fails on sensitive topic (prescrição)', () => {
    const r = validateReply('Tome 50mg de prednisona por dia.', { knownPrices });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/sensitive/);
  });

  it('fails on sensitive topic (promessa de resultado)', () => {
    const r = validateReply('Vou te curar com certeza.', { knownPrices });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/sensitive/);
  });

  // A dermatology clinic bot MUST be able to mention conditions informationally —
  // the guard blocks affirmative diagnosis/prescription patterns, not disease names.
  it('passes informational mention of a condition', () => {
    const r = validateReply('A Dra. Manuela atende casos de dermatite atópica.', { knownPrices });
    expect(r.ok).toBe(true);
  });
});
