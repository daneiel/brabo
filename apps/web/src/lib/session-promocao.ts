import { useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { promoteStories, returnStory } from './api-client';
import type { useToast } from '../components/ui/ToastProvider';
import type { useTurnoDoAgente } from './session-turno';

type Turno = ReturnType<typeof useTurnoDoAgente>;

/**
 * A promoção de histórias a partir do fio da Sessão (RN-126/RN-148): o id em
 * voo, o lote do carrossel, a devolução com motivo e os três handlers que as
 * disparam — os mesmos `promoteStories`/`returnStory` da aba Backlog.
 *
 * Morou em `SessionPage.tsx` até o PR 8 do programa do ADR 0176, que moveu os
 * cinco estados e os três handlers sem mudar uma linha. O hook é chamado logo
 * depois de `useTurnoDoAgente`, porque a devolução arma o turno do PO; a
 * posição dos `useState` na ordem dos hooks mudou, e isso não é observável —
 * a ordem só precisa ser a mesma entre um render e o seguinte.
 */
export function usePromocaoDeHistorias({
  projectId,
  sessionId,
  queryClient,
  showToast,
  t,
  iniciarTurnoDoAgente,
  acompanharTurnoPeloLog,
  finalizarTurnoDoAgente,
}: {
  projectId: string;
  sessionId: string;
  queryClient: QueryClient;
  showToast: ReturnType<typeof useToast>['showToast'];
  t: TFunction<'sessionPage'>;
  iniciarTurnoDoAgente: Turno['iniciarTurnoDoAgente'];
  acompanharTurnoPeloLog: Turno['acompanharTurnoPeloLog'];
  finalizarTurnoDoAgente: Turno['finalizarTurnoDoAgente'];
}) {
  // Promoção inline de história (RN-126) — o mesmo mecanismo de
  // `PromotionQueue` (ProjectBacklogTab.tsx), só que disparado a partir do
  // card no fio em vez da aba Backlog. `promovendoStoryId` é o id em voo (só
  // um por vez, como o resto da tela); `recusandoStory` abre o modal de
  // motivo, espelhando o padrão do backlog.
  const [promovendoStoryId, setPromovendoStoryId] = useState<string | null>(null);
  const [recusandoStory, setRecusandoStory] = useState<{ id: string; title: string } | null>(null);
  const [motivoRecusa, setMotivoRecusa] = useState('');
  const [enviandoRecusa, setEnviandoRecusa] = useState(false);
  // Carrossel de histórias (RN-148) — "Aprovar todas" promove o LOTE inteiro
  // numa chamada só (`promoteStories` já é lote por natureza); estado
  // separado de `promovendoStoryId` porque as duas ações podem existir na
  // mesma tela (um slide promovendo sozinho enquanto o lote não foi
  // acionado) e cada botão desabilita só o que é dele.
  const [promovendoTodas, setPromovendoTodas] = useState(false);

  // Promoção inline (RN-126) — mesmos `promoteStories`/`returnStory` que
  // `PromotionQueue` já chama; só o gatilho muda, do botão na aba Backlog
  // pro card no fio. `promoteStories` é sempre lote (mesmo pra uma história),
  // e a resposta traz `failed` com o motivo do domínio quando recusa — o
  // toast reaproveita essa informação em vez de um "erro" genérico.
  async function handlePromoteStory(storyId: string) {
    if (promovendoStoryId || promovendoTodas) return;
    setPromovendoStoryId(storyId);
    try {
      const r = await promoteStories(projectId, [storyId]);
      await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      queryClient.invalidateQueries({ queryKey: ['backlog', projectId] });
      if (r.failed.length > 0) {
        showToast({
          title: t('toasts.erroPromover'),
          message: r.failed[0]?.reason,
          tone: 'danger',
        });
      } else {
        showToast({ title: t('toasts.historiaPromovida'), tone: 'success' });
      }
    } catch {
      showToast({ title: t('toasts.erro'), message: t('toasts.erroPromoverHistoria'), tone: 'danger' });
    } finally {
      setPromovendoStoryId(null);
    }
  }

  // "Aprovar todas" do carrossel (RN-148) — uma chamada só de `promoteStories`
  // com o LOTE inteiro, em vez de N chamadas em série. A resposta tem a mesma
  // forma da unitária (`promoted`/`failed`), e o toast soma: sucesso total,
  // parcial (com o motivo da primeira falha) ou falha total.
  async function handlePromoteAll(storyIds: string[]) {
    if (promovendoStoryId || promovendoTodas || storyIds.length === 0) return;
    setPromovendoTodas(true);
    try {
      const r = await promoteStories(projectId, storyIds);
      await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      queryClient.invalidateQueries({ queryKey: ['backlog', projectId] });
      if (r.failed.length === 0) {
        showToast({
          title: t('toasts.historiasPromovidas', { count: r.promoted.length }),
          tone: 'success',
        });
      } else if (r.promoted.length > 0) {
        showToast({
          title: t('toasts.promovidasParcial', { promovidas: r.promoted.length, total: storyIds.length }),
          message: r.failed[0]?.reason,
          tone: 'warning',
        });
      } else {
        showToast({
          title: t('toasts.erroPromover'),
          message: r.failed[0]?.reason,
          tone: 'danger',
        });
      }
    } catch {
      showToast({ title: t('toasts.erro'), message: t('toasts.erroPromoverHistorias'), tone: 'danger' });
    } finally {
      setPromovendoTodas(false);
    }
  }

  async function handleReturnStory() {
    if (!recusandoStory || motivoRecusa.trim() === '' || enviandoRecusa) return;
    setEnviandoRecusa(true);
    // RN-174: devolver NÃO é só gravar a recusa — `ReturnStoryUseCase` chama
    // `reviseStory`, que é um `handle_call({:revise, …})` no `po_server`, e
    // esta chamada só resolve depois de o PO rodar o turno INTEIRO (reescrever
    // a história). Sem armar o indicador, a tela ficava muda esse tempo todo.
    //
    // Quem reescreve é SEMPRE o PO (`reviseStory` → `po_server`), não o
    // `activeAgent` do momento — é por ele que o log é lido depois do aceite.
    iniciarTurnoDoAgente('po');
    try {
      await returnStory(projectId, recusandoStory.id, motivoRecusa.trim());
      setRecusandoStory(null);
      setMotivoRecusa('');
      await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      queryClient.invalidateQueries({ queryKey: ['backlog', projectId] });
      showToast({ title: t('toasts.historiaDevolvida'), tone: 'success' });
      // ADR 0163 (RN-578): resolver é o ACEITE. Se o PO não estava de pé, a
      // api engoliu a notificação e nenhum `working` novo foi gravado — o
      // `idle` antigo é o mais recente, e a leitura do log fecha na hora.
      acompanharTurnoPeloLog('po');
    } catch {
      showToast({ title: t('toasts.erro'), message: t('toasts.erroDevolverHistoria'), tone: 'danger' });
      // Um erro que deixasse `streaming` ligado travaria o composer até o
      // próximo turno.
      finalizarTurnoDoAgente();
    } finally {
      setEnviandoRecusa(false);
    }
  }

  return {
    promovendoStoryId,
    recusandoStory,
    setRecusandoStory,
    motivoRecusa,
    setMotivoRecusa,
    enviandoRecusa,
    promovendoTodas,
    handlePromoteStory,
    handlePromoteAll,
    handleReturnStory,
  };
}
