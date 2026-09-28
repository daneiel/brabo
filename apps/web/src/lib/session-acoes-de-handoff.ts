import { useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import {
  acceptHandoff,
  activateExecution,
  mensagemDaApi,
  requestManualHandoff,
  setAgentAutonomy,
  validateNecessity,
} from './api-client';
import { AGENT_AUTONOMY_ALL_ACTIONS } from './api-types';
import type { useToast } from '../components/ui/ToastProvider';
import type { useTurnoDoAgente } from './session-turno';

type Turno = ReturnType<typeof useTurnoDoAgente>;

/**
 * As ações da tela de Sessão que NÃO são turno de conversa e mexem em handoff
 * ou execução: validar a necessidade (RN-406), pedir o handoff manual (ADR
 * 0109/RN-440), aceitar um handoff (com a fusão condicional da RN-161),
 * ativar a execução pelo atalho do card (RN-137) e ligar o modo automático
 * pelo card de aprovação (RN-153) — com os quatro estados de "em voo" delas.
 *
 * Morou em `SessionPage.tsx` até o PR 9 do programa do ADR 0176, que moveu os
 * estados e os cinco handlers sem mudar uma linha; o hook é chamado depois de
 * `useTurnoDoAgente`, porque aceitar um handoff arma o turno do agente que
 * entra.
 */
export function useAcoesDeHandoff({
  projectId,
  sessionId,
  queryClient,
  showToast,
  t,
  podeFundirHandoffComExecucao,
  iniciarTurnoDoAgente,
  turnoAgentRef,
  setTurnoViaCanal,
}: {
  projectId: string;
  sessionId: string;
  queryClient: QueryClient;
  showToast: ReturnType<typeof useToast>['showToast'];
  t: TFunction<'sessionPage'>;
  podeFundirHandoffComExecucao: boolean;
  iniciarTurnoDoAgente: Turno['iniciarTurnoDoAgente'];
  turnoAgentRef: Turno['turnoAgentRef'];
  setTurnoViaCanal: Turno['setTurnoViaCanal'];
}) {
  // Ativação inline da execução, a partir do card de aceite do handoff pro
  // Dev Lead (achado do problema 2) — mesmo padrão de `promovendoStoryId`.
  const [ativandoExecucao, setAtivandoExecucao] = useState(false);
  // Gate `necessidade-validada` (RN-406) — diferente de `streaming`
  // (`handleReadiness`/`handleArchitectureReadiness`), esta confirmação NÃO
  // é um turno do engine: é só um POST que grava o evento, mesmo padrão de
  // `ativandoExecucao`.
  const [validandoNecessidade, setValidandoNecessidade] = useState(false);
  // Handoff manual a agente à escolha (ADR 0109/RN-440) — o seletor some
  // depois do envio (some junto com `offeredHandoff` ao ser aceito), então
  // não precisa lembrar a escolha entre um handoff e outro.
  const [manualHandoffTarget, setManualHandoffTarget] = useState('');
  const [enviandoHandoffManual, setEnviandoHandoffManual] = useState(false);

  /**
   * Gate `necessidade-validada` (RN-406, ADR 0095) — o usuário confirma que
   * o `product_brief` que o Criativo consolidou reflete de verdade a
   * necessidade de negócio. Diferente de `handleReadiness`/
   * `handleArchitectureReadiness`, NÃO é um `GenServer.call` síncrono no
   * engine (o handoff Criativo→PO já aconteceu dentro do próprio
   * `confirm_readiness`): é só um POST que grava `necessity.validated`, sem
   * turno pra esperar — por isso não usa `streaming`, e sim um loading
   * próprio (`validandoNecessidade`), mesmo padrão de `handleActivateExecution`.
   */
  async function handleValidateNecessity() {
    if (validandoNecessidade) return;
    setValidandoNecessidade(true);
    try {
      await validateNecessity(projectId, sessionId);
      await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      showToast({ title: t('toasts.necessidadeValidada'), tone: 'success' });
    } catch (erro) {
      showToast({
        title: mensagemDaApi(erro, t('toasts.erroValidarNecessidade')),
        tone: 'danger',
      });
    } finally {
      setValidandoNecessidade(false);
    }
  }

  // Handoff manual a agente à escolha (ADR 0109/RN-440): não é um turno do
  // engine (mesmo padrão de `handleValidateNecessity`, não de `handleSend`),
  // então não liga `streaming`/`iniciarTurnoDoAgente`. O card de aceite
  // existente (`offeredHandoff`) pega o handoff novo sozinho no próximo poll
  // de `useHandoffs` (3s) — sem isso a invalidação já cobriria o mesmo
  // resultado mais rápido, mas o handoff em si só passa a existir depois
  // deste POST responder.
  async function handleRequestManualHandoff() {
    if (!manualHandoffTarget || enviandoHandoffManual) return;
    setEnviandoHandoffManual(true);
    try {
      await requestManualHandoff(projectId, sessionId, manualHandoffTarget);
      await queryClient.invalidateQueries({
        queryKey: ['session-handoffs', projectId, sessionId],
      });
      setManualHandoffTarget('');
      showToast({ title: t('toasts.handoffManualEnviado'), tone: 'success' });
    } catch (erro) {
      showToast({
        title: mensagemDaApi(erro, t('toasts.erroHandoffManual')),
        tone: 'danger',
      });
    } finally {
      setEnviandoHandoffManual(false);
    }
  }

  async function handleAcceptHandoff(handoffId: string, toAgent: string) {
    // Fixado ANTES do `await` (achado B): o kickoff do agente no engine é um
    // `GenServer.cast` assíncrono, e o `agent.status` "working" pode chegar
    // pelo canal antes mesmo desta chamada resolver. Sem o ref pronto agora,
    // o handler perderia a corrida e o indicador nasceria sem saber quem é.
    iniciarTurnoDoAgente(toAgent, { comStatus: false });
    try {
      await acceptHandoff(projectId, sessionId, handoffId);
      await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      // O aceite ao Arquiteto (e ao Dev Lead, segunda porta) provisiona o
      // repositório (RN-582) — as telas que perguntam por ele precisam saber.
      queryClient.invalidateQueries({ queryKey: ['repository', projectId] });
      queryClient.invalidateQueries({ queryKey: ['session-handoffs', projectId, sessionId] });
      // RN-161: fusão condicional por papel EFETIVO. `maintainer`/`owner` já
      // pode ativar a execução (mesma exigência do backend em
      // `POST .../execution/activate`) — encadear aqui poupa o segundo
      // clique em "Ativar execução". `handleActivateExecution` trata o
      // próprio erro (toast + `mensagemDaApi`) e não relança, então um
      // 403/409 dela nunca cai neste `catch` como "não foi possível aceitar
      // o handoff", que seria a frase ERRADA (o aceite já tinha funcionado).
      // Quem só é `developer` mantém o fluxo de hoje: aceitar sem encadear,
      // com "Ativar execução" continuando disponível como segundo botão
      // enquanto o card seguir na tela.
      if (toAgent === 'dev-lead' && podeFundirHandoffComExecucao) {
        await handleActivateExecution();
      }
    } catch {
      turnoAgentRef.current = null;
      setTurnoViaCanal(false);
      showToast({ title: t('toasts.erro'), message: t('toasts.erroAceitarHandoff'), tone: 'danger' });
    }
  }

  /**
   * Atalho de ativação da execução, embutido no próprio card de aceite do
   * handoff pro Dev Lead (RN-137) — MESMA `activateExecution` que a Visão
   * Geral já chama, e não uma rota nova.
   *
   * `sessionId` viaja como `originSessionId` (RN-135/PR #266): sem ele a
   * sessão de chat que trouxe o Dev Lead ficava `active` para sempre, mesmo
   * com a execução (numa sessão SEPARADA) já tendo decolado sozinha por
   * este atalho.
   *
   * Autorização: `POST .../execution/activate` continua exigindo
   * `maintainer` no backend — DELIBERADAMENTE não alinhada ao `developer`
   * que basta pra aceitar o handoff. Quem ativa vira `session.createdBy` da
   * sessão de execução, e `ProposeActionUseCase` resolve o papel EFETIVO
   * dos `git_commit`/`git_push`/`pr_open` dos dev agents a partir dele (ver
   * o comentário em `ExecutionController#activate`) — soltar a exigência
   * aqui inverteria essa resolução em silêncio: as PRs que a execução abre
   * passariam de `auto_approve` para `require_approval` sempre que quem
   * clicou for `developer`, e ninguém decidiu isso explicitamente. Quem não
   * é maintainer recebe a frase real da api (`mensagemDaApi`, "Papel
   * insuficiente para esta ação"), não um erro genérico.
   *
   * module_map: sem gate próprio aqui. Quando este card existe, o
   * Arquiteto já o definiu — é o artefato que precede a oferta do handoff
   * pro Dev Lead —, então replicar o `disabled={!hasModuleMap}` da Visão
   * Geral travaria o botão à toa; o caso raro cai no catch abaixo.
   */
  async function handleActivateExecution() {
    if (ativandoExecucao) return;
    setAtivandoExecucao(true);
    try {
      await activateExecution(projectId, sessionId);
      await queryClient.invalidateQueries({ queryKey: ['session', projectId, sessionId] });
      queryClient.invalidateQueries({ queryKey: ['sessions', projectId] });
      queryClient.invalidateQueries({ queryKey: ['session-handoffs', projectId, sessionId] });
      showToast({ title: t('toasts.execucaoAtivada'), tone: 'success' });
    } catch (erro) {
      showToast({
        title: mensagemDaApi(erro, t('toasts.erroAtivarExecucao')),
        tone: 'danger',
      });
    } finally {
      setAtivandoExecucao(false);
    }
  }

  // "Auto mode" (RN-153) — grava a curinga `actionType: "*"` de
  // `agent_autonomy` pro agente que propôs a ação do card. NÃO aprova a ação
  // em si (isso é o botão Aprovar); liga a autonomia pras PRÓXIMAS. Mesma
  // `queryKey` (`agent-autonomy`) que a Visão Geral/Executores leem pro
  // toggle do card do agente — é ele que serve de "desligar" depois.
  async function handleActivateAutoMode(agentId: string) {
    try {
      await setAgentAutonomy(projectId, {
        agentId,
        actionType: AGENT_AUTONOMY_ALL_ACTIONS,
        mode: 'auto_approve',
      });
      await queryClient.invalidateQueries({ queryKey: ['agent-autonomy', projectId] });
      showToast({ title: t('toasts.modoAutomaticoLigado'), message: agentId, tone: 'success' });
    } catch (erro) {
      showToast({
        title: mensagemDaApi(erro, t('toasts.erroModoAutomatico')),
        message: agentId,
        tone: 'danger',
      });
    }
  }

  return {
    ativandoExecucao,
    validandoNecessidade,
    manualHandoffTarget,
    setManualHandoffTarget,
    enviandoHandoffManual,
    handleValidateNecessity,
    handleRequestManualHandoff,
    handleAcceptHandoff,
    handleActivateExecution,
    handleActivateAutoMode,
  };
}
