import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { mensagemDaApi, setAgentAutonomy } from '../lib/api-client';
import { AGENT_AUTONOMY_ALL_ACTIONS, type AgentAutonomyRule } from '../lib/api-types';
import { nomeDoAgente } from '../lib/agents';
import { AREAS } from '../lib/agent-areas.generated';
import { Button } from './ui/Button';
import { OQueOPilotoLibera } from './OQueOPilotoLibera';
import styles from './ModoAutomaticoDoTime.module.css';

/**
 * O modo automático oferecido EM LOTE para o time, no início da execução
 * (RN-661, AT-315).
 *
 * É UM controle, e ele é oferta: nada é gravado sem o clique em "Ligar".
 * Grava a MESMA curinga que o toggle de cada agente e o botão do
 * `ApprovalCard` (`agent_autonomy`, `actionType: "*"`, RN-153), pelo MESMO
 * endpoint (`PUT .../agent-autonomy`, `maintainer`) — um PUT por agente
 * escolhido, em série, sem abortar na primeira recusa (RN-469): o desfecho é
 * POR AGENTE, e os três (todos, nenhum, alguns) não se disfarçam. Desligar
 * continua sendo o toggle de cada agente; não há "desligar em lote".
 *
 * A tela DIZ o que o modo automático NÃO libera — os tetos absolutos (RN-154,
 * RN-418) seguem pedindo aprovação, e quem liga em lote precisa ler isso ANTES
 * do clique, não depois. Desde a RN-670 (ADR 0189) diz também o que o PILOTO
 * libera, pela MESMA lista do `ApprovalCard` e do card do agente
 * (`OQueOPilotoLibera`).
 */
export interface ModoAutomaticoDoTimeProps {
  projectId: string;
  /** Os agentes do time de execução, na ordem da tela. */
  agentes: readonly string[];
  autonomyRules: readonly AgentAutonomyRule[] | undefined;
  /** `maintainer` no endpoint (RN-102); sem ele o controle fica inerte. */
  podeLigar: boolean;
  /**
   * RN-816 (AT-488): no cartão do plano a execução ainda NÃO começou —
   * começa ao aprovar (RN-677) —, e o texto de abertura é outro.
   */
  noPlano?: boolean;
}

export function agentesEmModoAutomatico(
  rules: readonly AgentAutonomyRule[] | undefined,
): Set<string> {
  return new Set(
    (rules ?? [])
      .filter(
        (r) => r.actionType === AGENT_AUTONOMY_ALL_ACTIONS && r.mode === 'auto_approve',
      )
      .map((r) => r.agentId),
  );
}

/**
 * AT-449 (RN-766): a oferta cobre os subagentes de GATE desde a ativação, e
 * não só depois que eles aparecem no roster — o `qa-automacao` só entra na
 * lista quando o primeiro evento dele chega, e aí a primeira ação dele já
 * está esperando clique. São os agentes da área de QA (`AREAS.qa`), que
 * rodam o `terminal`; a ordem é a do time e depois a dos gates, sem repetir.
 */
export function agentesDaOfertaEmLote(time: readonly string[]): string[] {
  const gates = [AREAS.qa.lead, ...AREAS.qa.members];
  return [...new Set([...time, ...gates])];
}

type Desfecho =
  | { tipo: 'todos'; total: number }
  | { tipo: 'nenhum'; mensagem: string }
  | { tipo: 'alguns'; ok: number; total: number; falharam: string[] };

