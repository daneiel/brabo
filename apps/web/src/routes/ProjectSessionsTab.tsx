import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { createSession, listActions, transitionSession } from '../lib/api-client';
import { useProjectSessions } from '../lib/hooks';
import {
  resumirAcoes,
  somarResumos,
  type ResumoDeAprovacoes,
} from '../lib/approvals';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { hashtagDaSessao } from '../lib/session-label';
import type { SessionStatus } from '../lib/api-types';
import styles from './ProjectSessionsTab.module.css';

const STATUS_TONE: Record<SessionStatus, 'success' | 'warning' | 'muted' | 'danger'> = {
  created: 'muted',
  active: 'success',
  closing: 'warning',
  closed: 'muted',
  closed_abnormally: 'danger',
};

interface ProjectSessionsTabProps {
  projectId: string;
}

export function ProjectSessionsTab({ projectId }: ProjectSessionsTabProps) {
  const { data: sessions } = useProjectSessions(projectId);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleCreate() {
    setCreating(true);
    try {
      const session = await createSession(projectId);
      await transitionSession(projectId, session.id, 'active');
      await queryClient.invalidateQueries({ queryKey: ['sessions', projectId] });
      navigate({ to: '/projects/$projectId/sessions/$sessionId', params: { projectId, sessionId: session.id } });
    } finally {
      setCreating(false);
    }
  }

  const sorted = [...(sessions ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Aprovações POR SESSÃO (achado #16 do primeiro dogfooding). Tudo o que
  // existia estava preso à sessão mais recente — `usePendingActions` exige um
  // `sessionId` e os três chamadores passavam o da última —, então uma decisão
  // esquecida numa sessão anterior ficava invisível para sempre.
  //
  // A rota de ações é escopada por sessão, e continua assim: a soma é feita
  // aqui, uma consulta por linha já listada. Sessões de um projeto são poucas,
  // e o TanStack Query as cacheia junto com as da aba de aprovações.
  const acoesPorSessao = useQueries({
    queries: sorted.map((session) => ({
      queryKey: ['session-actions', projectId, session.id],
      queryFn: () => listActions(projectId, session.id, { limit: 200 }),
    })),
  });
  const resumoDe = (indice: number): ResumoDeAprovacoes =>
    resumirAcoes(acoesPorSessao[indice]?.data?.items);
  const totalDoProjeto = somarResumos(
    acoesPorSessao.map((q) => resumirAcoes(q.data?.items)),
  );

  return (
    <div>
      <div className={styles.header}>
        <span className={styles.title}>Sessões</span>
        <Button onClick={handleCreate} disabled={creating}>
          {creating ? 'Criando…' : '+ Nova sessão'}
        </Button>
      </div>

      {totalDoProjeto.total > 0 && (
        <div className={styles.subtitle}>
          {totalDoProjeto.total} ação(ões) proposta(s) no projeto ·{' '}
          {totalDoProjeto.decididasPorVoce} decidida(s) por você ·{' '}
          {totalDoProjeto.autoAprovadas} auto-aprovada(s) pela política ·{' '}
          {totalDoProjeto.pendentes} aguardando
        </div>
      )}

      {sorted.length === 0 ? (
        <div className={styles.empty}>Nenhuma sessão ainda. Crie uma pra começar a conversar com um modelo.</div>
      ) : (
        <div className={styles.list}>
          {sorted.map((session, indice) => {
            const resumo = resumoDe(indice);
            return (
              <div
                key={session.id}
                className={styles.row}
                onClick={() => navigate({ to: '/projects/$projectId/sessions/$sessionId', params: { projectId, sessionId: session.id } })}
              >
                <span className={styles.rowId}>{hashtagDaSessao(session.id)}</span>
                <Badge tone={STATUS_TONE[session.status]} dot>
                  {session.status}
                </Badge>
                {resumo.total > 0 && (
                  <span
                    className={
                      resumo.pendentes > 0
                        ? `${styles.rowApprovals} ${styles.rowApprovalsPending}`
                        : styles.rowApprovals
                    }
                  >
                    {resumo.pendentes > 0
                      ? `${resumo.pendentes} aguardando · ${resumo.decididasPorVoce} decidida(s) por você`
                      : `${resumo.decididasPorVoce} decidida(s) por você · ${resumo.autoAprovadas} auto`}
                  </span>
                )}
                <span className={styles.rowDate}>{new Date(session.createdAt).toLocaleString('pt-BR')}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
