import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { mensagemDaApi, proposeAction } from '../lib/api-client';
import { userIdDaSessao } from '../lib/auth';
import type { ProposedAction, SessionEvent } from '../lib/api-types';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/ToastProvider';
import styles from './SessionPage.module.css';

/** A PR que uma ação `pr_open` abriu, lida do evento que a execução gravou. */
export interface PrAbertaDaAcao {
  pullRequestId: string;
  sourceBranch?: string;
  targetBranch?: string;
  title?: string;
}

/**
 * A PR aberta por esta ação `pr_open`, ou `null` se ela não abriu nenhuma.
 *
 * A fonte é o evento `action.pr_open` que a execução grava com
 * `{ actionId, pullRequestId, pullRequestUrl }` (`ExecuteGitActionUseCase`);
 * a ação em si não guarda o id da PR. Ação que ainda não executou, falhou ou
 * caiu fora da janela de eventos lida devolve `null` — e o botão não aparece:
 * não saber qual é a PR não é licença para propor o merge de outra.
 */
export function prAbertaDaAcao(
  acao: ProposedAction,
  eventos: readonly SessionEvent[],
): PrAbertaDaAcao | null {
  if (acao.actionType !== 'pr_open') return null;
  if (acao.status !== 'approved' && acao.status !== 'auto_approved') return null;
  const evento = eventos.find(
    (e) =>
      e.type === 'action.pr_open' &&
      (e.payload as { actionId?: unknown } | null)?.actionId === acao.id,
  );
  const id = (evento?.payload as { pullRequestId?: unknown } | undefined)?.pullRequestId;
  if (id === undefined || id === null || String(id) === '') return null;
  const dado = acao.payload as { sourceBranch?: unknown; targetBranch?: unknown; title?: unknown };
  return {
    pullRequestId: String(id),
    sourceBranch: typeof dado.sourceBranch === 'string' ? dado.sourceBranch : undefined,
    targetBranch: typeof dado.targetBranch === 'string' ? dado.targetBranch : undefined,
    title: typeof dado.title === 'string' ? dado.title : undefined,
  };
}

/**
 * Já existe uma proposta de merge VIVA para esta PR nesta sessão? Pendente,
 * aprovada ou auto-aprovada contam — negada ou falha, não: nesses casos o dono
 * pode querer tentar de novo. É o dedupe do lado da tela; quem recusa de fato
 * é a api, em qualquer sessão (RN-663: `merge_ja_proposto`/`pr_ja_mergeado`).
 */
export function jaHaMergeDaPr(acoes: readonly ProposedAction[], pullRequestId: string): boolean {
  return acoes.some(
    (a) =>
      a.actionType === 'git_merge' &&
      (a.status === 'pending' || a.status === 'approved' || a.status === 'auto_approved') &&
      String((a.payload as { pullRequestId?: unknown }).pullRequestId ?? '') === pullRequestId,
  );
}

interface MergearNoChatProps {
  projectId: string;
  sessionId: string;
  pr: PrAbertaDaAcao;
  /** Papel alcança o mínimo do endpoint (`developer`)? Senão, inerte com motivo. */
  podeDecidir: boolean;
  /**
   * O gate que ainda não julgou a tarefa desta PR (`gatePendenteNoMerge`), ou
   * `null`. AVISO, nunca trava (AT-249, RN-663): o botão segue ativo.
   */
  gatePendente?: string | null;
}

/**
 * "Mergear" no card do PR aberto (AT-266, RN-626): o dono decide sem trocar
 * para a aba PRs.
 *
 * Faz o que a aba PRs já faz, pelo MESMO endpoint: PROPÕE a `git_merge` (ator
 * `user`, esta sessão). A proposta aparece no fio como o card de sempre, com
 * Aprovar/Negar — a confirmação é a de sempre e é do humano. Nada é
 * automatizado: merge em branch protegida segue `require_approval`
 * incondicional (RN-418, `decide.ts`), e este botão não passa por nenhuma
 * política, só cria a proposta que o teto manda esperar.
 */
export function MergearNoChat({
  projectId,
  sessionId,
  pr,
  podeDecidir,
  gatePendente = null,
}: MergearNoChatProps) {
  const { t } = useTranslation('sessionPage');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [propondo, setPropondo] = useState(false);

  async function propor() {
    setPropondo(true);
    try {
      await proposeAction(projectId, sessionId, {
        actionType: 'git_merge',
        actor: { kind: 'user', id: userIdDaSessao() ?? 'usuário' },
        payload: {
          pullRequestId: pr.pullRequestId,
          sourceBranch: pr.sourceBranch,
          targetBranch: pr.targetBranch,
          title: pr.title,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ['session-actions', projectId, sessionId] });
    } catch (erro) {
      // A frase da api (dedupe e recusa da AT-249 chegam por aqui), não uma genérica.
      showToast({
        title: t('mergearNoChat.erroTitulo'),
        message: mensagemDaApi(erro),
        tone: 'danger',
      });
    } finally {
      setPropondo(false);
    }
  }

  return (
    <div className={styles.mergearNoChat}>
      <Button
        variant="primary"
        disabled={!podeDecidir}
        loading={propondo}
        onClick={() => void propor()}
      >
        {propondo ? t('mergearNoChat.propondo') : t('mergearNoChat.botao')}
      </Button>
      <span className={styles.mergearNota} data-testid="mergear-nota">
        {podeDecidir ? t('mergearNoChat.nota') : t('mergearNoChat.semPapel')}
      </span>
      {gatePendente && (
        <span className={styles.mergearAvisoDeGate} data-testid="aviso-gate-pendente">
          {t('mergearNoChat.gatePendente', { gate: gatePendente })}
        </span>
      )}
    </div>
  );
}
