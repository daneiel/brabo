import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  listPersonalAccessTokens,
  issuePersonalAccessToken,
  revokePersonalAccessToken,
  listAllPersonalAccessTokens,
  revokePersonalAccessTokenAsMaintainer,
} from '../../lib/api-client';
import { useCurrentWorkspaceWithRole } from '../../lib/hooks';
import type {
  PersonalAccessTokenIssued,
  PersonalAccessTokenSummary,
  PersonalAccessTokenAdminSummary,
} from '../../lib/api-types';
import { Table, type TableColumn } from '../../components/ui/Table';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { TrashIcon } from '../../components/ui/icons';
import { useToast } from '../../components/ui/ToastProvider';
import styles from '../ProjectSettingsTab.module.css';

/**
 * Personal Access Tokens do runner local (`brb_…`, ADR 0105) — cada usuário
 * gerencia os PRÓPRIOS tokens deste projeto (RN-426); `maintainer`/`owner`
 * ganham, além disso, a visão de TODOS os tokens do projeto para resposta a
 * incidente (RN-427). O token bruto só existe no `emitido` LOCAL deste
 * componente, nunca no cache do react-query que também alimenta a listagem —
 * a lista nunca pode carregar o valor bruto.
 */
export function PersonalAccessTokensSection({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation('settings');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: comPapel } = useCurrentWorkspaceWithRole();
  const podeGerenciarDeTodos =
    comPapel?.role === 'owner' || comPapel?.role === 'maintainer';
  const { data: tokens } = useQuery({
    queryKey: ['pats', projectId],
    queryFn: () => listPersonalAccessTokens(projectId),
  });
  const [name, setName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('');
  const [emitido, setEmitido] = useState<PersonalAccessTokenIssued | null>(null);
  const [copiado, setCopiado] = useState(false);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['pats', projectId] });
  }

  async function handleIssue() {
    if (!name.trim()) return;
    try {
      const dias = expiresInDays.trim() ? Number(expiresInDays) : undefined;
      const issued = await issuePersonalAccessToken(projectId, {
        name: name.trim(),
        expiresInDays: dias,
      });
      setName('');
      setExpiresInDays('');
      setCopiado(false);
      setEmitido(issued);
      invalidate();
    } catch {
      showToast({
        title: t('personalAccessTokens.toast.issueErrorTitle'),
        message: t('personalAccessTokens.toast.issueErrorMessage'),
        tone: 'danger',
      });
    }
  }

  async function handleRevoke(tokenId: string) {
    await revokePersonalAccessToken(projectId, tokenId);
    invalidate();
  }

  const { data: todosOsTokens } = useQuery({
    queryKey: ['pats-admin', projectId],
    queryFn: () => listAllPersonalAccessTokens(projectId),
    enabled: podeGerenciarDeTodos,
  });

  async function handleRevokeComoMaintainer(tokenId: string) {
    await revokePersonalAccessTokenAsMaintainer(projectId, tokenId);
    queryClient.invalidateQueries({ queryKey: ['pats-admin', projectId] });
  }

  async function copiarToken() {
    if (!emitido) return;
    try {
      await navigator.clipboard.writeText(emitido.token);
      setCopiado(true);
    } catch {
      showToast({
        title: t('personalAccessTokens.toast.copyErrorTitle'),
        message: t('personalAccessTokens.toast.copyErrorMessage'),
        tone: 'danger',
      });
    }
  }

  const columns: TableColumn<PersonalAccessTokenSummary>[] = [
    { key: 'name', label: t('personalAccessTokens.table.name'), width: '2fr', render: (pat) => pat.name },
    {
      key: 'createdAt',
      label: t('personalAccessTokens.table.created'),
      width: '1fr',
      render: (pat) => new Date(pat.createdAt).toLocaleDateString(i18n.language),
    },
    {
      key: 'expiresAt',
      label: t('personalAccessTokens.table.expires'),
      width: '1fr',
      render: (pat) =>
        pat.expiresAt
          ? new Date(pat.expiresAt).toLocaleDateString(i18n.language)
          : t('personalAccessTokens.table.expiresNever'),
    },
    {
      key: 'lastUsedAt',
      label: t('personalAccessTokens.table.lastUsed'),
      width: '1fr',
      render: (pat) =>
        pat.lastUsedAt
          ? new Date(pat.lastUsedAt).toLocaleDateString(i18n.language)
          : t('personalAccessTokens.table.lastUsedNever'),
    },
    {
      key: 'status',
      label: t('personalAccessTokens.table.status'),
      width: '120px',
      render: (pat) =>
        pat.revokedAt ? (
          <Badge tone="danger">{t('personalAccessTokens.table.statusRevoked')}</Badge>
        ) : (
          <span className={styles.status}>
            <span className={styles.statusDot} />
            {t('personalAccessTokens.table.statusActive')}
          </span>
        ),
    },
    {
      key: 'action',
      label: '',
      width: '56px',
      render: (pat) =>
        pat.revokedAt ? null : (
          <button
            type="button"
            aria-label={t('personalAccessTokens.table.removeAria', { name: pat.name })}
            title={t('personalAccessTokens.table.removeTitle')}
            className={styles.remove}
            onClick={() => handleRevoke(pat.id)}
          >
            <TrashIcon size={14} />
          </button>
        ),
    },
  ];

  const colunasAdmin: TableColumn<PersonalAccessTokenAdminSummary>[] = [
    { key: 'name', label: 'Nome', width: '2fr', render: (t) => t.name },
    { key: 'userEmail', label: 'Dono', width: '2fr', render: (t) => t.userEmail },
    {
      key: 'createdAt',
      label: 'Criado',
      width: '1fr',
      render: (t) => new Date(t.createdAt).toLocaleDateString('pt-BR'),
    },
    {
      key: 'status',
      label: 'Status',
      width: '120px',
      render: (t) =>
        t.revokedAt ? (
          <Badge tone="danger">revogado</Badge>
        ) : (
          <span className={styles.status}>
            <span className={styles.statusDot} />
            ativo
          </span>
        ),
    },
    {
      key: 'action',
      label: '',
      width: '56px',
      render: (t) =>
        t.revokedAt ? null : (
          <button
            type="button"
            aria-label={`Revogar ${t.name} (${t.userEmail})`}
            title="Revogar"
            className={styles.remove}
            onClick={() => handleRevokeComoMaintainer(t.id)}
          >
            <TrashIcon size={14} />
          </button>
        ),
    },
  ];

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>{t('personalAccessTokens.title')}</h2>
        <span className={styles.eyebrow}>{t('personalAccessTokens.eyebrow')}</span>
      </div>
      <p className={styles.subtitle}>
        {t('personalAccessTokens.subtitle.before')}
        <code>brabo-runner</code>
        {t('personalAccessTokens.subtitle.after')}
      </p>

      <div className={styles.inviteBar}>
        <div className={styles.inviteInput}>
          <Input
            placeholder={t('personalAccessTokens.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className={styles.inviteRole}>
          <Input
            type="number"
            min={1}
            placeholder={t('personalAccessTokens.expiresPlaceholder')}
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
          />
        </div>
        <Button onClick={handleIssue}>{t('personalAccessTokens.generateButton')}</Button>
      </div>

      <Table
        columns={columns}
        rows={tokens ?? []}
        rowKey={(pat) => pat.id}
        emptyMessage={t('personalAccessTokens.emptyMessage')}
      />

      {podeGerenciarDeTodos && (
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.title}>Todos os tokens do projeto</h2>
            <span className={styles.eyebrow}>maintainer · RN-427</span>
          </div>
          <p className={styles.subtitle}>
            Resposta a incidente — revogue o token de qualquer usuário do
            projeto, não só o seu.
          </p>
          <Table
            columns={colunasAdmin}
            rows={todosOsTokens ?? []}
            rowKey={(t) => t.id}
            emptyMessage="Nenhum token de acesso emitido para este projeto."
          />
        </div>
      )}

      {emitido && (
        <Modal title={t('personalAccessTokens.modal.title')} onClose={() => setEmitido(null)}>
          <p className={styles.subtitle}>
            {t('personalAccessTokens.modal.bodyBefore')}
            <code>--token</code>
            {t('personalAccessTokens.modal.bodyMiddle')}
            <code>BRABO_ACCOUNT_TOKEN</code>
            {t('personalAccessTokens.modal.bodyAfter')}
            <code>brabo-runner</code>
            {t('personalAccessTokens.modal.bodyEnd')}
          </p>
          <Input mono readOnly value={emitido.token} onFocus={(e) => e.currentTarget.select()} />
          <Button onClick={copiarToken} variant="secondary">
            {copiado ? t('personalAccessTokens.modal.copiedButton') : t('personalAccessTokens.modal.copyButton')}
          </Button>
        </Modal>
      )}
    </div>
  );
}
