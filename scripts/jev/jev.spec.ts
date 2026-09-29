import { describe, expect, it } from 'vitest';
import { MODELO_DO_JEV, PERGUNTA, lerResposta, montarPedido } from './jev.ts';
import { RESPONDER_SEM_FERRAMENTA, type Catalogo, type EstadoDoJev } from './passos.ts';

const catalogo: Catalogo = { agentes: {}, ferramentas: { a: 'faz A', b: 'faz B' }, identidades: {} };
const estado: EstadoDoJev = { agente: 'po', pedido: 'x', contexto: 'y', passos_recentes: [] };

describe('montarPedido', () => {
  it('questions é um OBJETO chaveado pelo id (a forma de lista recebe 400), com a opção reservada', () => {
    const p = montarPedido(estado, ['a', 'b'], catalogo);
    expect(p.model).toBe(MODELO_DO_JEV);
    expect(Array.isArray(p.questions)).toBe(false);
    expect(Object.keys(p.questions[PERGUNTA]!.criteria)).toEqual(['a', 'b', RESPONDER_SEM_FERRAMENTA]);
    expect(p.questions[PERGUNTA]!.criteria.a).toBe('faz A');
  });

  it('recusa catálogo com ferramenta chamada como a opção reservada (colisao_de_nome)', () => {
    expect(() => montarPedido(estado, ['a', RESPONDER_SEM_FERRAMENTA], catalogo)).toThrow(/colisao_de_nome/);
  });
});

describe('lerResposta', () => {
  const ok = {
    id: 'gen-dec-1',
    model: 'typesafe/jev-1.13-20260917',
    answers: { [PERGUNTA]: { type: 'choice', choice: 'a', confidence: 0.92, probabilities: { a: 0.95, b: 0, [RESPONDER_SEM_FERRAMENTA]: 0.05 } } },
    usage: { input_tokens: 367, output_tokens: 55, cost: 0.000015414 },
  };

  it('lê escolha, confiança, custo e o id da geração', () => {
    const r = lerResposta(ok, ['a', 'b']);
    expect(r).toMatchObject({ status: 'ok', escolha: 'a', confianca: 0.92, custoUsd: 0.000015414, tokensDeEntrada: 367, geracao: 'gen-dec-1' });
  });

  it('forma inesperada vira resposta_invalida, nunca exceção', () => {
    expect(lerResposta({ answers: {} }, ['a']).status).toBe('resposta_invalida');
    expect(lerResposta(null, ['a']).status).toBe('resposta_invalida');
  });

  it('escolha fora das opções é queda nomeada', () => {
    const fora = { ...ok, answers: { [PERGUNTA]: { choice: 'zzz', confidence: 0.5 } } };
    expect(lerResposta(fora, ['a', 'b'])).toEqual({ status: 'escolha_fora_das_opcoes', detalhe: 'zzz' });
  });
});
