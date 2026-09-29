import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { Disclosure } from '../components/ui/Disclosure';
import { AvatarDoAgente } from '../components/ui/AvatarDoAgente';
import { corDoAgente, nomeDoAgente } from '../lib/agents';
import { agruparPorOrigem, type OrigemDeEvento } from '../lib/activity';
import type { Handoff, ProposedAction } from '../lib/api-types';
import type { TimelineEntry } from '../lib/session-timeline';
import styles from './SessionPage.module.css';

/*
 * As passadas de APRESENTAÇÃO do fio da sessão que rodam depois de a timeline
 * estar montada e ordenada: o colapso de "Passos do turno", o colapso por
 * agente que passou o bastão (RN-138) e o corte entre o histórico recolhido
 * por origem e as entradas recentes (RN-177). Moraram em `SessionPage.tsx`
 * até o PR 1 do programa do ADR 0176, que as moveu sem mudar uma linha de
 * lógica: as duas que eram corpo de `useMemo` viraram funções chamadas DE
 * DENTRO do mesmo `useMemo`, com as mesmas dependências — quem decide QUANDO
 * recalcular continua sendo o componente.
 *
 * `.tsx` em `routes/`, e não `.ts` em `lib/`, pelo motivo do ADR 0122:
 * produzem JSX (`<Disclosure>`) e leem `SessionPage.module.css`, que os
 * irmãos extraídos importam direto.
 */

/**
 * Colapsa `agent.response` CONSECUTIVAS do mesmo turno+autor num `Disclosure`
 * compacto ("Passos do turno · N"), deixando só a ÚLTIMA intacta e fora dele —
 * a faixa de atividade (`TurnActivityStrip`) já narra o CAMINHO até a
 * resposta em tempo real; isto é o mesmo princípio aplicado ao HISTÓRICO, para
 * um turno que produziu várias respostas seguidas (ex.: o modelo "pensa em
 * voz alta" entre chamadas de ferramenta) não virar N bolhas iguais empilhadas
 * no fio.
 *
 * Roda DEPOIS de `afundarDesfechos` na composição (nunca antes: a ordem de
 * apresentação já precisa estar resolvida) e reusa os MESMOS dois campos que
 * `afundarDesfechos` já lê — `turno` e `autor` — pra decidir a partição:
 * turnos ou autores diferentes NUNCA se misturam no mesmo grupo. Só entradas
 * com `agentResponse: true` participam; qualquer outro tipo quebra a
 * sequência corrente (mesma régua de "fronteira" que `afundarDesfechos` usa
 * pra desfecho) e passa direto, sem ser tocado.
 *
 * Função AGNÓSTICA a agente — nenhuma lista de nomes de agente aqui dentro,
 * só `turno`/`autor`/o marcador de tipo. `titulo`/`trailing` chegam já
 * resolvidos (quem chama passa o `t()` da sessão) pra este módulo continuar
 * testável como função pura, sem precisar montar `I18nextProvider`.
 */
export function agruparNarracoesDoTurno(
  entradas: TimelineEntry[],
  rotulos: { titulo: string; trailing: (count: number) => string },
): TimelineEntry[] {
  const resultado: TimelineEntry[] = [];
  let grupo: TimelineEntry[] = [];

  function fecharGrupo() {
    if (grupo.length === 0) return;
    if (grupo.length === 1) {
      resultado.push(grupo[0]);
      grupo = [];
      return;
    }
    const compactadas = grupo.slice(0, -1);
    const ultima = grupo[grupo.length - 1];
    const primeira = compactadas[0];
    resultado.push({
      ...primeira,
      node: (
        <Disclosure
          key={`narracoes-${primeira.seq}`}
          titulo={rotulos.titulo}
          trailing={rotulos.trailing(compactadas.length)}
          classNameCabecalho={styles.narracoesCabecalho}
          className={styles.narracoesGrupo}
        >
          <div className={styles.narracoesRegiao}>
            {compactadas.map((e) => (
              <div key={e.seq}>{e.node}</div>
            ))}
          </div>
        </Disclosure>
      ),
    });
    resultado.push(ultima);
    grupo = [];
  }

  for (const entrada of entradas) {
    // `turno === 0` é o PRÓLOGO (`turnoDoSeq`: "antes da primeira abertura"),
    // nunca um turno de verdade — não há o que narrar como "passos DO turno"
    // ali. Excluir o prólogo também é o que preserva o comportamento de
    // fixtures antigas (`SessionPage.painel-e-agrupamento.test.tsx`,
    // `SessionPage.handoff-devlead-e-colapso.test.tsx`) que empilham vários
    // `agent.response` sem nenhum evento de usuário entre eles só pra testar
    // OUTRO mecanismo (RN-138, RN-177) — sem fronteira de turno nenhuma,
    // agrupá-los aqui coincidiria por acidente com o que aquele mecanismo já
    // resolve, produzindo Disclosure dentro de Disclosure.
    if (!entrada.agentResponse || entrada.turno === 0) {
      fecharGrupo();
      resultado.push(entrada);
      continue;
    }
    const anterior = grupo[grupo.length - 1];
    if (anterior && (anterior.turno !== entrada.turno || anterior.autor !== entrada.autor)) {
      fecharGrupo();
    }
    grupo.push(entrada);
  }
  fecharGrupo();

  return resultado;
}

