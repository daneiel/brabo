import type { SessionEvent } from '../lib/api-types';
import type { HistoricoDeEventos } from '../lib/hooks';

/**
 * O retorno de `useSessionEventHistory` para os testes que mockam
 * `../lib/hooks` inteiro.
 *
 * Existe por uma razão específica: vinte e um testes de tela substituem o
 * módulo de hooks por um objeto literal, e um hook novo consumido pela tela
 * vira `undefined is not a function` em todos eles de uma vez. Concentrar a
 * forma aqui faz o próximo campo do contrato custar UMA edição em vez de
 * vinte e uma — e, mais importante, impede que vinte e uma cópias divirjam
 * sobre o que é um histórico "vazio".
 *
 * O padrão é o caso ESTÁVEL: tudo já carregado, nada anterior, sem erro. Quem
 * quer testar paginação, erro ou carregamento sobrepõe o campo — é o que
 * mantém o helper honesto, em vez de esconder estado que o teste deveria
 * declarar.
 */
export function historicoFalso(
  items?: unknown,
  over: Partial<HistoricoDeEventos> = {},
): HistoricoDeEventos {
  const lista = (Array.isArray(items) ? items : []) as SessionEvent[];
  return {
    events: lista,
    baixados: lista,
    carregados: lista.length,
    temMaisAntigos: false,
    carregarMaisAntigos: () => {},
    carregandoMaisAntigos: false,
    isPending: false,
    isError: false,
    error: null,
    refetch: () => {},
    ...over,
  };
}
