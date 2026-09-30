import { useQueries } from '@tanstack/react-query';
import { listSessionEvents } from './api-client';
import type { ProposedAction, SessionEvent } from './api-types';
import {
  decisaoDaPoliticaDaAcao,
  lerDecisaoDaPolitica,
  type DecisaoDaPoliticaLida,
} from './decisao-da-politica';

/**
 * O motivo da política de CADA ação de uma fila (AT-336, RN-614).
 *
 * A ação não guarda o motivo; ele mora no `proposed_action.created`, no log
 * da sessão que propôs a ação. Uma fila do PROJETO mistura sessões, e a tela
 * só carrega o log de uma — daí a nota única da AT-333. Agora cada ação que o
 * log carregado não cobre é lida PELA AÇÃO: `GET .../sessions/:sessionId/
 * events?actionId=`, na sessão que a própria ação carrega.
 *
 * Três escolhas que valem registro:
 *
 * - **O que já está carregado não vira requisição.** A ação cujo evento está
 *   nos `eventos` que a tela já tem usa esses, como antes; só as outras pedem.
 * - **`staleTime: Infinity`.** Evento é imutável (nunca UPDATE): o motivo de
 *   uma ação não muda depois de gravado, então cada ação custa UMA leitura
 *   enquanto o cache viver, e a fila polla sem repetir nenhuma.
 * - **Evento ausente não é falha.** A leitura que responde sem o
 *   `proposed_action.created` dá a frase de "não registrado" (a ação existe e
 *   o log não diz o motivo); só a leitura que FALHA fica sem frase e é
 *   contada em `falhas` — é essa, e só essa, que a nota da fila conta.
 *
 * `eventos === null` quer dizer "a tela ainda está carregando o próprio log":
 * nada é pedido até ele chegar, senão toda ação da sessão de trabalho viraria
 * uma requisição que o log ia responder de graça um instante depois.
 */
export function useDecisoesDaPolitica(
  projectId: string,
  acoes: readonly ProposedAction[],
  eventos: readonly SessionEvent[] | null,
): { decisoes: Map<string, DecisaoDaPoliticaLida | undefined>; falhas: number } {
  const locais = new Map(
    acoes.map((a) => [a.id, eventos ? decisaoDaPoliticaDaAcao(a.id, eventos) : null] as const),
  );
  const aBuscar = eventos === null ? [] : acoes.filter((a) => locais.get(a.id) === null);

  const leituras = useQueries({
    queries: aBuscar.map((acao) => ({
      queryKey: ['decisao-da-politica', projectId, acao.sessionId, acao.id],
      queryFn: async (): Promise<DecisaoDaPoliticaLida> => {
        const pagina = await listSessionEvents(projectId, acao.sessionId, {
          actionId: acao.id,
          limit: 200,
        });
        return (
          decisaoDaPoliticaDaAcao(acao.id, pagina.items) ??
          lerDecisaoDaPolitica({ actionType: acao.actionType })
        );
      },
      staleTime: Infinity,
    })),
  });

  const lidas = new Map(aBuscar.map((a, i) => [a.id, leituras[i]] as const));
  let falhas = 0;
  const decisoes = new Map<string, DecisaoDaPoliticaLida | undefined>();
  for (const acao of acoes) {
    const local = locais.get(acao.id);
    if (local) {
      decisoes.set(acao.id, local);
      continue;
    }
    const leitura = lidas.get(acao.id);
    if (leitura?.isError) falhas += 1;
    decisoes.set(acao.id, leitura?.data);
  }
  return { decisoes, falhas };
}
