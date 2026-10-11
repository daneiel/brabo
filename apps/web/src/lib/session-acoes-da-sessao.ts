import { useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import {
  confirmArchitectureReadiness,
  confirmReadiness,
  mensagemDaApi,
  renameSession,
  reopenSession,
  startAgent,
  transitionSession,
} from './api-client';
import type { useToast } from '../components/ui/ToastProvider';
import type { useTurnoDoAgente } from './session-turno';
import { mensagemDaRecusaDoAgente } from './recusa-do-agente';
import { ehRecusaDeSessaoEncerrada } from './sessao-encerrada';

type Turno = ReturnType<typeof useTurnoDoAgente>;

/**
 * As ações da própria sessão na tela de Sessão: ativar, reabrir, encerrar,
 * renomear, iniciar a ideação, o aviso de sessão encerrada (RN-581) e as duas
 * prontidões (Criativo e Arquiteto) — com os estados de "reabrindo" e do
 * rascunho do nome.
 *
 * Morou em `SessionPage.tsx` até a AT-505, que moveu os estados e os handlers
 * sem mudar uma linha (refatoração mecânica, ADR 0176). O hook é chamado
 * depois de `useDestinatarioDoChat`, porque a prontidão do Criativo escolhe o
 * PO como destinatário.
 */
export function useAcoesDaSessao({
  projectId,
  sessionId,
  queryClient,
  showToast,
  t,
  iniciarTurnoDoAgente,
  acompanharTurnoPeloLog,
  cancelarTurnoOtimista,
  escolherDestinatario,
}: {
  projectId: string;
  sessionId: string;
  queryClient: QueryClient;
  showToast: ReturnType<typeof useToast>['showToast'];
  t: TFunction<'sessionPage'>;
  iniciarTurnoDoAgente: Turno['iniciarTurnoDoAgente'];
  acompanharTurnoPeloLog: Turno['acompanharTurnoPeloLog'];
  cancelarTurnoOtimista: Turno['cancelarTurnoOtimista'];
  escolherDestinatario: (agente: string) => void;
}) {
  const [reabrindo, setReabrindo] = useState(false);
  // Renomear (RN-098). `null` fora de edição — e não string vazia — porque
  // vazio é um nome que se está digitando, e nenhum campo aberto é outro
  // estado.
  const [rascunhoDoNome, setRascunhoDoNome] = useState<string | null>(null);

  // "Ativar sessão" chama o engine por baixo (a api cria a sessão
  // supervisionada), e por isso falha por motivo que não é do domínio: engine
  // fora do ar, url errada, 500. Sem o `catch`, o clique não mudava NADA na
  // tela — mesmo desfecho de `handleActivateExecution` antes dele ganhar toast.
  async function handleActivate() {
    try {
      await transitionSession(projectId, sessionId, 'active');
      await queryClient.invalidateQueries({ queryKey: ['session', projectId, sessionId] });
      queryClient.invalidateQueries({ queryKey: ['sessions', projectId] });
    } catch (erro) {
      showToast({
        title: mensagemDaApi(erro, t('toasts.erroAtivarSessao')),
        tone: 'danger',
      });
    }
  }

  // A recusa da api (409 de sessão com execução, 403) vira toast com a frase
  // dela; a tela não repete a régua de execução, que só a api sabe inteira.
  async function handleReopen() {
    setReabrindo(true);
    try {
      await reopenSession(projectId, sessionId);
      await queryClient.invalidateQueries({ queryKey: ['session', projectId, sessionId] });
      queryClient.invalidateQueries({ queryKey: ['sessions', projectId] });
      queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
    } catch (erro) {
      showToast({ title: mensagemDaApi(erro, t('toasts.erroReabrirSessao')), tone: 'danger' });
    } finally {
      setReabrindo(false);
    }
  }

  async function handleClose() {
    await transitionSession(projectId, sessionId, 'closing');
    await transitionSession(projectId, sessionId, 'closed');
    queryClient.invalidateQueries({ queryKey: ['session', projectId, sessionId] });
    queryClient.invalidateQueries({ queryKey: ['sessions', projectId] });
  }


  async function handleRename() {
    if (rascunhoDoNome === null) return;
    // Em branco APAGA o nome: `null` no corpo é o caminho de desfazer, e a
    // sessão volta a se identificar só pela hashtag.
    const nome = rascunhoDoNome.trim() || null;
    setRascunhoDoNome(null);
    try {
      await renameSession(projectId, sessionId, nome);
      await queryClient.invalidateQueries({ queryKey: ['session', projectId, sessionId] });
      // A lista da aba Sessões mostra o mesmo rótulo — sem isto, o nome novo
      // só apareceria lá no próximo carregamento da tela.
      queryClient.invalidateQueries({ queryKey: ['sessions', projectId] });
    } catch {
      showToast({ title: t('toasts.erro'), message: t('toasts.erroRenomear'), tone: 'danger' });
    }
  }

  async function handleStartIdeation() {
    try {
      await startAgent(projectId, sessionId, 'criativo');
      await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
    } catch {
      showToast({ title: t('toasts.erro'), message: t('toasts.erroIniciarIdeacao'), tone: 'danger' });
    }
  }

  /**
   * AT-154 (RN-581): a api recusou conversa porque a sessão já é terminal. A
   * tela diz isso e refaz a leitura da sessão — é o `status` novo que faz o
   * composer sumir, como já some em `closed`. Não promete "Reabrir": a ação
   * não existe ainda (AT-071). Devolve `true` quando era essa recusa.
   */
  function avisarSessaoEncerrada(erro: unknown): boolean {
    if (!ehRecusaDeSessaoEncerrada(erro)) return false;
    showToast({
      title: t('toasts.erro'),
      message: t('toasts.sessaoEncerrada'),
      tone: 'danger',
    });
    queryClient.invalidateQueries({ queryKey: ['session', projectId, sessionId] });
    queryClient.invalidateQueries({ queryKey: ['sessions', projectId] });
    return true;
  }

  async function handleReadiness() {
    try {
      iniciarTurnoDoAgente('criativo');
      await confirmReadiness(projectId, sessionId);
      // ADR 0163 (RN-578): resolver é o ACEITE, não o fim do turno — o
      // product_brief + handoff chegam depois, pelo canal (`agent.done`) e
      // pelo log. Até lá esta linha era `finalizarTurnoDoAgente()` (a rede de
      // segurança da RN-131), e a chamada só resolvia com o turno pronto.
      acompanharTurnoPeloLog('criativo');
      // ADR 0185: o clique fechou a necessidade (RN-657) e aceita, em nome
      // de quem clicou, o handoff ao PO que o turno oferecer (RN-658). É o
      // gesto de chamar o PO — o mesmo que aceitar pelo card (RN-631) —, então
      // o destinatário passa a ser ele; enquanto o PO não entra, a escolha
      // não vale e o Criativo, opção única, segue recebendo.
      escolherDestinatario('po');
      showToast({ title: t('toasts.prontoRegistrado'), tone: 'success' });
    } catch (erro) {
      cancelarTurnoOtimista();
      if (avisarSessaoEncerrada(erro)) return;
      // A recusa do agente (409 turno em curso, 422 sem regra de negócio) traz
      // a frase dele; a mensagem genérica fica para o que não tem frase.
      showToast({
        title: t('toasts.erro'),
        message: mensagemDaRecusaDoAgente(erro, t('toasts.erroConfirmarProntidao')),
        tone: 'danger',
      });
    }
  }

  /**
   * Mirror de `handleReadiness`, para o Arquiteto (achado do problema 1):
   * dispara `OfferInfraHandoffUseCase`, que oferece o handoff ao Infra — o
   * Arquiteto narra a arquitetura pronta no fio, e o handoff nasce em seguida;
   * o do Dev Lead sai da Infra, com o container `running` (RN-672). Desde o ADR 0163 a
   * chamada resolve no ACEITE, e o fim do turno de fechamento chega pelo
   * canal e pelo log (`acompanharTurnoPeloLog`).
   */
  async function handleArchitectureReadiness() {
    try {
      iniciarTurnoDoAgente('arquiteto');
      await confirmArchitectureReadiness(projectId, sessionId);
      acompanharTurnoPeloLog('arquiteto');
    } catch (erro) {
      cancelarTurnoOtimista();
      if (avisarSessaoEncerrada(erro)) return;
      showToast({
        title: t('toasts.erro'),
        message: mensagemDaRecusaDoAgente(erro, t('toasts.erroConfirmarArquitetura')),
        tone: 'danger',
      });
    }
  }

  return {
    reabrindo,
    rascunhoDoNome,
    setRascunhoDoNome,
    handleActivate,
    handleReopen,
    handleClose,
    handleRename,
    handleStartIdeation,
    avisarSessaoEncerrada,
    handleReadiness,
    handleArchitectureReadiness,
  };
}
