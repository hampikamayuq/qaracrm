import { describe, expect, it } from 'vitest';
import { substituteVars } from './quick-reply';

describe('substituteVars', () => {
  it('substitui {{nome}} pelo nome completo', () => {
    expect(substituteVars('Olá, {{nome}}!', { nome: 'Maria Silva' })).toBe('Olá, Maria Silva!');
  });

  it('substitui {{primeiro_nome}} pelo primeiro nome', () => {
    expect(substituteVars('Oi {{primeiro_nome}}, tudo bem?', { nome: 'Maria Silva' })).toBe('Oi Maria, tudo bem?');
  });

  it('substitui {{unidade}} pelo nome da unidade', () => {
    expect(substituteVars('Te esperamos na unidade {{unidade}}.', { unidade: 'Jardins' })).toBe(
      'Te esperamos na unidade Jardins.',
    );
  });

  it('é case-insensitive e tolera espaços internos', () => {
    expect(substituteVars('{{ Nome }} / {{PRIMEIRO_NOME}}', { nome: 'Ana' })).toBe('Ana / Ana');
  });

  it('substitui múltiplas ocorrências', () => {
    expect(substituteVars('{{nome}}, {{nome}} de novo', { nome: 'Ana' })).toBe('Ana, Ana de novo');
  });

  it('vira string vazia quando o valor não é informado', () => {
    expect(substituteVars('Oi {{nome}}!')).toBe('Oi !');
    expect(substituteVars('Unidade: {{unidade}}', { nome: 'Ana' })).toBe('Unidade: ');
  });

  it('usa a palavra inteira quando o nome não tem sobrenome', () => {
    expect(substituteVars('{{primeiro_nome}}', { nome: 'Ana' })).toBe('Ana');
  });

  it('não altera texto sem placeholders', () => {
    expect(substituteVars('Texto fixo sem variáveis.', { nome: 'Ana' })).toBe('Texto fixo sem variáveis.');
  });
});
