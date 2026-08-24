/**
 * O ESTADO da faixa de atividade do turno (`TurnActivityStrip.tsx`) — o que
 * um agente conversacional (Criativo, PO, Arquiteto, Dev Lead, UX Designer,
 * Staff) está fazendo ENQUANTO o turno roda, antes de a resposta completa
 * virar `agent.response` no fio.
 *
 * Reducer PURO, sem React nenhum aqui — consumido por `useReducer` em
 * `SessionPage.tsx`. A separação existe pra o comportamento ser testável sem
 * montar componente nenhum: `delta` acumula texto corrente; `tool_call`
 * arquiva o texto corrente (se houver) como uma linha de NARRAÇÃO e sempre
 * adiciona uma linha de FERRAMENTA; `reset` volta ao estado inicial no fim
 * do turno.
 *
 * A frase da ferramenta chega JÁ RESOLVIDA (`frase`, não `tool` cru) — quem
 * despacha resolve via `fraseDaFerramenta` (`lib/narracao-de-ferramentas.ts`)
 * ANTES de despachar. Resolver aqui dentro acoplaria este reducer puro ao
 * i18n global, e o ponto todo de ele ser puro é dar pra testar sem mockar
 * nada disso.
 */

/** Uma linha já ARQUIVADA da faixa — nunca o payload cru da ferramenta (RN-096). */
export type LinhaDeAtividade =
  | { tipo: 'narracao'; texto: string }
  | { tipo: 'ferramenta'; texto: string };

export interface EstadoDaAtividadeDoTurno {
  /** Linhas arquivadas, na ordem em que aconteceram. */
  linhas: LinhaDeAtividade[];
  /** Texto do delta corrente, ainda NÃO arquivado (pode estar vazio). */
  corrente: string;
}

export const ESTADO_INICIAL_DA_ATIVIDADE: EstadoDaAtividadeDoTurno = {
  linhas: [],
  corrente: '',
};

export type AcaoDeAtividadeDoTurno =
  | { tipo: 'delta'; texto: string }
  | { tipo: 'tool_call'; frase: string }
  | { tipo: 'reset' };

export function reduzirAtividadeDoTurno(
  estado: EstadoDaAtividadeDoTurno,
  acao: AcaoDeAtividadeDoTurno,
): EstadoDaAtividadeDoTurno {
  switch (acao.tipo) {
    case 'delta':
      return { ...estado, corrente: estado.corrente + acao.texto };

    case 'tool_call': {
      const linhas = [...estado.linhas];
      // Arquivar corrente VAZIO é no-op — nunca insere uma linha de narração
      // sem texto. A linha de ferramenta, por outro lado, é SEMPRE inserida,
      // mesmo quando a chamada anterior também foi uma ferramenta sem delta
      // nenhum entre as duas (duas chamadas consecutivas viram DUAS linhas).
      if (estado.corrente !== '') {
        linhas.push({ tipo: 'narracao', texto: estado.corrente });
      }
      linhas.push({ tipo: 'ferramenta', texto: acao.frase });
      return { linhas, corrente: '' };
    }

    case 'reset':
      return ESTADO_INICIAL_DA_ATIVIDADE;

    default:
      return estado;
  }
}
