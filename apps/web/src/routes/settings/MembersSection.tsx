import { useState, type CSSProperties } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  addProjectMember,
  listProjectMembers,
  removeProjectMember,
} from '../../lib/api-client';
import { ROLE_LABEL, ROLE_ORDER } from '../../lib/roles';
import type { Role } from '../../lib/api-types';
import { Table, type TableColumn } from '../../components/ui/Table';
import { Select } from '../../components/ui/Select';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { TrashIcon } from '../../components/ui/icons';
import { useToast } from '../../components/ui/ToastProvider';
import styles from '../ProjectSettingsTab.module.css';
import { SecaoDeConfiguracoes } from './SecaoDeConfiguracoes';

/** Duas letras a partir do nome (ou do e-mail, quando não há nome). */
function iniciaisDe(rotulo: string): string {
  const partes = rotulo.split(/[\s@._-]+/u).filter(Boolean);
  const letras =
    partes.length >= 2
      ? partes[0][0] + partes[1][0]
      : (partes[0] ?? '?').slice(0, 2);
  return letras.toUpperCase();
}

/**
 * O avatar do membro é um GRADIENTE no desenho — é o que o distingue do avatar
 * do agente, que tem cor chapada e anel. As duas pontas saem de um hash do
 * e-mail: a mesma pessoa fica com o mesmo par em qualquer tela, e ninguém
 * precisa cadastrar cor de avatar.
 */
const PARES_DE_GRADIENTE = [
  ['var(--accent)', 'var(--warning)'],
  ['var(--success)', 'var(--accent)'],
  ['var(--warning)', 'var(--danger)'],
  ['var(--success)', 'var(--border-strong)'],
  ['var(--danger)', 'var(--accent)'],
] as const;

function gradienteDe(email: string): CSSProperties {
  let hash = 0;
  for (const char of email) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  const [de, para] = PARES_DE_GRADIENTE[hash % PARES_DE_GRADIENTE.length];
  return { ['--membro-de']: de, ['--membro-para']: para } as CSSProperties;
}

export function MembersSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: members } = useQuery({ queryKey: ['members', projectId], queryFn: () => listProjectMembers(projectId) });
  const [inviteUserId, setInviteUserId] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('developer');

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['members', projectId] });
  }

  async function handleInvite() {
    if (!inviteUserId.trim()) return;
    try {
      await addProjectMember(projectId, { userId: inviteUserId.trim(), role: inviteRole });
      setInviteUserId('');
      invalidate();
    } catch {
      showToast({
        title: t('members.toast.inviteErrorTitle'),
        message: t('members.toast.inviteErrorMessage'),
        tone: 'danger',
      });
    }
  }

  async function handleRoleChange(userId: string, role: Role) {
    await addProjectMember(projectId, { userId, role });
    invalidate();
  }

  async function handleRemove(userId: string) {
    await removeProjectMember(projectId, userId);
    invalidate();
  }

  const columns: TableColumn<NonNullable<typeof members>[number]>[] = [
    {
      key: 'member',
      label: t('members.table.member'),
      width: '2fr',
      render: (member) => (
        <span className={styles.membroCell}>
          <span className={styles.membroAvatar} style={gradienteDe(member.email)}>
            {iniciaisDe(member.name ?? member.email)}
          </span>
          <span className={styles.memberCell}>
            <span className={styles.memberName}>{member.name ?? member.email}</span>
            <span className={styles.memberEmail}>{member.email}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'role',
      label: t('members.table.role'),
      width: '160px',
      render: (member) => (
        <Select value={member.role} onChange={(e) => handleRoleChange(member.userId, e.target.value as Role)}>
          {ROLE_ORDER.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABEL[role]}
            </option>
          ))}
        </Select>
      ),
    },
    {
      key: 'status',
      label: t('members.table.status'),
      width: '1fr',
      render: () => (
        <span className={styles.status}>
          <span className={styles.statusDot} />
          {t('members.table.active')}
        </span>
      ),
    },
    {
      key: 'action',
      label: '',
      width: '56px',
      render: (member) => (
        <button
          type="button"
          aria-label={t('members.table.removeAria', { name: member.name ?? member.email })}
          title={t('members.table.removeTitle')}
          className={styles.remove}
          onClick={() => handleRemove(member.userId)}
        >
          <TrashIcon size={14} />
        </button>
      ),
    },
  ];

  return (
    <SecaoDeConfiguracoes chave="members">
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>{t('members.title')}</h2>
        <span className={styles.eyebrow}>{t('members.eyebrow')}</span>
      </div>
      <p className={styles.subtitle}>{t('members.subtitle')}</p>

      <div className={styles.inviteBar}>
        <div className={styles.inviteInput}>
          <Input
            mono
            placeholder={t('members.invite.placeholder')}
            value={inviteUserId}
            onChange={(e) => setInviteUserId(e.target.value)}
          />
        </div>
        <div className={styles.inviteRole}>
          <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
            {ROLE_ORDER.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </Select>
        </div>
        <Button onClick={handleInvite}>{t('members.invite.button')}</Button>
      </div>

      <Table
        columns={columns}
        rows={members ?? []}
        rowKey={(m) => m.userId}
        emptyMessage={t('members.emptyMessage')}
      />
    </SecaoDeConfiguracoes>
  );
}
