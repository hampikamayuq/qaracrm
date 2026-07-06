import { describe, expect, it } from 'vitest';
import { botBlockedByRisk, findMatchingRule, parseBotFlow, parseBotSteps, type BotRule } from './engine';

const manychatFixture = {
  type_functionality: 0,
  model: {
    name: 'Fluxo teste',
    positions: JSON.stringify([
      {
        id: 0,
        goto: { block: 1 },
        actions: [],
      },
      {
        id: 1,
        actions: [
          {
            params: {
              params: {
                handler: 'conditions',
                logic: 'and',
                conditions: [
                  { term1: '{{message_text}}', term2: 'Quero agendar uma consulta', operation: '=' },
                ],
              },
            },
            links: [{ block: 2 }],
          },
        ],
      },
      {
        id: 2,
        actions: [
          { params: { params: { handler: 'send_message', text: 'Bem-vindo à Clínica QARA!' } } },
          { params: { params: { handler: 'send_message', text: 'Qual área você gostaria de tratar?' } } },
        ],
      },
    ]),
  },
};

describe('parseBotFlow', () => {
  it('converts ManyChat model.positions into first-match rules', () => {
    const { name, flow } = parseBotFlow(manychatFixture, 'teste.json');
    expect(name).toBe('Fluxo teste');
    expect(flow.rules).toHaveLength(1);
    expect(flow.rules[0].terms).toEqual(['Quero agendar uma consulta']);
    expect(flow.rules[0].responses).toEqual([
      'Bem-vindo à Clínica QARA!',
      'Qual área você gostaria de tratar?',
    ]);
  });

  it('accepts already-converted { name, rules } payloads', () => {
    const { flow } = parseBotFlow({
      name: 'Direto',
      rules: [{ terms: ['oi'], responses: ['Olá!'] }],
    });
    expect(flow.rules).toHaveLength(1);
  });

  it('throws on flows without rules', () => {
    expect(() => parseBotFlow({ model: { positions: '[]' } })).toThrow();
  });
});

describe('findMatchingRule', () => {
  const rules: BotRule[] = [
    { terms: ['Quero agendar uma consulta'], responses: ['ok'] },
    { terms: ['oi'], responses: ['curto'] },
  ];

  it('matches accent/case-insensitively by containment', () => {
    expect(findMatchingRule(rules, 'quero agendar uma CONSULTA por favor')?.responses[0]).toBe('ok');
    expect(findMatchingRule(rules, 'Quero agendar')?.responses[0]).toBe('ok'); // incoming contido no termo
  });

  it('short terms only match exactly', () => {
    expect(findMatchingRule(rules, 'oi')?.responses[0]).toBe('curto');
    expect(findMatchingRule(rules, 'oi tudo bem, meu nome é Ana')).toBeNull();
  });

  it('single-word terms never match by containment (stateless menu safety)', () => {
    const menuRules: BotRule[] = [{ terms: ['Unhas'], responses: ['menu de unhas'] }];
    expect(findMatchingRule(menuRules, 'unhas')?.responses[0]).toBe('menu de unhas');
    expect(findMatchingRule(menuRules, 'minha unha está estranha depois da cirurgia')).toBeNull();
  });
});

describe('botBlockedByRisk', () => {
  it('blocks clinical-risk messages from any bot auto-reply', () => {
    expect(botBlockedByRisk('estou com dor intensa e sangramento no pós-operatório')).toBe(true);
    expect(botBlockedByRisk('apareceu uma pinta que cresceu')).toBe(true);
    expect(botBlockedByRisk('gostaria de agendar uma consulta')).toBe(false);
  });
});

describe('parseBotSteps', () => {
  it('returns null for legacy/unknown shapes', () => {
    expect(parseBotSteps({ foo: 'bar' })).toBeNull();
    expect(parseBotSteps(null)).toBeNull();
  });
});
