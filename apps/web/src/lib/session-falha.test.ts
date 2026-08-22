import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { lerFalhaDeTurno } from './session-falha';
// As duas frases-padrão resolvem pelo singleton REAL de `lib/i18n.ts`
// (`i18n.t(chave, {ns: 'sessions'})`) — as asserções abaixo checam o texto
// ATUAL em português, então o idioma precisa ser fixado antes de qualquer
// chamada (mesmo padrão de `agent-status.test.ts`).
import i18n from './i18n';

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

/**
 * A falha de turno na tela. O defeito que originou tudo isto era um balão
 * VAZIO: o agente falhava, o log guardava `agent.response` com conteúdo "" e
 * ninguém ficava sabendo. Aqui a regra é simples e absoluta: sempre há frase.
 */
describe('lerFalhaDeTurno', () => {
  it('usa a mensagem e a origem que o engine gravou', () => {
    expect(
      lerFalhaDeTurno({ mensagem: 'Não consegui falar com o modelo.', origem: 'infra' }),
    ).toEqual({ mensagem: 'Não consegui falar com o modelo.', origem: 'infra' });
  });

  it('evento antigo, sem os campos novos, ainda diz alguma coisa', () => {
    const falha = lerFalhaDeTurno({ reason: ':no_final_event' });

    expect(falha.mensagem).not.toBe('');
    expect(falha.origem).toBe('indeterminada');
  });

  /** Origem em branco não vira uma das quatro por chute (ADR 0020). */
  it('origem vazia é `indeterminada`, nunca adivinhada', () => {
    expect(lerFalhaDeTurno({ origem: '   ' }).origem).toBe('indeterminada');
    expect(lerFalhaDeTurno({}).origem).toBe('indeterminada');
    expect(lerFalhaDeTurno(null).origem).toBe('indeterminada');
  });

  it('mensagem só de espaços conta como ausente', () => {
    expect(lerFalhaDeTurno({ mensagem: '  ' }).mensagem).toContain(
      'não foi registrado',
    );
  });
});