/**
 * Quantas entradas do fio ficam ABERTAS antes de o resto virar histórico
 * recolhido por origem (RN-177). Mesmo número do painel de log, e pelo mesmo
 * pedido: "mantém as últimas 5 mensagens".
 */
export const FIO_RECENTES_ABERTAS = 5;

/** Uma entrada do fio já agrupado: o que a tela renderiza, na ordem. */
export interface EntradaDoFio {
  key: string;
  node: ReactNode;
  origem: OrigemDeEvento;
}

// Colapso de mensagens por agente depois que ele passa o bastão (RN-138) —
// segunda passagem sobre `timeline`, agrupando entradas CONSECUTIVAS do
// MESMO `agentId`. Um agente só é elegível quando (a) ele já ofereceu um
// handoff ACEITO (bastão passado — `handoffs`, não o event log: o status
// já É a mesma verdade, e sem round-trip por evento) e (b) nenhuma ação
// dele segue `pending` (a corrida de aprovação não pode ficar escondida
// atrás de um clique). Entradas sem `agentId` (usuário, divisores/cards de
// transição) sempre quebram a sequência corrente, exatamente como uma
// troca de agente quebra.
export function agruparTimelinePorAgente(
  timeline: TimelineEntry[],
  handoffs: Handoff[],
  actions: ProposedAction[],
  t: TFunction<'sessionPage'>,
): EntradaDoFio[] {
  const passaramBastao = new Set(
    handoffs.filter((h) => h.status === 'accepted').map((h) => h.fromAgent),
  );
  const comAcaoPendente = new Set(
    actions.filter((a) => a.status === 'pending').map((a) => a.actor.id),
  );
  const colapsavel = (agentId: string) =>
    passaramBastao.has(agentId) && !comAcaoPendente.has(agentId);

  const resultado: EntradaDoFio[] = [];
  let corrente: TimelineEntry[] = [];

  function fecharCorrente() {
    if (corrente.length === 0) return;
    const agentId = corrente[0].agentId;
    // Só vira cabeçalho colapsável com 2+ entradas — uma sozinha não ganha
    // nada em virar "Fulano · 1 mensagem" no lugar da própria mensagem.
    if (agentId && corrente.length >= 2 && colapsavel(agentId)) {
      const grupo = corrente;
      resultado.push({
        key: `grupo-${agentId}-${grupo[0].seq}`,
        // Um colapso por agente é, por construção, fala de agente — mesmo
        // quando o que ele contém veio de origens diferentes.
        origem: 'agente',
        node: (
          <div style={corDoAgente(agentId)}>
            <Disclosure
              titulo={
                <span className={styles.agentGroupTitulo}>
                  <AvatarDoAgente id={agentId} />
                  {nomeDoAgente(agentId)}
                </span>
              }
              trailing={t('artefatos.mensagensCount', { count: grupo.length })}
              classNameCabecalho={styles.agentGroupCabecalho}
              className={styles.agentGroup}
            >
              <div className={styles.agentGroupRegiao}>
                {grupo.map((e) => (
                  <div key={e.seq}>{e.node}</div>
                ))}
              </div>
            </Disclosure>
          </div>
        ),
      });
    } else {
      for (const e of corrente) {
        resultado.push({ key: String(e.seq), node: e.node, origem: e.origem });
      }
    }
    corrente = [];
  }

  for (const entry of timeline) {
    if (entry.agentId && corrente[0]?.agentId === entry.agentId) {
      corrente.push(entry);
      continue;
    }
    fecharCorrente();
    if (entry.agentId) {
      corrente = [entry];
    } else {
      resultado.push({ key: String(entry.seq), node: entry.node, origem: entry.origem });
    }
  }
  fecharCorrente();

  return resultado;
}

/**
 * RN-177 no FIO: as últimas {@link FIO_RECENTES_ABERTAS} entradas ficam
 * abertas e tudo que veio antes vira histórico recolhido POR ORIGEM.
 *
 * O fio é CRESCENTE (o mais novo em baixo, junto do composer), então aqui o
 * histórico fica no TOPO — é a mesma regra do painel de log com o eixo
 * invertido, e não uma segunda decisão.
 *
 * O corte é sobre a lista JÁ agrupada por agente (RN-138): quem conta é o
 * que o usuário vê, e um colapso de doze mensagens é UMA entrada na tela.
 * Contar entradas cruas faria "as últimas 5" esconderem a conversa inteira
 * atrás de um agrupamento.
 */
export function dividirFio(timelineAgrupada: EntradaDoFio[]): {
  historico: { origem: OrigemDeEvento; itens: EntradaDoFio[] }[];
  recentes: EntradaDoFio[];
} {
  if (timelineAgrupada.length <= FIO_RECENTES_ABERTAS) {
    return { historico: [], recentes: timelineAgrupada };
  }
  const corte = timelineAgrupada.length - FIO_RECENTES_ABERTAS;
  return {
    historico: agruparPorOrigem(
      timelineAgrupada.slice(0, corte),
      (item) => item.origem,
    ),
    recentes: timelineAgrupada.slice(corte),
  };
}
