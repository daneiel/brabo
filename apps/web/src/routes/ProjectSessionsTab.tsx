import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { createSession, transitionSession } from '../lib/api-client';
import { useProjectSessions } from '../lib/hooks';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
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

  return (
    <div>
      <div className={styles.header}>
        <span className={styles.title}>Sessões</span>
        <Button onClick={handleCreate} disabled={creating}>
          {creating ? 'Criando…' : '+ Nova sessão'}
        </Button>
      </div>

      {sorted.length === 0 ? (
        <div className={styles.empty}>Nenhuma sessão ainda. Crie uma pra começar a conversar com um modelo.</div>
      ) : (
        <div className={styles.list}>
          {sorted.map((session) => (
            <div
              key={session.id}
              className={styles.row}
              onClick={() => navigate({ to: '/projects/$projectId/sessions/$sessionId', params: { projectId, sessionId: session.id } })}
            >
              <span className={styles.rowId}>#{session.id.slice(0, 8)}</span>
              <Badge tone={STATUS_TONE[session.status]} dot>
                {session.status}
              </Badge>
              <span className={styles.rowDate}>{new Date(session.createdAt).toLocaleString('pt-BR')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
