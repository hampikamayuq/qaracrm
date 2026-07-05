import { describe, it, expect } from 'vitest';
import { ClassificationResult } from './schema';

describe('ClassificationResult schema', () => {
  it('accepts a canonical HOT/P1/dermatologia-clinica sample', () => {
    const r = ClassificationResult.safeParse({
      intencao_principal: 'agendar',
      temperatura: 'HOT',
      prioridade: 'P1',
      pipeline_funil: 'dermatologia-clinica',
      medico_indicado: 'Dr. Diego Galvez',
      unidade: 'Copacabana',
      confianca: 0.92,
      tags_sugeridas: ['LEAD_QUENTE', 'AGENDAR'],
      proxima_acao: 'enviar horários disponíveis Dr. Diego em Copacabana',
      razoes: ['paciente quer marcar', 'queixa genérica de pele'],
    });
    expect(r.success).toBe(true);
  });

  it('accepts an admin-only COLD/P4 sample with null médico/unidade', () => {
    const r = ClassificationResult.safeParse({
      intencao_principal: 'informacao',
      temperatura: 'COLD',
      prioridade: 'P4',
      pipeline_funil: 'administrativo',
      medico_indicado: null,
      unidade: null,
      confianca: 0.7,
      tags_sugeridas: [],
      proxima_acao: 'responder endereço e parar',
      razoes: ['só perguntou endereço'],
    });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown temperatura value', () => {
    const r = ClassificationResult.safeParse({
      intencao_principal: 'agendar',
      temperatura: 'WARMISH', // not in enum
      prioridade: 'P3',
      pipeline_funil: 'unhas',
      medico_indicado: 'Dr. Miguel Ceccarelli',
      unidade: 'Copacabana',
      confianca: 0.5,
      tags_sugeridas: [],
      proxima_acao: 'responder',
      razoes: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects prioridade outside P1-P4', () => {
    const r = ClassificationResult.safeParse({
      intencao_principal: 'agendar',
      temperatura: 'WARM',
      prioridade: 'P5', // not in enum
      pipeline_funil: 'unhas',
      medico_indicado: 'Dr. Miguel Ceccarelli',
      unidade: null,
      confianca: 0.5,
      tags_sugeridas: [],
      proxima_acao: 'responder',
      razoes: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects confianca outside [0, 1]', () => {
    const tooHigh = ClassificationResult.safeParse({
      intencao_principal: 'agendar',
      temperatura: 'WARM',
      prioridade: 'P3',
      pipeline_funil: 'unhas',
      medico_indicado: 'Dr. Miguel Ceccarelli',
      unidade: null,
      confianca: 1.5,
      tags_sugeridas: [],
      proxima_acao: 'responder',
      razoes: [],
    });
    expect(tooHigh.success).toBe(false);

    const tooLow = ClassificationResult.safeParse({
      intencao_principal: 'agendar',
      temperatura: 'WARM',
      prioridade: 'P3',
      pipeline_funil: 'unhas',
      medico_indicado: 'Dr. Miguel Ceccarelli',
      unidade: null,
      confianca: -0.1,
      tags_sugeridas: [],
      proxima_acao: 'responder',
      razoes: [],
    });
    expect(tooLow.success).toBe(false);
  });

  it('rejects an unknown pipeline_funil', () => {
    const r = ClassificationResult.safeParse({
      intencao_principal: 'agendar',
      temperatura: 'WARM',
      prioridade: 'P3',
      pipeline_funil: 'endocrinologia', // not in the 9-pipeline taxonomy
      medico_indicado: null,
      unidade: null,
      confianca: 0.5,
      tags_sugeridas: [],
      proxima_acao: 'responder',
      razoes: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects when a required key is missing (tags_sugeridas)', () => {
    const r = ClassificationResult.safeParse({
      intencao_principal: 'agendar',
      temperatura: 'WARM',
      prioridade: 'P3',
      pipeline_funil: 'unhas',
      medico_indicado: 'Dr. Miguel Ceccarelli',
      unidade: null,
      confianca: 0.5,
      // tags_sugeridas omitted
      proxima_acao: 'responder',
      razoes: [],
    });
    expect(r.success).toBe(false);
  });
});
