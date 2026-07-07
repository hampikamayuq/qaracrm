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

  it('fails on affirmative Mohs mention', () => {
    const r = validateReply('Recomendo a cirurgia de Mohs para o seu caso.', { knownPrices });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/mohs/i);
  });

  it('fails on affirmative skin cancer mention', () => {
    const r = validateReply('Isso é câncer de pele e precisa operar.', { knownPrices });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/mohs|skin_cancer/i);
  });

  it('allows future-hypothesis Mohs mention', () => {
    const r = validateReply('Se for necessário, poderíamos considerar cirurgia de Mohs no futuro.', { knownPrices });
    expect(r.ok).toBe(true);
  });

  // Promessa de horário: a Tawany não tem agenda real — "agendei/confirmado
  // para <dia/hora>" é sempre invenção.
  it('fails on "agendei para" com dia e hora', () => {
    const r = validateReply('Pronto! Agendei para segunda às 14h.', { knownPrices });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('schedule_promise_without_agenda');
  });

  it('fails on "confirmada para" com dia', () => {
    const r = validateReply('Sua consulta está confirmada para quinta-feira.', { knownPrices });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('schedule_promise_without_agenda');
  });

  it('fails on "marquei sua consulta para amanhã"', () => {
    const r = validateReply('Marquei sua consulta para amanhã, tudo certo.', { knownPrices });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('schedule_promise_without_agenda');
  });

  it('passes "vou verificar com a equipe os horários" (sem promessa)', () => {
    const r = validateReply('Vou verificar com a equipe os horários de quinta e te retorno.', { knownPrices });
    expect(r.ok).toBe(true);
  });

  it('passes pergunta de preferência de dia/período (sem confirmação)', () => {
    const r = validateReply('Tem algum dia ou período que fique melhor? Manhã, tarde ou noite?', { knownPrices });
    expect(r.ok).toBe(true);
  });

  it('passes "confirmado" sem dia/hora (ex.: comprovante)', () => {
    const r = validateReply('Assim que o pagamento for confirmado, deixo tudo certinho para você.', { knownPrices });
    expect(r.ok).toBe(true);
  });

  // Promessa de resultado
  it('fails on "resultado garantido"', () => {
    const r = validateReply('O tratamento tem resultado garantido.', { knownPrices });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('outcome_promise');
  });

  it('fails on "vai resolver 100%"', () => {
    const r = validateReply('Esse procedimento vai resolver 100% do problema.', { knownPrices });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('outcome_promise');
  });

  it('passes explicação honesta de resultado (sem promessa)', () => {
    const r = validateReply('O resultado depende da avaliação em consulta com o dermatologista.', { knownPrices });
    expect(r.ok).toBe(true);
  });
});
