import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { approveAction, approveAlwaysAction, denyAction, getProjectPermissions, setProjectPermissions } from '../lib/api-client';
import { useLatestSession, usePendingActions } from '../lib/hooks';
import type { PermissionListName } from '../lib/api-types';
import { ApprovalCard } from '../components/ApprovalCard';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Table, type TableColumn } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { CheckIcon, SearchIcon, TrashIcon } from '../components/ui/icons';
import styles from './ProjectApprovalsTab.module.css';

interface PermissionRow {
  pattern: string;
  list: PermissionListName;
}

interface ProjectApprovalsTabProps {
  projectId: string;
}

export function ProjectApprovalsTab({ projectId }: ProjectApprovalsTabProps) {
  const { latest: latestSession } = useLatestSession(projectId);
  const actionsQuery = usePendingActions(projectId, latestSession?.id);
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const permissionsQuery = useQuery({
    queryKey: ['permissions', projectId],
    queryFn: () => getProjectPermissions(projectId),
  });

  const pending = (actionsQuery.data?.items ?? []).filter((a) => a.status === 'pending');

  function invalidateActions() {
    queryClient.invalidateQueries({ queryKey: ['session-actions', projectId, latestSession?.id] });
  }

  async function handleApprove(actionId: string) {
    if (!latestSession) return;
    await approveAction(projectId, latestSession.id, actionId);
    invalidateActions();
  }
  async function handleDeny(actionId: string) {
    if (!latestSession) return;
    await denyAction(projectId, latestSession.id, actionId);
    invalidateActions();
  }
  async function handleAlwaysAllow(actionId: string) {
    if (!latestSession) return;
    await approveAlwaysAction(projectId, latestSession.id, actionId);
    invalidateActions();
    queryClient.invalidateQueries({ queryKey: ['permissions', projectId] });
  }

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function approveSelected() {
    if (!latestSession) return;
    await Promise.all(Array.from(selected).map((id) => approveAction(projectId, latestSession.id, id)));
    setSelected(new Set());
    invalidateActions();
  }

  async function revokeRule(row: PermissionRow) {
    if (!permissionsQuery.data) return;
    const updated = {
      ...permissionsQuery.data,
      [row.list]: permissionsQuery.data[row.list].filter((p) => p !== row.pattern),
    };
    await setProjectPermissions(projectId, updated);
    queryClient.invalidateQueries({ queryKey: ['permissions', projectId] });
  }

  const rows: PermissionRow[] = permissionsQuery.data
    ? (['allow', 'deny', 'ask'] as PermissionListName[]).flatMap((list) =>
        permissionsQuery.data![list].map((pattern) => ({ pattern, list })),
      )
    : [];
  const filteredRows = rows.filter((r) => r.pattern.toLowerCase().includes(search.toLowerCase()) || r.list.includes(search.toLowerCase()));

  const columns: TableColumn<PermissionRow>[] = [
    { key: 'pattern', label: 'Padrão', width: '2fr', render: (r) => <span style={{ fontFamily: 'var(--font-mono)' }}>{r.pattern}</span> },
    {
      key: 'type',
      label: 'Tipo',
      width: '110px',
      render: (r) => <Badge tone={r.list === 'deny' ? 'danger' : r.list === 'allow' ? 'success' : 'warning'}>{r.list}</Badge>,
    },
    {
      key: 'action',
      label: 'Ação',
      width: '90px',
      render: (r) => (
        <button type="button" className={styles.revoke} onClick={() => revokeRule(r)}>
          <TrashIcon size={14} /> revogar
        </button>
      ),
    },
  ];

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.title}>Pendentes</div>
            <div className={styles.subtitle}>{pending.length} ordenadas por urgência</div>
          </div>
        </div>

        {selected.size > 0 && (
          <div className={styles.selectionBar}>
            <span>{selected.size} selecionadas</span>
            <Button variant="success" onClick={approveSelected}>
              Aprovar selecionados
            </Button>
          </div>
        )}

        {pending.length === 0 ? (
          <div className={styles.clean}>
            <CheckIcon size={22} />
            Tudo limpo — nenhuma aprovação pendente.
          </div>
        ) : (
          <div className={styles.queue}>
            {pending.map((action) => (
              <ApprovalCard
                key={action.id}
                action={action}
                variant="queue"
                selectable
                selected={selected.has(action.id)}
                onToggleSelect={() => toggleSelect(action.id)}
                onApprove={() => handleApprove(action.id)}
                onDeny={() => handleDeny(action.id)}
                onAlwaysAllow={() => handleAlwaysAllow(action.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.title}>Permissões do projeto</div>
        <div className={styles.subtitle} style={{ marginBottom: 12 }}>
          Regras gravadas em .brabo/permissions.json
        </div>
        <div className={styles.banner}>
          Ordem de avaliação: <b className={styles.deny}>deny</b> sempre vence <b className={styles.allow}>allow</b>, independente da ordem no arquivo.
        </div>
        <div className={styles.searchRow}>
          <Input placeholder="Buscar por padrão ou tipo…" icon={<SearchIcon size={14} />} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Table columns={columns} rows={filteredRows} rowKey={(r) => `${r.list}:${r.pattern}`} emptyMessage="Nenhuma regra configurada ainda." />
      </div>
    </div>
  );
}