export function ModoAutomaticoDoTime({
  projectId,
  agentes,
  autonomyRules,
  podeLigar,
  noPlano = false,
}: ModoAutomaticoDoTimeProps) {
  const { t } = useTranslation('executors');
  const queryClient = useQueryClient();
  const jaLigados = agentesEmModoAutomatico(autonomyRules);
  const candidatos = agentes.filter((a) => !jaLigados.has(a));
  // Oferta: todos os que ainda não estão em automático vêm marcados, e a
  // pessoa desmarca quem não quer. Marcar não grava nada.
  const [desmarcados, setDesmarcados] = useState<Set<string>>(new Set());
  const [ligando, setLigando] = useState(false);
  const [desfecho, setDesfecho] = useState<Desfecho | null>(null);

  if (candidatos.length === 0 && !desfecho) return null;

  const escolhidos = candidatos.filter((a) => !desmarcados.has(a));
  // AT-477 (RN-803): enquanto a leitura de `agent_autonomy` não chegou, a
  // lista de candidatos é PALPITE (todos) e encolhe quando ela chega — o
  // botão e as caixas mudam de lugar sob o cursor, e o primeiro clique caía
  // em outro elemento sem gravar nada nem dizer nada. Inerte, com o motivo
  // em texto, até a leitura chegar.
  const carregando = autonomyRules === undefined;

  function alternar(agente: string) {
    setDesmarcados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(agente)) proximo.delete(agente);
      else proximo.add(agente);
      return proximo;
    });
  }

  async function ligar() {
    if (carregando || ligando || escolhidos.length === 0) return;
    setLigando(true);
    setDesfecho(null);
    const falharam: string[] = [];
    let ultimaMensagem = '';
    for (const agentId of escolhidos) {
      try {
        await setAgentAutonomy(projectId, {
          agentId,
          actionType: AGENT_AUTONOMY_ALL_ACTIONS,
          mode: 'auto_approve',
        });
      } catch (erro) {
        falharam.push(agentId);
        ultimaMensagem = mensagemDaApi(erro, t('autoModeTeam.erroGenerico'));
      }
    }
    // O desfecho é dito mesmo que a releitura falhe: ela não decide nada.
    await queryClient
      .invalidateQueries({ queryKey: ['agent-autonomy', projectId] })
      .catch(() => undefined);
    const total = escolhidos.length;
    if (falharam.length === 0) setDesfecho({ tipo: 'todos', total });
    else if (falharam.length === total) setDesfecho({ tipo: 'nenhum', mensagem: ultimaMensagem });
    else setDesfecho({ tipo: 'alguns', ok: total - falharam.length, total, falharam });
    setLigando(false);
  }

  return (
    <section className={styles.card} aria-labelledby="modo-automatico-do-time-titulo">
      <h3 id="modo-automatico-do-time-titulo" className={styles.titulo}>
        {t('autoModeTeam.title')}
      </h3>
      <p className={styles.texto}>{t(noPlano ? 'autoModeTeam.planSubtitle' : 'autoModeTeam.subtitle')}</p>

      {candidatos.length > 0 && (
        <ul className={styles.lista}>
          {candidatos.map((agente) => (
            <li key={agente}>
              <label className={styles.opcao}>
                <input
                  type="checkbox"
                  checked={!desmarcados.has(agente)}
                  disabled={!podeLigar || ligando || carregando}
                  onChange={() => alternar(agente)}
                />
                {nomeDoAgente(agente)}
              </label>
            </li>
          ))}
        </ul>
      )}

      <OQueOPilotoLibera />

      {!podeLigar && (
        <p className={styles.texto} data-testid="modo-automatico-sem-papel">
          {t('autoModeTeam.noRole')}
        </p>
      )}

      {carregando && podeLigar && (
        <p className={styles.texto} data-testid="modo-automatico-carregando">
          {t('autoModeTeam.loading')}
        </p>
      )}

      {candidatos.length > 0 && (
        <Button
          variant="primary"
          loading={ligando}
          disabled={!podeLigar || carregando || escolhidos.length === 0}
          onClick={() => void ligar()}
        >
          {t('autoModeTeam.button', { count: escolhidos.length })}
        </Button>
      )}

      {desfecho && (
        <p className={styles.desfecho} role="status">
          {desfecho.tipo === 'todos'
            ? t('autoModeTeam.result.all', { count: desfecho.total })
            : desfecho.tipo === 'nenhum'
              ? t('autoModeTeam.result.none', { mensagem: desfecho.mensagem })
              : t('autoModeTeam.result.some', {
                  ok: desfecho.ok,
                  total: desfecho.total,
                  falharam: desfecho.falharam.map(nomeDoAgente).join(', '),
                })}
        </p>
      )}
    </section>
  );
}
